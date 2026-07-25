import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import {
  aiContextService,
  detectImageRequest,
} from '../src/modules/ai/ai-context.service';
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

describe('detectImageRequest', () => {
  it('is true for English photo requests', () => {
    expect(detectImageRequest('Can you send me a photo of product 5?')).toBe(true);
    expect(detectImageRequest('Do you have pictures?')).toBe(true);
    expect(detectImageRequest('any IMAGES of the terminal')).toBe(true);
    expect(detectImageRequest('send a pic please')).toBe(true);
  });

  it('is true for Arabic photo requests (production repro)', () => {
    expect(detectImageRequest('ابعتلي صورة للبرودكت الخمس')).toBe(true);
    expect(detectImageRequest('بدي صور للمنتجات')).toBe(true);
    expect(detectImageRequest('الصورة موجودة؟')).toBe(true);
    expect(detectImageRequest('شو شكله؟')).toBe(true);
  });

  it('is false for ordinary questions', () => {
    expect(detectImageRequest('How much does the CRM Pro License cost?')).toBe(
      false,
    );
    expect(detectImageRequest('كم سعر البرودكت الخمس؟')).toBe(false);
    // "مشكلة" contains شكل and "بشكل عام" contains شكل — neither is a photo ask.
    expect(detectImageRequest('عندي مشكلة في الطلب')).toBe(false);
    expect(detectImageRequest('بشكل عام كم التوصيل؟')).toBe(false);
  });
});

describe('firstAttachmentCandidate', () => {
  it('prefers the first imaged product, then falls back to services', () => {
    const r = retrieval({
      services: [fakeService('Setup', 'https://img.example.com/setup.png')],
      products: [
        fakeProduct('No Photo', null),
        fakeProduct('Has Photo', 'https://img.example.com/p.png'),
      ],
    });
    expect(aiContextService.firstAttachmentCandidate(r)).toEqual({
      imageUrl: 'https://img.example.com/p.png',
      sourceType: 'product',
      sourceId: 'prd-Has Photo',
      sourceName: 'Has Photo',
    });
    expect(
      aiContextService.firstAttachmentCandidate(
        retrieval({
          services: [fakeService('Setup', 'https://img.example.com/setup.png')],
        }),
      )?.sourceType,
    ).toBe('service');
  });

  it('returns null when nothing has an image', () => {
    expect(
      aiContextService.firstAttachmentCandidate(
        retrieval({ products: [fakeProduct('Plain', null)] }),
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

  it('attaches a photo for an explicit Arabic photo request even when the reply names nothing (production repro)', async () => {
    await enableAutoReply();
    await prisma.product.create({
      data: {
        companyId: acme.company.id,
        name: 'POS Terminal X1',
        price: '250',
        currency: 'JOD',
        imageUrl: 'https://img.example.com/pos.jpg',
      },
    });
    // The reply the model actually sent in production: an apology that names
    // no item at all — findRecommendedAttachment can never match it.
    setAIProviderForTesting(
      makeFakeProvider({ text: 'آسف، لا أستطيع مساعدتك بهذا الطلب.' }).provider,
    );

    const res = await mockInbound('ابعتلي صورة للمنتج');
    expect(res.body.data.autoReply.generated).toBe(true);
    const ai = await prisma.message.findFirst({
      where: { conversationId: res.body.data.conversation.id, senderType: 'AI' },
    });
    expect(ai?.mediaUrl).toBe('https://img.example.com/pos.jpg');
    expect(ai?.contentType).toBe('IMAGE');
  });

  it('does not attach a photo when the customer did not ask for one', async () => {
    await enableAutoReply();
    await prisma.product.create({
      data: {
        companyId: acme.company.id,
        name: 'POS Terminal X1',
        price: '250',
        currency: 'JOD',
        imageUrl: 'https://img.example.com/pos.jpg',
      },
    });
    setAIProviderForTesting(
      makeFakeProvider({ text: 'Our prices start at 250 JOD.' }).provider,
    );

    const res = await mockInbound('كم سعر التوصيل؟');
    const ai = await prisma.message.findFirst({
      where: { conversationId: res.body.data.conversation.id, senderType: 'AI' },
    });
    expect(ai?.mediaUrl).toBeNull();
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
