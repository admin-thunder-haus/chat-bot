import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { createFakeChannel, fakeInboundBody, postWebhook } from './channel-helpers';
import {
  outboundWebhooksService,
  setOutboundWebhookTransportForTesting,
} from '../src/modules/public-api/outbound-webhooks.service';

/**
 * Operational alerts: a channel dying at 3am and a webhook endpoint being
 * switched off both used to be invisible to the owner. These tests pin the two
 * things that make the alert trustworthy — it fires on the transition EDGE, and
 * its body says what to do next.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

afterEach(() => {
  setOutboundWebhookTransportForTesting(null);
});

function healthCheck(accountId: string) {
  return request(app)
    .post(`/api/v1/channels/${accountId}/health-check`)
    .set(authHeader(acme.tokens.owner));
}

function systemAlerts() {
  return prisma.notification.findMany({
    where: { companyId: acme.company.id, type: 'SYSTEM_ALERT' },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The delivery-outcome call site emits DETACHED (it runs inside the delivery
 * engine's transaction and must not hold it open for I/O), so the row appears
 * shortly after the request returns rather than during it.
 */
async function waitForAlerts(expected: number, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alerts = await systemAlerts();
    if (alerts.length >= expected || Date.now() > deadline) return alerts;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Fake account whose simulated probe result is driven by its metadata. */
async function fakeChannelSimulating(simulation: string): Promise<string> {
  const created = await createFakeChannel(app, acme.tokens.owner, {
    metadata: { healthSimulation: simulation },
  });
  return created.body.data.account.id as string;
}

function setSimulation(accountId: string, simulation: string) {
  return prisma.channelAccount.update({
    where: { id: accountId },
    data: { metadata: { healthSimulation: simulation } },
  });
}

describe('Channel unavailable alerts', () => {
  it('notifies the owner when a channel stops responding, with remediation', async () => {
    const accountId = await fakeChannelSimulating('unavailable');

    const res = await healthCheck(accountId);
    expect(res.body.data.account.connectionState).toBe('UNAVAILABLE');

    const alerts = await systemAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('is not responding');
    // Says what happened AND what to do next.
    expect(alerts[0].body).toContain('Fake Channel');
    expect(alerts[0].body).toContain('Setup → Channels');
    expect(alerts[0].body).toContain('reconnect');
    // Never the raw enum in user-facing copy.
    expect(alerts[0].title).not.toContain('UNAVAILABLE');
    expect(alerts[0].body).not.toContain('UNAVAILABLE');
    // Ids for the dashboard / integrators live in `data`.
    expect(alerts[0].data).toMatchObject({
      channelAccountId: accountId,
      providerKey: 'fake',
    });
  });

  it('notifies when the channel sign-in expires', async () => {
    const accountId = await fakeChannelSimulating('auth_expired');

    const res = await healthCheck(accountId);
    expect(res.body.data.account.connectionState).toBe('AUTH_EXPIRED');

    const alerts = await systemAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('sign-in has expired');
    expect(alerts[0].body).toContain('Setup → Channels');
    expect(alerts[0].body).toContain('reconnect');
    expect(alerts[0].body).not.toContain('AUTH_EXPIRED');
  });

  it('does NOT notify again while the channel stays broken', async () => {
    const accountId = await fakeChannelSimulating('unavailable');

    await healthCheck(accountId);
    await healthCheck(accountId);
    await healthCheck(accountId);

    // Three checks, one alert: the owner is told once, not once a minute.
    expect(await systemAlerts()).toHaveLength(1);
  });

  it('notifies again only after a genuine recovery', async () => {
    const accountId = await fakeChannelSimulating('unavailable');
    await healthCheck(accountId);
    expect(await systemAlerts()).toHaveLength(1);

    // Recovery is not an alert...
    await setSimulation(accountId, 'healthy');
    const recovered = await healthCheck(accountId);
    expect(recovered.body.data.account.connectionState).toBe('HEALTHY');
    expect(await systemAlerts()).toHaveLength(1);

    // ...but breaking again is.
    await setSimulation(accountId, 'unavailable');
    await healthCheck(accountId);
    expect(await systemAlerts()).toHaveLength(2);
  });

  it('notifies when repeated delivery failures take the channel down', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const accountId = created.body.data.account.id as string;
    await postWebhook(
      app,
      accountId,
      fakeInboundBody({ messageId: 'in-1', customerId: 'cust-1' }),
    );
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { companyId: acme.company.id, channelAccountId: accountId },
    });

    // Score 100 -> 70 -> 40 -> 10: HEALTHY, DEGRADED, then UNAVAILABLE.
    for (const text of ['a __FAIL__', 'b __FAIL__', 'c __FAIL__']) {
      await request(app)
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .set(authHeader(acme.tokens.owner))
        .send({ content: text });
    }

    const account = await prisma.channelAccount.findUnique({
      where: { id: accountId },
    });
    expect(account?.connectionState).toBe('UNAVAILABLE');

    const alerts = await waitForAlerts(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain('Setup → Channels');
    expect(alerts[0].data).toMatchObject({ detectedBy: 'delivery' });
  });

  it('a degraded channel does not raise an alert', async () => {
    const accountId = await fakeChannelSimulating('degraded');

    const res = await healthCheck(accountId);
    expect(res.body.data.account.connectionState).toBe('DEGRADED');
    // DEGRADED is self-healing and already visible on the channels page.
    expect(await systemAlerts()).toHaveLength(0);
  });
});

describe('Outbound webhook auto-disable alerts', () => {
  function createWebhook(events: string[]) {
    return request(app)
      .post('/api/v1/integrations/webhooks')
      .set(authHeader(acme.tokens.owner))
      .send({ url: 'https://example.com/hooks', events });
  }

  /** One dispatch of a subscribed event, with a transport that always fails. */
  async function failingDispatch() {
    setOutboundWebhookTransportForTesting(async () => ({ status: 503 }));
    await outboundWebhooksService.dispatchEvent(
      acme.company.id,
      'conversation.created',
      { title: 'New conversation', body: 'someone said hello' },
    );
  }

  it('notifies the owner when the endpoint is auto-disabled, with remediation', async () => {
    const created = await createWebhook(['conversation.created']);
    const webhookId = created.body.data.webhook.id as string;
    // One failure short of the threshold, so this dispatch crosses it.
    await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data: { failureCount: 19 },
    });

    await failingDispatch();

    const disabled = await prisma.outboundWebhook.findUnique({
      where: { id: webhookId },
    });
    expect(disabled?.isActive).toBe(false);

    const alerts = await systemAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('Webhook turned off after repeated failures');
    expect(alerts[0].body).toContain('https://example.com/hooks');
    expect(alerts[0].body).toContain('20 times in a row');
    expect(alerts[0].body).toContain('Setup → Integrations');
    expect(alerts[0].data).toMatchObject({ webhookId });
  });

  it('does not notify for a failure below the threshold', async () => {
    const created = await createWebhook(['conversation.created']);
    await prisma.outboundWebhook.update({
      where: { id: created.body.data.webhook.id as string },
      data: { failureCount: 5 },
    });

    await failingDispatch();

    expect(await systemAlerts()).toHaveLength(0);
  });

  it('does not notify twice once the endpoint is already off', async () => {
    const created = await createWebhook(['conversation.created']);
    const webhookId = created.body.data.webhook.id as string;
    await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data: { failureCount: 19 },
    });

    await failingDispatch();
    // A disabled endpoint is no longer a dispatch target, so a second event
    // must not produce a second alert.
    await failingDispatch();

    expect(await systemAlerts()).toHaveLength(1);
  });
});
