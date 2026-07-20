import { createCipheriv, randomBytes } from 'node:crypto';
import {
  PrismaClient,
  ChannelType,
  ConversationPriority,
  ConversationStatus,
  DayOfWeek,
  ReplyTone,
  ServicePriceType,
} from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Development seed: a demo company with realistic Day 2 business configuration.
 * Idempotent — running it repeatedly does not create duplicate records
 * (upserts on natural keys / clears+reinserts child collections). Refuses to
 * run in production.
 *
 *   Owner login: owner@demo.com / Demo12345
 *   Admin login: admin@demo.com / Demo12345
 *   Agent login: agent@demo.com / Demo12345
 */
const prisma = new PrismaClient();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the seed script in production.');
  }

  const password = 'Demo12345';
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // --- Company + profile (Day 2 fields) ---
  const company = await prisma.company.upsert({
    where: { slug: 'demo-company' },
    update: {
      displayName: 'Demo Support Co.',
      description:
        'A demo company showcasing the AI customer support platform.',
      industry: 'Software',
      email: 'hello@demo.com',
      phone: '+962790000000',
      whatsappNumber: '+962790000000',
      websiteUrl: 'https://demo.example.com',
      address: '123 King Hussein St',
      city: 'Amman',
      country: 'Jordan',
      timezone: 'Asia/Amman',
      defaultLanguage: 'ar',
      responseLanguage: 'auto',
    },
    create: {
      name: 'Demo Company',
      slug: 'demo-company',
      status: 'ACTIVE',
      displayName: 'Demo Support Co.',
      description:
        'A demo company showcasing the AI customer support platform.',
      industry: 'Software',
      email: 'hello@demo.com',
      phone: '+962790000000',
      whatsappNumber: '+962790000000',
      websiteUrl: 'https://demo.example.com',
      address: '123 King Hussein St',
      city: 'Amman',
      country: 'Jordan',
      timezone: 'Asia/Amman',
      defaultLanguage: 'ar',
      responseLanguage: 'auto',
    },
  });

  // --- Users (owner + admin + agent for role testing) ---
  const users = [
    { email: 'owner@demo.com', fullName: 'Demo Owner', role: 'OWNER' as const },
    { email: 'admin@demo.com', fullName: 'Demo Admin', role: 'ADMIN' as const },
    { email: 'agent@demo.com', fullName: 'Demo Agent', role: 'AGENT' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        companyId: company.id,
        fullName: u.fullName,
        email: u.email,
        passwordHash,
        role: u.role,
        status: 'ACTIVE',
      },
    });
  }

  // --- Services (3) — upsert on the unique [companyId, name] ---
  const services = [
    {
      name: 'Standard Consultation',
      description: 'A 30-minute consultation with a specialist.',
      price: '25.00',
      priceType: ServicePriceType.FIXED,
      durationMinutes: 30,
      sortOrder: 1,
    },
    {
      name: 'Premium Support Plan',
      description: 'Monthly premium support with priority responses.',
      price: '99.00',
      priceType: ServicePriceType.STARTING_FROM,
      durationMinutes: null,
      sortOrder: 2,
    },
    {
      name: 'Custom Integration',
      description: 'Tailored integration work — priced per project.',
      price: null,
      priceType: ServicePriceType.CONTACT_US,
      durationMinutes: null,
      sortOrder: 3,
    },
  ];
  for (const s of services) {
    await prisma.businessService.upsert({
      where: { companyId_name: { companyId: company.id, name: s.name } },
      update: {
        description: s.description,
        price: s.price,
        priceType: s.priceType,
        durationMinutes: s.durationMinutes,
        currency: 'JOD',
        isActive: true,
        sortOrder: s.sortOrder,
      },
      create: {
        companyId: company.id,
        name: s.name,
        description: s.description,
        price: s.price,
        priceType: s.priceType,
        durationMinutes: s.durationMinutes,
        currency: 'JOD',
        isActive: true,
        sortOrder: s.sortOrder,
      },
    });
  }

  // --- Business hours (7 days) — upsert on [companyId, dayOfWeek] ---
  const weekend: DayOfWeek[] = [DayOfWeek.FRIDAY, DayOfWeek.SATURDAY];
  const allDays = Object.values(DayOfWeek);
  for (const day of allDays) {
    const isClosed = weekend.includes(day);
    await prisma.businessHour.upsert({
      where: { companyId_dayOfWeek: { companyId: company.id, dayOfWeek: day } },
      update: {
        isClosed,
        openTime: isClosed ? null : '09:00',
        closeTime: isClosed ? null : '18:00',
      },
      create: {
        companyId: company.id,
        dayOfWeek: day,
        isClosed,
        openTime: isClosed ? null : '09:00',
        closeTime: isClosed ? null : '18:00',
      },
    });
  }

  // --- FAQs (3) — idempotent via clear + insert scoped to the demo company ---
  await prisma.frequentlyAskedQuestion.deleteMany({
    where: { companyId: company.id },
  });
  await prisma.frequentlyAskedQuestion.createMany({
    data: [
      {
        companyId: company.id,
        question: 'What are your working hours?',
        answer: 'We are open Sunday to Thursday, 9:00 to 18:00.',
        category: 'General',
        sortOrder: 1,
      },
      {
        companyId: company.id,
        question: 'Do you offer refunds?',
        answer: 'Yes, within 14 days of purchase for eligible services.',
        category: 'Billing',
        sortOrder: 2,
      },
      {
        companyId: company.id,
        question: 'How can I contact support?',
        answer: 'You can reach us via WhatsApp or email at hello@demo.com.',
        category: 'Support',
        sortOrder: 3,
      },
    ],
  });

  // --- Knowledge base (3) — idempotent via clear + insert ---
  await prisma.knowledgeBaseEntry.deleteMany({
    where: { companyId: company.id },
  });
  await prisma.knowledgeBaseEntry.createMany({
    data: [
      {
        companyId: company.id,
        title: 'Return Policy',
        content:
          'Customers may return eligible products within 14 days of delivery. Items must be unused and in original packaging.',
        category: 'Policies',
        tags: ['returns', 'policy'],
        sortOrder: 1,
      },
      {
        companyId: company.id,
        title: 'Shipping Information',
        content:
          'We ship within Jordan in 2-4 business days. International shipping is available on request.',
        category: 'Shipping',
        tags: ['shipping', 'delivery'],
        sortOrder: 2,
      },
      {
        companyId: company.id,
        title: 'Getting Started Guide',
        content:
          'To get started, create an account, verify your email, and connect your first channel.',
        category: 'Onboarding',
        tags: ['guide', 'onboarding'],
        sortOrder: 3,
      },
    ],
  });

  // --- Default AI settings (one-to-one) ---
  await prisma.companyAISettings.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      assistantName: 'Demo Assistant',
      replyTone: ReplyTone.FRIENDLY,
      preferredLanguage: 'auto',
      useEmojis: true,
      autoReplyEnabled: false, // stays off until AI + channels exist
    },
  });

  await seedDay3(company.id);
  await seedDay4(company.id);
  await seedDay5(company.id);
  await seedWebChat(company.id);
  await seedWhatsApp(company.id);

  // eslint-disable-next-line no-console
  console.log(
    `✅ Seed complete.\n   Company: ${company.name} (${company.slug})\n   Logins:  owner@demo.com / admin@demo.com / agent@demo.com  (password: ${password})`,
  );
}

/**
 * Day 3 demo inbox data. Idempotent: all conversations/customers for the demo
 * company are cleared first (cascades to messages/notes/activities/tag links),
 * then recreated, so repeated runs never accumulate duplicates.
 */
async function seedDay3(companyId: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
  });
  const agent = await prisma.user.findFirst({
    where: { companyId, role: 'AGENT' },
  });
  if (!owner || !agent) return;

  // Reset (cascade wipes conversations/messages/notes/activities/tag links).
  await prisma.customer.deleteMany({ where: { companyId } });

  // Tags (idempotent on [companyId, name]).
  const tagDefs = [
    { name: 'Sales', color: '#2563eb' },
    { name: 'Support', color: '#16a34a' },
    { name: 'Billing', color: '#f59e0b' },
    { name: 'Urgent', color: '#dc2626' },
  ];
  const tags = [] as { id: string; name: string }[];
  for (const t of tagDefs) {
    const tag = await prisma.conversationTag.upsert({
      where: { companyId_name: { companyId, name: t.name } },
      update: { color: t.color },
      create: { companyId, name: t.name, color: t.color },
    });
    tags.push({ id: tag.id, name: tag.name });
  }
  const tagByName = (n: string) => tags.find((t) => t.name === n)!;

  const base = Date.now();
  const at = (minutesAgo: number) => new Date(base - minutesAgo * 60_000);

  // Three demo customers.
  const [ahmad, layla, sami] = await Promise.all([
    prisma.customer.create({
      data: {
        companyId,
        channelType: ChannelType.MANUAL,
        externalId: 'demo-customer-001',
        fullName: 'Ahmad Ali',
        phone: '+962790000001',
        email: 'ahmad@example.com',
        username: 'ahmad.ali',
        firstSeenAt: at(600),
        lastSeenAt: at(5),
      },
    }),
    prisma.customer.create({
      data: {
        companyId,
        channelType: ChannelType.WEBCHAT,
        externalId: 'demo-customer-002',
        fullName: 'Layla Hassan',
        email: 'layla@example.com',
        username: 'layla.h',
        firstSeenAt: at(480),
        lastSeenAt: at(60),
      },
    }),
    prisma.customer.create({
      data: {
        companyId,
        channelType: ChannelType.MANUAL,
        externalId: 'demo-customer-003',
        fullName: 'Sami Nasser',
        phone: '+962790000003',
        firstSeenAt: at(300),
        lastSeenAt: at(120),
      },
    }),
  ]);

  // Helper to create a conversation with messages + activities.
  async function makeConversation(opts: {
    customerId: string;
    channelType: ChannelType;
    status: ConversationStatus;
    priority: ConversationPriority;
    subject?: string;
    assignedUserId?: string;
    unreadCount: number;
    tagNames: string[];
    messages: {
      direction: 'INBOUND' | 'OUTBOUND';
      content: string;
      minutesAgo: number;
    }[];
    notes?: { content: string; minutesAgo: number }[];
  }): Promise<void> {
    const last = opts.messages[opts.messages.length - 1];
    const lastInbound = [...opts.messages].reverse().find((m) => m.direction === 'INBOUND');
    const lastOutbound = [...opts.messages].reverse().find((m) => m.direction === 'OUTBOUND');

    const conversation = await prisma.conversation.create({
      data: {
        companyId,
        customerId: opts.customerId,
        channelType: opts.channelType,
        status: opts.status,
        priority: opts.priority,
        subject: opts.subject ?? null,
        assignedUserId: opts.assignedUserId ?? null,
        unreadCount: opts.unreadCount,
        lastMessageAt: at(last.minutesAgo),
        lastInboundMessageAt: lastInbound ? at(lastInbound.minutesAgo) : null,
        lastOutboundMessageAt: lastOutbound ? at(lastOutbound.minutesAgo) : null,
        resolvedAt: opts.status === 'RESOLVED' ? at(last.minutesAgo) : null,
        closedAt: opts.status === 'CLOSED' ? at(last.minutesAgo) : null,
      },
    });

    await prisma.conversationActivity.create({
      data: {
        companyId,
        conversationId: conversation.id,
        actorUserId: owner!.id,
        activityType: 'CONVERSATION_CREATED',
        createdAt: at(last.minutesAgo + 1),
      },
    });

    for (const m of opts.messages) {
      await prisma.message.create({
        data: {
          companyId,
          conversationId: conversation.id,
          customerId: opts.customerId,
          senderUserId: m.direction === 'OUTBOUND' ? owner!.id : null,
          direction: m.direction,
          senderType: m.direction === 'OUTBOUND' ? 'AGENT' : 'CUSTOMER',
          content: m.content,
          status: m.direction === 'OUTBOUND' ? 'SENT' : 'RECEIVED',
          sentAt: at(m.minutesAgo),
          createdAt: at(m.minutesAgo),
        },
      });
      await prisma.conversationActivity.create({
        data: {
          companyId,
          conversationId: conversation.id,
          actorUserId: m.direction === 'OUTBOUND' ? owner!.id : null,
          activityType: m.direction === 'OUTBOUND' ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED',
          createdAt: at(m.minutesAgo),
        },
      });
    }

    for (const tagName of opts.tagNames) {
      await prisma.conversationTagAssignment.create({
        data: { companyId, conversationId: conversation.id, tagId: tagByName(tagName).id },
      });
    }

    for (const note of opts.notes ?? []) {
      await prisma.internalNote.create({
        data: {
          companyId,
          conversationId: conversation.id,
          authorUserId: agent!.id,
          content: note.content,
          createdAt: at(note.minutesAgo),
        },
      });
      await prisma.conversationActivity.create({
        data: {
          companyId,
          conversationId: conversation.id,
          actorUserId: agent!.id,
          activityType: 'NOTE_ADDED',
          createdAt: at(note.minutesAgo),
        },
      });
    }
  }

  // 1. OPEN, unread, tagged Sales — assigned to the agent.
  await makeConversation({
    customerId: ahmad.id,
    channelType: ChannelType.MANUAL,
    status: ConversationStatus.OPEN,
    priority: ConversationPriority.HIGH,
    subject: 'Pricing question',
    assignedUserId: agent.id,
    unreadCount: 1,
    tagNames: ['Sales', 'Urgent'],
    messages: [
      { direction: 'INBOUND', content: 'Hello, I want to know your prices.', minutesAgo: 30 },
      { direction: 'OUTBOUND', content: 'Hi Ahmad! Happy to help — which service?', minutesAgo: 25 },
      { direction: 'INBOUND', content: 'The premium support plan.', minutesAgo: 5 },
    ],
    notes: [{ content: 'Interested in premium — follow up today.', minutesAgo: 4 }],
  });

  // 2. PENDING, WEBCHAT, tagged Support.
  await makeConversation({
    customerId: layla.id,
    channelType: ChannelType.WEBCHAT,
    status: ConversationStatus.PENDING,
    priority: ConversationPriority.NORMAL,
    subject: 'Login issue',
    unreadCount: 0,
    tagNames: ['Support'],
    messages: [
      { direction: 'INBOUND', content: 'I cannot log into my account.', minutesAgo: 120 },
      { direction: 'OUTBOUND', content: 'Sorry to hear that — can you try a password reset?', minutesAgo: 90 },
    ],
    notes: [{ content: 'Waiting on customer to confirm reset.', minutesAgo: 80 }],
  });

  // 3. RESOLVED, tagged Billing.
  await makeConversation({
    customerId: sami.id,
    channelType: ChannelType.MANUAL,
    status: ConversationStatus.RESOLVED,
    priority: ConversationPriority.LOW,
    subject: 'Invoice request',
    unreadCount: 0,
    tagNames: ['Billing'],
    messages: [
      { direction: 'INBOUND', content: 'Can you send me last month invoice?', minutesAgo: 260 },
      { direction: 'OUTBOUND', content: 'Sent to your email. Anything else?', minutesAgo: 250 },
      { direction: 'INBOUND', content: 'Got it, thank you!', minutesAgo: 245 },
    ],
  });

  // 4. OPEN, unread, no assignment/tags.
  await makeConversation({
    customerId: layla.id,
    channelType: ChannelType.WEBCHAT,
    status: ConversationStatus.OPEN,
    priority: ConversationPriority.NORMAL,
    subject: 'Feature request',
    unreadCount: 2,
    tagNames: [],
    messages: [
      { direction: 'INBOUND', content: 'Do you support dark mode?', minutesAgo: 70 },
      { direction: 'INBOUND', content: 'It would be great to have it.', minutesAgo: 65 },
    ],
  });
}

/**
 * Day 4 demo data: a long conversation (40 messages, to exceed the message page
 * limit and exercise "load older"), plus clearly-marked DEMO AI generation and
 * usage records. No OpenAI call is ever made during seeding. Idempotent: prior
 * AI rows for the demo company are cleared first.
 */
async function seedDay4(companyId: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
  });
  if (!owner) return;

  // A customer for the long thread (upsert by natural key).
  const customer = await prisma.customer.upsert({
    where: {
      companyId_channelType_externalId: {
        companyId,
        channelType: ChannelType.WHATSAPP,
        externalId: 'demo-long-thread-001',
      },
    },
    update: {},
    create: {
      companyId,
      channelType: ChannelType.WHATSAPP,
      externalId: 'demo-long-thread-001',
      fullName: 'Nadia Long',
      phone: '+962790001234',
    },
  });

  // Recreate the long conversation deterministically each run.
  await prisma.conversation.deleteMany({
    where: { companyId, customerId: customer.id },
  });

  const base = Date.now();
  const at = (minsAgo: number) => new Date(base - minsAgo * 60_000);
  const TOTAL = 40;

  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      customerId: customer.id,
      channelType: ChannelType.WHATSAPP,
      status: ConversationStatus.OPEN,
      priority: ConversationPriority.NORMAL,
      subject: 'Long support thread',
      lastMessageAt: at(1),
      lastInboundMessageAt: at(2),
      lastOutboundMessageAt: at(1),
    },
  });

  for (let i = 0; i < TOTAL; i++) {
    const inbound = i % 2 === 0;
    const ts = at(TOTAL - i); // oldest first
    await prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        customerId: customer.id,
        senderUserId: inbound ? null : owner.id,
        direction: inbound ? 'INBOUND' : 'OUTBOUND',
        senderType: inbound ? 'CUSTOMER' : 'AGENT',
        content: inbound
          ? `Customer question #${i + 1}: could you help with item ${i + 1}?`
          : `Agent reply #${i + 1}: sure, here is the info for item ${i + 1}.`,
        status: inbound ? 'RECEIVED' : 'SENT',
        createdAt: ts,
        sentAt: ts,
      },
    });
  }

  // --- Demo AI generation + usage records (clearly marked as demo) ---
  await prisma.aIResponseGeneration.deleteMany({ where: { companyId } });
  await prisma.aIResponseGeneration.createMany({
    data: [
      {
        companyId,
        conversationId: conversation.id,
        generationType: 'DRAFT',
        status: 'COMPLETED',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptVersion: 'v1-2025-06',
        inputTokenCount: 320,
        outputTokenCount: 90,
        totalTokenCount: 410,
        estimatedCostUsd: '0.000102',
        latencyMs: 850,
        responseText: '[DEMO] Sample AI draft generated during seeding.',
        contextSummary: { demo: true } as object,
        completedAt: at(30),
        createdAt: at(30),
      },
      {
        companyId,
        conversationId: conversation.id,
        generationType: 'PLAYGROUND',
        status: 'COMPLETED',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptVersion: 'v1-2025-06',
        inputTokenCount: 210,
        outputTokenCount: 70,
        totalTokenCount: 280,
        estimatedCostUsd: '0.000074',
        latencyMs: 640,
        responseText: '[DEMO] Sample playground answer generated during seeding.',
        contextSummary: { demo: true } as object,
        completedAt: at(20),
        createdAt: at(20),
      },
    ],
  });

  const today = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ),
  );
  await prisma.aIUsageDaily.upsert({
    where: { companyId_date: { companyId, date: today } },
    update: {},
    create: {
      companyId,
      date: today,
      requestCount: 2,
      inputTokenCount: 530,
      outputTokenCount: 160,
      totalTokenCount: 690,
      estimatedCostUsd: '0.000176',
    },
  });
}

/**
 * Day 5 Part 1 demo data: one development fake channel account (healthy), a
 * conversation bound to it with inbound/outbound messages, a ChannelDelivery
 * row, and safe webhook-event examples. Idempotent: the account is upserted on
 * its natural key and its demo conversation/webhook rows are recreated each run.
 * No real secrets are stored and no external API is ever called.
 */
async function seedDay5(companyId: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
  });
  if (!owner) return;

  const capabilities = {
    textMessages: true,
    mediaMessages: false,
    messageReplies: true,
    deliveryReceipts: true,
    readReceipts: true,
    typingIndicators: false,
    reactions: false,
    templates: false,
    customerProfiles: true,
    webhookVerification: true,
    webhookSignatures: true,
    outboundMessaging: true,
    inboundMessaging: true,
  };

  const now = new Date();
  const account = await prisma.channelAccount.upsert({
    where: {
      companyId_providerKey_externalAccountId: {
        companyId,
        providerKey: 'fake',
        externalAccountId: 'demo-fake-account',
      },
    },
    update: {
      displayName: 'Fake / Test Channel',
      status: 'CONNECTED',
      connectionState: 'HEALTHY',
      isEnabled: true,
      capabilities,
      metadata: { environment: 'development', note: 'Development test channel' },
      connectedAt: now,
      lastHealthCheckAt: now,
      lastHealthyAt: now,
      // Day 5 Part 2: demo health-monitoring counters.
      healthScore: 90,
      successCount: 3,
      failureCount: 1,
      consecutiveFailures: 0,
      lastSuccessfulDeliveryAt: now,
    },
    create: {
      companyId,
      providerKey: 'fake',
      channelType: ChannelType.MANUAL,
      displayName: 'Fake / Test Channel',
      externalAccountId: 'demo-fake-account',
      status: 'CONNECTED',
      connectionState: 'HEALTHY',
      isEnabled: true,
      capabilities,
      metadata: { environment: 'development', note: 'Development test channel' },
      connectedAt: now,
      lastHealthCheckAt: now,
      lastHealthyAt: now,
      healthScore: 90,
      successCount: 3,
      failureCount: 1,
      consecutiveFailures: 0,
      lastSuccessfulDeliveryAt: now,
    },
  });

  // Idempotency: clear Part 2 history rows scoped to this demo account.
  await prisma.channelHealthCheck.deleteMany({
    where: { channelAccountId: account.id },
  });

  // Demo customer for the fake channel (upsert by natural key).
  const customer = await prisma.customer.upsert({
    where: {
      companyId_channelType_externalId: {
        companyId,
        channelType: ChannelType.MANUAL,
        externalId: 'demo-fake-customer',
      },
    },
    update: {},
    create: {
      companyId,
      channelType: ChannelType.MANUAL,
      externalId: 'demo-fake-customer',
      fullName: 'Fatima Test',
      username: 'fatima.test',
    },
  });

  // Recreate the demo conversation + its rows deterministically each run.
  await prisma.conversation.deleteMany({
    where: { companyId, channelAccountId: account.id },
  });
  await prisma.channelWebhookEvent.deleteMany({
    where: { channelAccountId: account.id },
  });

  const at = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000);

  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      customerId: customer.id,
      channelType: ChannelType.MANUAL,
      channelAccountId: account.id,
      providerKey: 'fake',
      status: ConversationStatus.OPEN,
      priority: ConversationPriority.NORMAL,
      subject: 'Fake channel demo',
      unreadCount: 1,
      lastMessageAt: at(2),
      lastInboundMessageAt: at(2),
      lastOutboundMessageAt: at(6),
    },
  });

  await prisma.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hi, is anyone there?',
      status: 'RECEIVED',
      externalMessageId: 'fake-in-seed-1',
      sentAt: at(10),
      createdAt: at(10),
    },
  });
  const outbound = await prisma.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      customerId: customer.id,
      senderUserId: owner.id,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      content: 'Hello! Yes, how can we help you today?',
      status: 'SENT',
      externalMessageId: 'fake-out-seed-1',
      sentAt: at(6),
      createdAt: at(6),
    },
  });
  await prisma.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Great, thanks!',
      status: 'RECEIVED',
      externalMessageId: 'fake-in-seed-2',
      sentAt: at(2),
      createdAt: at(2),
    },
  });

  // Delivery record for the outbound message (delivered) with Part 2 metadata.
  const delivery = await prisma.channelDelivery.create({
    data: {
      companyId,
      channelAccountId: account.id,
      messageId: outbound.id,
      providerKey: 'fake',
      externalMessageId: 'fake-out-seed-1',
      status: 'DELIVERED',
      attemptCount: 1,
      maxAttempts: 3,
      failureType: 'NONE',
      lastAttemptAt: at(6),
      idempotencyKey: `out-${outbound.id}`,
      requestedAt: at(6),
      sentAt: at(6),
      deliveredAt: at(5),
      providerMetadata: { simulated: true },
    },
  });

  // One successful delivery attempt (retry history example).
  await prisma.channelDeliveryAttempt.create({
    data: {
      companyId,
      channelAccountId: account.id,
      deliveryId: delivery.id,
      attemptNumber: 1,
      status: 'SUCCESS',
      providerKey: 'fake',
      failureType: 'NONE',
      latencyMs: 42,
      startedAt: at(6),
      completedAt: at(6),
    },
  });

  // Health-check history samples (delivery-derived + a manual probe).
  await prisma.channelHealthCheck.createMany({
    data: [
      {
        companyId,
        channelAccountId: account.id,
        checkType: 'DELIVERY',
        state: 'HEALTHY',
        healthy: true,
        healthScore: 90,
        latencyMs: 42,
        source: 'delivery',
        createdAt: at(6),
      },
      {
        companyId,
        channelAccountId: account.id,
        checkType: 'MANUAL',
        state: 'HEALTHY',
        healthy: true,
        healthScore: 90,
        source: 'manual',
        createdAt: at(3),
      },
    ],
  });

  // Safe webhook-event examples (hash + summary only — no raw payloads).
  await prisma.channelWebhookEvent.createMany({
    data: [
      {
        companyId,
        channelAccountId: account.id,
        providerKey: 'fake',
        eventType: 'incoming_message',
        externalEventId: 'demo-evt-1',
        status: 'PROCESSED',
        rawPayloadHash: 'demo-hash-1',
        normalizedPayload: { kind: 'incoming_message', contentLength: 21 },
        receivedAt: at(10),
        processedAt: at(10),
      },
      {
        companyId,
        channelAccountId: account.id,
        providerKey: 'fake',
        eventType: 'unsupported',
        externalEventId: 'demo-evt-2',
        status: 'IGNORED',
        rawPayloadHash: 'demo-hash-2',
        normalizedPayload: { kind: 'reaction' },
        receivedAt: at(8),
        processedAt: at(8),
      },
    ],
  });

  // Channel activity examples.
  await prisma.channelActivity.deleteMany({
    where: { companyId, channelAccountId: account.id },
  });
  await prisma.channelActivity.createMany({
    data: [
      {
        companyId,
        channelAccountId: account.id,
        actorUserId: owner.id,
        activityType: 'CHANNEL_ACCOUNT_CONNECTED',
        createdAt: at(30),
      },
      {
        companyId,
        channelAccountId: account.id,
        conversationId: conversation.id,
        activityType: 'WEBHOOK_RECEIVED',
        metadata: { source: 'seed' },
        createdAt: at(10),
      },
    ],
  });
}

/**
 * Day 5 Part 3 demo data: a REAL Web Chat channel (the first real provider) with
 * a fixed public widget key, default config, and a sample visitor conversation.
 * Idempotent — upserts the account and recreates its demo conversation. No
 * external service is contacted.
 */
async function seedWebChat(companyId: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
  });
  if (!owner) return;

  const webchatConfig = {
    title: 'Chat with Demo Support',
    welcomeMessage: 'Hi! 👋 How can we help you today?',
    themeColor: '#2563eb',
    position: 'right',
    locale: 'en',
    launcherText: 'Chat',
    agentLabel: 'Support',
    assistantLabel: 'Assistant',
    allowedOrigins: [],
  };

  const account = await prisma.channelAccount.upsert({
    where: {
      companyId_providerKey_externalAccountId: {
        companyId,
        providerKey: 'webchat',
        externalAccountId: 'demo-webchat',
      },
    },
    update: {
      displayName: 'Website Chat',
      status: 'CONNECTED',
      connectionState: 'HEALTHY',
      isEnabled: true,
      metadata: { webchat: webchatConfig },
    },
    create: {
      companyId,
      providerKey: 'webchat',
      channelType: ChannelType.WEBCHAT,
      displayName: 'Website Chat',
      externalAccountId: 'demo-webchat',
      // Fixed, public demo widget key (safe to embed; unique across the DB).
      publicId: 'wc_demo_public_widget_key',
      status: 'CONNECTED',
      connectionState: 'HEALTHY',
      isEnabled: true,
      healthScore: 100,
      capabilities: {
        textMessages: true,
        inboundMessaging: true,
        outboundMessaging: true,
        messageReplies: true,
        typingIndicators: true,
        customerProfiles: true,
      },
      metadata: { webchat: webchatConfig },
      connectedAt: new Date(),
      lastHealthyAt: new Date(),
    },
  });

  // Demo visitor (anonymous Web Chat customer) — upsert by natural key.
  const visitor = await prisma.customer.upsert({
    where: {
      companyId_channelType_externalId: {
        companyId,
        channelType: ChannelType.WEBCHAT,
        externalId: 'wcv_demo_visitor',
      },
    },
    update: {},
    create: {
      companyId,
      channelType: ChannelType.WEBCHAT,
      externalId: 'wcv_demo_visitor',
      fullName: 'Website Visitor',
      username: 'visitor',
    },
  });

  // Recreate the demo conversation deterministically each run.
  await prisma.conversation.deleteMany({
    where: { companyId, channelAccountId: account.id },
  });
  const now = Date.now();
  const at = (m: number) => new Date(now - m * 60_000);

  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      customerId: visitor.id,
      channelType: ChannelType.WEBCHAT,
      channelAccountId: account.id,
      providerKey: 'webchat',
      status: ConversationStatus.OPEN,
      priority: ConversationPriority.NORMAL,
      subject: 'Website chat',
      unreadCount: 1,
      lastMessageAt: at(3),
      lastInboundMessageAt: at(3),
      lastOutboundMessageAt: at(5),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        companyId,
        conversationId: conversation.id,
        customerId: visitor.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hi, is anyone available?',
        status: 'RECEIVED',
        externalMessageId: 'webchat-demo-1',
        sentAt: at(8),
        createdAt: at(8),
      },
      {
        companyId,
        conversationId: conversation.id,
        customerId: visitor.id,
        senderUserId: owner.id,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        content: 'Hello! Yes — how can we help you today?',
        status: 'SENT',
        sentAt: at(5),
        createdAt: at(5),
      },
      {
        companyId,
        conversationId: conversation.id,
        customerId: visitor.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Do you ship internationally?',
        status: 'RECEIVED',
        externalMessageId: 'webchat-demo-2',
        sentAt: at(3),
        createdAt: at(3),
      },
    ],
  });
}

/**
 * Day 6 demo data: a REAL WhatsApp channel account with DUMMY (clearly fake)
 * credentials, encrypted at rest exactly like a real connect. It demonstrates
 * the Channels dashboard + a WhatsApp conversation without contacting Meta (a
 * health check would report AUTH_EXPIRED against the fake token — expected).
 * Skipped gracefully when the encryption key is absent. Idempotent.
 */
async function seedWhatsApp(companyId: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { companyId, role: 'OWNER' },
  });
  if (!owner) return;

  const rawKey = process.env.CHANNEL_CREDENTIAL_ENCRYPTION_KEY;
  const key = rawKey ? Buffer.from(rawKey, 'base64') : null;
  if (!key || key.length !== 32) {
    // eslint-disable-next-line no-console
    console.log(
      '   (skipped WhatsApp demo: CHANNEL_CREDENTIAL_ENCRYPTION_KEY not set)',
    );
    return;
  }

  // Inline AES-256-GCM to match channelSecurityService's stored format
  // (base64(iv).base64(tag).base64(ciphertext)) WITHOUT importing config/env.
  const encrypt = (plaintext: Record<string, unknown>): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(plaintext), 'utf8'),
      cipher.final(),
    ]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ct.toString('base64'),
    ].join('.');
  };

  const phoneNumberId = 'demo-wa-phone-000';
  const wabaId = 'demo-wa-waba-000';
  const capabilities = {
    textMessages: true,
    messageReplies: true,
    deliveryReceipts: true,
    readReceipts: true,
    customerProfiles: true,
    outboundMessaging: true,
    inboundMessaging: true,
    webhookVerification: true,
    webhookSignatures: true,
    mediaMessages: false,
    templates: false,
  };
  const metadata = {
    whatsapp: {
      phoneNumberId,
      wabaId,
      displayPhoneNumber: '+1 555 000 0000',
      businessName: 'Demo Support Co.',
    },
  };

  const account = await prisma.channelAccount.upsert({
    where: {
      companyId_providerKey_externalAccountId: {
        companyId,
        providerKey: 'whatsapp',
        externalAccountId: phoneNumberId,
      },
    },
    update: {
      displayName: 'WhatsApp Business',
      status: 'CONNECTED',
      isEnabled: true,
      metadata,
    },
    create: {
      companyId,
      providerKey: 'whatsapp',
      channelType: ChannelType.WHATSAPP,
      displayName: 'WhatsApp Business',
      externalAccountId: phoneNumberId,
      externalPageId: wabaId,
      status: 'CONNECTED',
      connectionState: 'UNKNOWN',
      isEnabled: true,
      capabilities,
      metadata,
      connectedAt: new Date(),
    },
  });

  // Encrypted DUMMY credentials (never real). Upsert keeps the seed idempotent.
  const encrypted = encrypt({
    accessToken: 'DEMO-whatsapp-access-token-not-real',
    appSecret: 'demo-whatsapp-app-secret',
    verifyToken: 'demo-whatsapp-verify-token',
  });
  await prisma.channelCredential.upsert({
    where: { channelAccountId: account.id },
    update: { encryptedPayload: encrypted, encryptionVersion: 'v1' },
    create: {
      companyId,
      channelAccountId: account.id,
      encryptedPayload: encrypted,
      encryptionVersion: 'v1',
    },
  });

  // A demo WhatsApp conversation (customer identified by phone / wa_id).
  const customer = await prisma.customer.upsert({
    where: {
      companyId_channelType_externalId: {
        companyId,
        channelType: ChannelType.WHATSAPP,
        externalId: '15551234567',
      },
    },
    update: {},
    create: {
      companyId,
      channelType: ChannelType.WHATSAPP,
      externalId: '15551234567',
      fullName: 'WhatsApp Customer',
      phone: '15551234567',
    },
  });
  await prisma.conversation.deleteMany({
    where: { companyId, channelAccountId: account.id },
  });
  const now = Date.now();
  const at = (m: number) => new Date(now - m * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      customerId: customer.id,
      channelType: ChannelType.WHATSAPP,
      channelAccountId: account.id,
      providerKey: 'whatsapp',
      status: ConversationStatus.OPEN,
      priority: ConversationPriority.NORMAL,
      subject: 'WhatsApp enquiry',
      unreadCount: 1,
      lastMessageAt: at(2),
      lastInboundMessageAt: at(2),
      lastOutboundMessageAt: at(4),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        companyId,
        conversationId: conversation.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hi! Do you deliver on weekends?',
        status: 'RECEIVED',
        externalMessageId: 'wamid.DEMO.in.1',
        sentAt: at(6),
        createdAt: at(6),
      },
      {
        companyId,
        conversationId: conversation.id,
        customerId: customer.id,
        senderUserId: owner.id,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        content: 'Hello! Yes, we deliver 7 days a week. 🚚',
        status: 'SENT',
        externalMessageId: 'wamid.DEMO.out.1',
        sentAt: at(4),
        createdAt: at(4),
      },
      {
        companyId,
        conversationId: conversation.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Perfect, thank you!',
        status: 'RECEIVED',
        externalMessageId: 'wamid.DEMO.in.2',
        sentAt: at(2),
        createdAt: at(2),
      },
    ],
  });
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
