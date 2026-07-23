import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import type {
  AIProvider,
  AIProviderInput,
} from '../src/modules/ai/providers/ai-provider.interface';
import { setOutboundWebhookTransportForTesting } from '../src/modules/public-api/outbound-webhooks.service';

/**
 * AI Actions framework: the ACTION_REQUEST protocol end-to-end (mock-inbound
 * auto-reply flow), the execution audit trail, notifications + webhooks, and
 * the /api/v1/actions operations surface.
 */

const app = createApp();
let acme: Tenant;

/** Provider returning a queue of texts (one per call; last text repeats). */
function makeQueueProvider(texts: string[]): {
  provider: AIProvider;
  calls: AIProviderInput[];
} {
  const calls: AIProviderInput[] = [];
  const queue = [...texts];
  const provider: AIProvider = {
    name: 'fake',
    async generateResponse(input) {
      calls.push(input);
      const text = queue.length > 1 ? queue.shift()! : queue[0];
      return {
        text,
        provider: 'fake',
        model: input.model,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        providerResponseId: 'resp_fake',
        finishReason: 'completed',
        latencyMs: 2,
      };
    },
  };
  return { provider, calls };
}

function mockInbound(extMsgId: string, content: string, extCust = 'cust-1') {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extCust,
      customer: { fullName: 'Action Customer' },
      message: { externalMessageId: extMsgId, content },
    });
}

function futureIso(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

async function seedCatalog() {
  await prisma.businessService.create({
    data: {
      companyId: acme.company.id,
      name: 'Haircut',
      durationMinutes: 30,
      isActive: true,
    },
  });
  await prisma.product.createMany({
    data: [
      {
        companyId: acme.company.id,
        name: 'Coffee Beans',
        price: '10.00',
        currency: 'JOD',
        stockQuantity: 12,
        isActive: true,
      },
      {
        companyId: acme.company.id,
        name: 'Ceramic Mug',
        price: '5.50',
        currency: 'JOD',
        stockQuantity: null,
        isActive: true,
      },
    ],
  });
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  await prisma.companyAISettings.upsert({
    where: { companyId: acme.company.id },
    create: { companyId: acme.company.id, autoReplyEnabled: true },
    update: { autoReplyEnabled: true },
  });
  await seedCatalog();
});

afterEach(() => {
  setAIProviderForTesting(null);
  setOutboundWebhookTransportForTesting(null);
  delete process.env.AI_ACTIONS_ENABLED;
});

describe('book_appointment end-to-end', () => {
  it('creates the appointment, audit row, confirmation reply, notification and webhook', async () => {
    const when = futureIso();
    const fake = makeFakeProvider({
      text: `ACTION_REQUEST {"action":"book_appointment","input":{"serviceName":"haircut","dateTime":"${when}"}}`,
    });
    setAIProviderForTesting(fake.provider);

    // Outbound webhook subscribed to action.executed only.
    const hook = await request(app)
      .post('/api/v1/integrations/webhooks')
      .set(authHeader(acme.tokens.owner))
      .send({ url: 'https://example.com/hooks', events: ['action.executed'] });
    expect(hook.status).toBe(201);
    const webhookCalls: { event: string; body: string }[] = [];
    setOutboundWebhookTransportForTesting(async (_url, req) => {
      webhookCalls.push({
        event: req.headers['X-Webhook-Event'],
        body: req.body,
      });
      return { status: 200 };
    });

    const res = await mockInbound('a1', 'Please book me a haircut');
    expect(res.status).toBe(201);
    expect(res.body.data.autoReply.generated).toBe(true);

    // The prompt advertised the action protocol.
    expect(fake.lastInput()!.systemPrompt).toContain('ACTION_REQUEST');
    expect(fake.lastInput()!.systemPrompt).toContain('book_appointment');

    // Appointment row (PENDING, via AI, service resolved case-insensitively).
    const appointment = await prisma.appointment.findFirst({
      where: { companyId: acme.company.id },
    });
    expect(appointment).not.toBeNull();
    expect(appointment!.status).toBe('PENDING');
    expect(appointment!.createdVia).toBe('ai');
    expect(appointment!.scheduledAt.toISOString()).toBe(when);
    expect(appointment!.serviceId).not.toBeNull();
    expect(appointment!.durationMinutes).toBe(30); // from the service

    // Execution audit row.
    const execution = await prisma.aIActionExecution.findFirst({
      where: { companyId: acme.company.id },
    });
    expect(execution!.actionKey).toBe('book_appointment');
    expect(execution!.status).toBe('completed');
    expect(execution!.generationId).not.toBeNull();

    // Customer got a confirmation (never the raw sentinel line).
    const convId = res.body.data.conversation.id;
    const outbound = await prisma.message.findFirst({
      where: { conversationId: convId, senderType: 'AI' },
    });
    expect(outbound!.content).toContain('Appointment booked');
    expect(outbound!.content).not.toContain('ACTION_REQUEST');

    // In-app notification for the write action.
    const notification = await prisma.notification.findFirst({
      where: { companyId: acme.company.id, type: 'SYSTEM_ALERT' },
    });
    expect(notification!.title).toBe('AI booked an appointment');

    // Subscribed outbound webhook received action.executed (+ delivery log).
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0].event).toBe('action.executed');
    const payload = JSON.parse(webhookCalls[0].body);
    expect(payload.data.actionKey).toBe('book_appointment');
    const delivery = await prisma.outboundWebhookDelivery.findFirst({
      where: { webhookId: hook.body.data.webhook.id },
    });
    expect(delivery!.status).toBe('delivered');
    expect(delivery!.eventType).toBe('action.executed');
  });
});

describe('create_order', () => {
  it('resolves products, computes the total, and stores order + items', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'ACTION_REQUEST {"action":"create_order","input":{"items":[{"productName":"coffee","quantity":2},{"productName":"mug","quantity":1}]}}',
      }).provider,
    );

    const res = await mockInbound('o1', 'I want 2 coffee and a mug');
    expect(res.body.data.autoReply.generated).toBe(true);

    const order = await prisma.order.findFirst({
      where: { companyId: acme.company.id },
      include: { items: true },
    });
    expect(order).not.toBeNull();
    expect(order!.status).toBe('NEW');
    expect(order!.createdVia).toBe('ai');
    expect(order!.totalAmount!.toFixed(2)).toBe('25.50');
    expect(order!.currency).toBe('JOD');
    expect(order!.items).toHaveLength(2);
    const beans = order!.items.find((i) => i.name === 'Coffee Beans');
    expect(beans!.quantity).toBe(2);
    expect(beans!.unitPrice!.toFixed(2)).toBe('10.00');
    expect(beans!.productId).not.toBeNull();

    const execution = await prisma.aIActionExecution.findFirst({
      where: { companyId: acme.company.id, actionKey: 'create_order' },
    });
    expect(execution!.status).toBe('completed');

    const outbound = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(outbound!.content).toContain('Order created');
    expect(outbound!.content).toContain('25.50');
  });

  it('unknown product -> failed execution and an apologetic reply (no order row)', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'ACTION_REQUEST {"action":"create_order","input":{"items":[{"productName":"Nonexistent Thing","quantity":1}]}}',
      }).provider,
    );

    const res = await mockInbound('o2', 'I want a Nonexistent Thing');
    expect(res.body.data.autoReply.generated).toBe(true);

    expect(await prisma.order.count()).toBe(0);

    const execution = await prisma.aIActionExecution.findFirst({
      where: { companyId: acme.company.id, actionKey: 'create_order' },
    });
    expect(execution!.status).toBe('failed');
    expect(execution!.errorMessage).toContain('Nonexistent Thing');

    const outbound = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(outbound!.content).toContain("Sorry, I couldn't complete that");
    expect(outbound!.content).toContain('Nonexistent Thing');
  });
});

describe('input validation', () => {
  it('missing dateTime -> rejected execution + clarifying question (no appointment)', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'ACTION_REQUEST {"action":"book_appointment","input":{"serviceName":"haircut"}}',
      }).provider,
    );

    const res = await mockInbound('v1', 'Book me a haircut');
    expect(res.body.data.autoReply.generated).toBe(true);

    expect(await prisma.appointment.count()).toBe(0);

    const execution = await prisma.aIActionExecution.findFirst({
      where: { companyId: acme.company.id },
    });
    expect(execution!.status).toBe('rejected');
    expect(execution!.errorMessage).toContain('dateTime');

    const outbound = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(outbound!.content).toContain('dateTime');
    expect(outbound!.content).toContain('need');

    // Rejected actions never notify the team.
    expect(
      await prisma.notification.count({
        where: { companyId: acme.company.id, type: 'SYSTEM_ALERT' },
      }),
    ).toBe(0);
  });
});

describe('create_support_ticket', () => {
  it('creates an OPEN ticket with default NORMAL priority', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'ACTION_REQUEST {"action":"create_support_ticket","input":{"subject":"Broken order"}}',
      }).provider,
    );

    const res = await mockInbound('t1', 'My order arrived broken!');
    expect(res.body.data.autoReply.generated).toBe(true);

    const ticket = await prisma.supportTicket.findFirst({
      where: { companyId: acme.company.id },
    });
    expect(ticket!.subject).toBe('Broken order');
    expect(ticket!.status).toBe('OPEN');
    expect(ticket!.priority).toBe('NORMAL');
    expect(ticket!.createdVia).toBe('ai');
  });
});

describe('check_product_availability', () => {
  it('feeds the lookup back into a second natural-language generation', async () => {
    const queued = makeQueueProvider([
      'ACTION_REQUEST {"action":"check_product_availability","input":{"productName":"coffee"}}',
      'Yes! We have 12 bags of Coffee Beans in stock at 10.00 JOD.',
    ]);
    setAIProviderForTesting(queued.provider);

    const res = await mockInbound('c1', 'Do you have coffee in stock?');
    expect(res.body.data.autoReply.generated).toBe(true);

    // Read-only lookups are audited too.
    const execution = await prisma.aIActionExecution.findFirst({
      where: {
        companyId: acme.company.id,
        actionKey: 'check_product_availability',
      },
    });
    expect(execution!.status).toBe('completed');

    // Two provider calls; the second carries the lookup result.
    expect(queued.calls).toHaveLength(2);
    expect(queued.calls[1].systemPrompt).toContain(
      'Availability lookup result',
    );
    expect(queued.calls[1].systemPrompt).toContain('In stock: 12');

    // The customer receives the natural second-generation reply.
    const outbound = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(outbound!.content).toBe(
      'Yes! We have 12 bags of Coffee Beans in stock at 10.00 JOD.',
    );

    // Read-only actions never create a team notification.
    expect(
      await prisma.notification.count({
        where: { companyId: acme.company.id, type: 'SYSTEM_ALERT' },
      }),
    ).toBe(0);
  });
});

describe('operations endpoints (/api/v1/actions)', () => {
  async function seedRecords() {
    const appointment = await prisma.appointment.create({
      data: {
        companyId: acme.company.id,
        scheduledAt: new Date(futureIso(3)),
        status: 'PENDING',
        createdVia: 'ai',
      },
    });
    const order = await prisma.order.create({
      data: {
        companyId: acme.company.id,
        status: 'NEW',
        totalAmount: '10.00',
        currency: 'JOD',
        createdVia: 'ai',
        items: {
          create: [
            {
              companyId: acme.company.id,
              name: 'Coffee Beans',
              quantity: 1,
              unitPrice: '10.00',
              currency: 'JOD',
            },
          ],
        },
      },
    });
    const ticket = await prisma.supportTicket.create({
      data: {
        companyId: acme.company.id,
        subject: 'Late delivery',
        status: 'OPEN',
        priority: 'HIGH',
        createdVia: 'ai',
      },
    });
    const execution = await prisma.aIActionExecution.create({
      data: {
        companyId: acme.company.id,
        actionKey: 'create_order',
        input: { items: [] },
        status: 'completed',
      },
    });
    return { appointment, order, ticket, execution };
  }

  it('lists executions/appointments/orders/tickets and updates statuses (any role)', async () => {
    const seeded = await seedRecords();

    const executions = await request(app)
      .get('/api/v1/actions/executions?status=completed&actionKey=create_order')
      .set(authHeader(acme.tokens.agent));
    expect(executions.status).toBe(200);
    expect(executions.body.data.pagination.total).toBe(1);
    expect(executions.body.data.items[0].actionKey).toBe('create_order');

    const appointments = await request(app)
      .get('/api/v1/actions/appointments')
      .set(authHeader(acme.tokens.agent));
    expect(appointments.status).toBe(200);
    expect(appointments.body.data.items).toHaveLength(1);

    const orders = await request(app)
      .get('/api/v1/actions/orders')
      .set(authHeader(acme.tokens.agent));
    expect(orders.status).toBe(200);
    expect(orders.body.data.items[0].items).toHaveLength(1);
    expect(orders.body.data.items[0].totalAmount).toBe('10');

    const tickets = await request(app)
      .get('/api/v1/actions/tickets')
      .set(authHeader(acme.tokens.agent));
    expect(tickets.status).toBe(200);
    expect(tickets.body.data.items[0].subject).toBe('Late delivery');

    // Status updates — AGENT is allowed (operational day-to-day work).
    const confirm = await request(app)
      .patch(`/api/v1/actions/appointments/${seeded.appointment.id}/status`)
      .set(authHeader(acme.tokens.agent))
      .send({ status: 'CONFIRMED' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.appointment.status).toBe('CONFIRMED');

    const fulfil = await request(app)
      .patch(`/api/v1/actions/orders/${seeded.order.id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'CONFIRMED' });
    expect(fulfil.status).toBe(200);
    expect(fulfil.body.data.order.status).toBe('CONFIRMED');

    const resolve = await request(app)
      .patch(`/api/v1/actions/tickets/${seeded.ticket.id}/status`)
      .set(authHeader(acme.tokens.admin))
      .send({ status: 'RESOLVED' });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.ticket.status).toBe('RESOLVED');

    // Invalid status value is rejected.
    const bad = await request(app)
      .patch(`/api/v1/actions/tickets/${seeded.ticket.id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'NOPE' });
    expect(bad.status).toBe(400);
  });

  it('is strictly tenant-isolated', async () => {
    const seeded = await seedRecords();
    const globex = await setupTenant('globex');

    for (const path of [
      '/api/v1/actions/executions',
      '/api/v1/actions/appointments',
      '/api/v1/actions/orders',
      '/api/v1/actions/tickets',
    ]) {
      const res = await request(app)
        .get(path)
        .set(authHeader(globex.tokens.owner));
      expect(res.status).toBe(200);
      expect(res.body.data.pagination.total).toBe(0);
    }

    const foreignPatch = await request(app)
      .patch(`/api/v1/actions/appointments/${seeded.appointment.id}/status`)
      .set(authHeader(globex.tokens.owner))
      .send({ status: 'CANCELLED' });
    expect(foreignPatch.status).toBe(404);

    // Unchanged for the owner tenant.
    const still = await prisma.appointment.findUnique({
      where: { id: seeded.appointment.id },
    });
    expect(still!.status).toBe('PENDING');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/actions/executions');
    expect(res.status).toBe(401);
  });
});

describe('AI_ACTIONS_ENABLED gate', () => {
  it('never advertises actions (and never parses requests) when disabled', async () => {
    process.env.AI_ACTIONS_ENABLED = 'false';
    const fake = makeFakeProvider({ text: 'Just a normal helpful answer.' });
    setAIProviderForTesting(fake.provider);

    const res = await mockInbound('g1', 'Can you book me a haircut?');
    expect(res.body.data.autoReply.generated).toBe(true);

    expect(fake.lastInput()!.systemPrompt).not.toContain('ACTION_REQUEST');
    expect(fake.lastInput()!.systemPrompt).not.toContain(
      'ACTIONS YOU CAN PERFORM',
    );
    expect(await prisma.aIActionExecution.count()).toBe(0);
  });

  it('advertises actions by default (flag unset)', async () => {
    const fake = makeFakeProvider({ text: 'A normal answer.' });
    setAIProviderForTesting(fake.provider);

    await mockInbound('g2', 'hello');
    expect(fake.lastInput()!.systemPrompt).toContain('ACTIONS YOU CAN PERFORM');
    expect(fake.lastInput()!.systemPrompt).toContain(
      'check_product_availability',
    );
  });
});
