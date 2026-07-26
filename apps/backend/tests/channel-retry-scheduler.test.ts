import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { createFakeChannel, fakeInboundBody, postWebhook } from './channel-helpers';
import { channelDeliveryService } from '../src/modules/channels';
import { isChannelRetrySweepEnabled } from '../src/config/env';
import {
  runSweepOnce,
  startChannelRetryScheduler,
  stopChannelRetryScheduler,
} from '../src/modules/channels/channel-retry.scheduler';

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

// spyOn is used to force a failing / counted sweep; jest's clearMocks does not
// restore the original implementation, so restore explicitly.
afterEach(() => {
  jest.restoreAllMocks();
});

async function fakeChannelConversation(tenant: Tenant) {
  const created = await createFakeChannel(app, tenant.tokens.owner);
  const accountId = created.body.data.account.id;
  await postWebhook(
    app,
    accountId,
    fakeInboundBody({ messageId: `in-${accountId}`, customerId: `cust-${accountId}` }),
  );
  const conv = await prisma.conversation.findFirst({
    where: { companyId: tenant.company.id, channelAccountId: accountId },
  });
  return { accountId, conversationId: conv!.id };
}

function send(convId: string, token: string, content: string) {
  return request(app)
    .post(`/api/v1/conversations/${convId}/messages`)
    .set(authHeader(token))
    .send({ content });
}

function deliveryFor(messageId: string) {
  return prisma.channelDelivery.findFirst({ where: { messageId } });
}

/**
 * A delivery QUEUED for a retry: the fake provider fails the first attempt
 * transiently and succeeds on the second, which is exactly the state the sweeper
 * exists to rescue.
 */
async function queuedRetry(tenant: Tenant) {
  const { conversationId } = await fakeChannelConversation(tenant);
  const res = await send(conversationId, tenant.tokens.owner, 'sweep me __RETRY_OK__');
  const messageId = res.body.data.message.id as string;
  const delivery = await deliveryFor(messageId);
  expect(delivery?.status).toBe('QUEUED');
  expect(delivery?.attemptCount).toBe(1);
  return { messageId, deliveryId: delivery!.id };
}

describe('Channel retry scheduler — sweeps', () => {
  it('dispatches a delivery whose nextAttemptAt has elapsed', async () => {
    const { messageId, deliveryId } = await queuedRetry(acme);
    await prisma.channelDelivery.update({
      where: { id: deliveryId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const result = await runSweepOnce();
    expect(result.status).toBe('ran');
    expect(result.processed).toBe(1);
    expect(result.failures).toBe(0);

    // The delivery must have actually progressed, not merely been counted.
    const after = await deliveryFor(messageId);
    expect(after?.status).toBe('SENT');
    expect(after?.attemptCount).toBe(2);
    expect(after?.nextAttemptAt).toBeNull();
    expect(after?.externalMessageId).toMatch(/^fake-out-/);

    const msg = await prisma.message.findFirst({ where: { id: messageId } });
    expect(msg?.status).toBe('SENT');

    const attempts = await prisma.channelDeliveryAttempt.findMany({
      where: { deliveryId },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts.map((a) => a.status)).toEqual([
      'TEMPORARY_FAILURE',
      'SUCCESS',
    ]);
  });

  it('leaves a delivery whose nextAttemptAt is still in the future alone', async () => {
    const { messageId, deliveryId } = await queuedRetry(acme);
    await prisma.channelDelivery.update({
      where: { id: deliveryId },
      data: { nextAttemptAt: new Date(Date.now() + 600_000) },
    });

    const result = await runSweepOnce();
    expect(result.status).toBe('ran');
    expect(result.processed).toBe(0);
    expect(result.recovered).toBe(0);

    const after = await deliveryFor(messageId);
    expect(after?.status).toBe('QUEUED');
    expect(after?.attemptCount).toBe(1);
    const attempts = await prisma.channelDeliveryAttempt.findMany({
      where: { deliveryId },
    });
    expect(attempts).toHaveLength(1);
  });

  it('re-queues a delivery orphaned in SENDING and retries it in the same sweep', async () => {
    const { messageId, deliveryId } = await queuedRetry(acme);
    // Simulate a crash between claiming and finalizing the attempt.
    await prisma.channelDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENDING', lastAttemptAt: new Date(Date.now() - 120_000) },
    });

    const result = await runSweepOnce();
    expect(result.status).toBe('ran');
    expect(result.recovered).toBe(1);
    expect(result.processed).toBe(1);

    const after = await deliveryFor(messageId);
    expect(after?.status).toBe('SENT');
  });

  it('swallows an internal failure instead of rejecting', async () => {
    const spy = jest
      .spyOn(channelDeliveryService, 'runDueRetries')
      .mockRejectedValue(new Error('database is on fire'));

    // Must RESOLVE: an unhandled rejection in a timer kills the process.
    const result = await runSweepOnce();
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('database is on fire');
    expect(result.processed).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips an overlapping sweep instead of running two at once', async () => {
    const { deliveryId } = await queuedRetry(acme);
    await prisma.channelDelivery.update({
      where: { id: deliveryId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const spy = jest.spyOn(channelDeliveryService, 'runDueRetries');

    // Start both without awaiting the first: the guard is set synchronously.
    const first = runSweepOnce();
    const second = runSweepOnce();
    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe('ran');
    expect(b.status).toBe('skipped');
    expect(b.reason).toBe('in_flight');
    expect(spy).toHaveBeenCalledTimes(1);

    // The guard must release, so the next sweep runs normally.
    const third = await runSweepOnce();
    expect(third.status).toBe('ran');
  });
});

describe('Channel retry scheduler — timer lifecycle', () => {
  it('never installs a timer under NODE_ENV=test, even when the flag is on', () => {
    process.env.CHANNEL_RETRY_SWEEP_ENABLED = 'true';
    expect(isChannelRetrySweepEnabled()).toBe(false);
    expect(startChannelRetryScheduler()).toBe(false);
    // Safe to call when never started.
    stopChannelRetryScheduler();
  });
});
