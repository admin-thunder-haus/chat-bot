import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { aiContextService } from '../src/modules/ai/ai-context.service';
import type { RetrievalResult } from '../src/modules/ai/ai-retrieval.service';
import {
  WhatsAppChannelProvider,
  setWhatsAppTransportForTesting,
  type WhatsAppHttpRequest,
} from '../src/modules/channels/providers/whatsapp';
import {
  TelegramChannelProvider,
  setTelegramTransportForTesting,
  type TelegramHttpRequest,
} from '../src/modules/channels/providers/telegram';

/**
 * AI image responses: when a reply recommends a service/product that has an
 * image, the image travels with the reply — through the shared pipeline on
 * media-capable channels, gracefully text-only elsewhere.
 */

const app = createApp();
const whatsAppProvider = new WhatsAppChannelProvider();
const telegramProvider = new TelegramChannelProvider();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});
afterEach(() => {
  setAIProviderForTesting(null);
  setWhatsAppTransportForTesting(null);
  setTelegramTransportForTesting(null);
});

function retrieval(overrides: Partial<RetrievalResult>): RetrievalResult {
  return {
    services: [],
    products: [],
    faqs: [],
    knowledge: [],
    documentChunks: [],
    includeBusinessHours: false,
    includeContact: false,
    usedFallback: false,
    ...overrides,
  };
}

function fakeService(name: string, imageUrl: string | null) {
  return {
    id: `svc-${name}`,
    companyId: 'c1',
    name,
    description: null,
    price: null,
    currency: 'JOD',
    priceType: 'CONTACT_US' as const,
    durationMinutes: null,
    imageUrl,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakeProduct(name: string, imageUrl: string | null) {
  return {
    id: `prd-${name}`,
    companyId: 'c1',
    name,
    description: null,
    sku: null,
    category: null,
    price: null,
    currency: 'JOD',
    stockQuantity: null,
    imageUrl,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('findRecommendedAttachment', () => {
  it('picks the first mentioned service that has an image', () => {
    const r = retrieval({
      services: [
        fakeService('Basic Wash', null),
        fakeService('Premium Wash', 'https://img.example.com/premium.jpg'),
      ],
    });
    const hit = aiContextService.findRecommendedAttachment(
      'I recommend our Premium Wash for that.',
      r,
    );
    expect(hit).toEqual({
      imageUrl: 'https://img.example.com/premium.jpg',
      sourceType: 'service',
      sourceId: 'svc-Premium Wash',
      sourceName: 'Premium Wash',
    });
  });

  it('matches product names case-insensitively', () => {
    const r = retrieval({
      products: [fakeProduct('Espresso Machine', 'https://img.example.com/em.jpg')],
    });
    const hit = aiContextService.findRecommendedAttachment(
      'the ESPRESSO MACHINE is on sale.',
      r,
    );
    expect(hit?.sourceType).toBe('product');
  });

  it('matches a partial mention in a translated reply (production repro)', () => {
    const r = retrieval({
      products: [
        fakeProduct('CRM Pro License', 'https://img.example.com/crm.png'),
      ],
    });
    // The model translated "License" to Arabic and kept only "CRM Pro".
    const hit = aiContextService.findRecommendedAttachment(
      'مرحباً! سعر ترخيص CRM Pro هو 120 دينار أردني. يشمل الترخيص السنوي التحديثات والدعم.',
      r,
    );
    expect(hit?.sourceName).toBe('CRM Pro License');
  });

  it('prefers the item with the strongest token match', () => {
    const r = retrieval({
      products: [
        fakeProduct('CRM Basic License', 'https://img.example.com/basic.png'),
        fakeProduct('CRM Pro License', 'https://img.example.com/pro.png'),
      ],
    });
    const hit = aiContextService.findRecommendedAttachment(
      'I suggest CRM Pro for your team size.',
      r,
    );
    expect(hit?.sourceName).toBe('CRM Pro License');
  });

  it('does not match on generic words alone', () => {
    const r = retrieval({
      services: [
        fakeService('Premium Support Plan', 'https://img.example.com/s.png'),
      ],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'We offer premium support to all customers on every plan.',
        r,
      ),
    ).toBeNull();
  });

  it('returns null when nothing with an image is mentioned', () => {
    const r = retrieval({
      services: [fakeService('Premium Wash', 'https://img.example.com/p.jpg')],
      products: [fakeProduct('Grinder', null)],
    });
    expect(
      aiContextService.findRecommendedAttachment(
        'We also offer a Grinder and general detailing.',
        r,
      ),
    ).toBeNull();
  });
});

describe('auto-reply attaches images on the local (webchat/manual) path', () => {
  async function enableAutoReply() {
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
  }

  function mockInbound(content: string) {
    return request(app)
      .post('/api/v1/dev/mock-inbound-message')
      .set(authHeader(acme.tokens.owner))
      .send({
        channelType: 'MANUAL',
        externalCustomerId: 'cust-img',
        customer: { fullName: 'Imogen Photo' },
        message: { externalMessageId: `m-${Date.now()}`, content },
      });
  }

  it('persists mediaUrl + IMAGE content type when the reply names an imaged service', async () => {
    await enableAutoReply();
    await prisma.businessService.create({
      data: {
        companyId: acme.company.id,
        name: 'Premium Wash',
        description: 'Full detailing package',
        priceType: 'CONTACT_US',
        imageUrl: 'https://img.example.com/premium.jpg',
      },
    });
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'Our Premium Wash would be perfect for you!',
      }).provider,
    );

    const res = await mockInbound('Tell me about your premium wash');
    expect(res.body.data.autoReply.generated).toBe(true);

    const ai = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(ai?.mediaUrl).toBe('https://img.example.com/premium.jpg');
    expect(ai?.contentType).toBe('IMAGE');
  });

  it('stays TEXT when the recommended service has no image', async () => {
    await enableAutoReply();
    await prisma.businessService.create({
      data: {
        companyId: acme.company.id,
        name: 'Premium Wash',
        priceType: 'CONTACT_US',
      },
    });
    setAIProviderForTesting(
      makeFakeProvider({ text: 'Our Premium Wash is great.' }).provider,
    );

    const res = await mockInbound('premium wash?');
    const ai = await prisma.message.findFirst({
      where: {
        conversationId: res.body.data.conversation.id,
        senderType: 'AI',
      },
    });
    expect(ai?.mediaUrl).toBeNull();
    expect(ai?.contentType).toBe('TEXT');
  });
});

describe('providers send images when mediaUrl is set', () => {
  it('WhatsApp switches to an image payload with caption', async () => {
    const requests: WhatsAppHttpRequest[] = [];
    setWhatsAppTransportForTesting({
      async request(input) {
        requests.push(input);
        return {
          status: 200,
          ok: true,
          json: { messages: [{ id: 'wamid.1' }] },
        };
      },
    });

    const result = await whatsAppProvider.sendMessage({
      channelType: 'WHATSAPP',
      externalAccountId: 'phone-1',
      externalCustomerId: '9627900001',
      text: 'Here is our Premium Wash',
      mediaUrl: 'https://img.example.com/premium.jpg',
      credentials: {
        accessToken: 'tok',
        appSecret: 'secret',
        verifyToken: 'verify',
      },
    });

    expect(result.status).toBe('sent');
    const body = requests[0].body as {
      type: string;
      image: { link: string; caption?: string };
    };
    expect(body.type).toBe('image');
    expect(body.image.link).toBe('https://img.example.com/premium.jpg');
    expect(body.image.caption).toBe('Here is our Premium Wash');
  });

  it('Telegram uses sendPhoto with caption', async () => {
    const requests: TelegramHttpRequest[] = [];
    setTelegramTransportForTesting({
      async request(input) {
        requests.push(input);
        return {
          status: 200,
          ok: true,
          json: { ok: true, result: { message_id: 42 } },
        };
      },
    });

    const result = await telegramProvider.sendMessage({
      channelType: 'TELEGRAM',
      externalCustomerId: 'chat-77',
      text: 'Espresso Machine!',
      mediaUrl: 'https://img.example.com/em.jpg',
      credentials: { botToken: "123:abc", secretToken: "whsec" },
    });

    expect(result.status).toBe('sent');
    expect(requests[0].url).toContain('/sendPhoto');
    const body = requests[0].body as { photo: string; caption?: string };
    expect(body.photo).toBe('https://img.example.com/em.jpg');
    expect(body.caption).toBe('Espresso Machine!');
  });

  it('WhatsApp still sends plain text when no mediaUrl is given', async () => {
    const requests: WhatsAppHttpRequest[] = [];
    setWhatsAppTransportForTesting({
      async request(input) {
        requests.push(input);
        return {
          status: 200,
          ok: true,
          json: { messages: [{ id: 'wamid.2' }] },
        };
      },
    });

    await whatsAppProvider.sendMessage({
      channelType: 'WHATSAPP',
      externalAccountId: 'phone-1',
      externalCustomerId: '9627900001',
      text: 'Plain text',
      credentials: {
        accessToken: 'tok',
        appSecret: 'secret',
        verifyToken: 'verify',
      },
    });

    expect((requests[0].body as { type: string }).type).toBe('text');
  });
});
