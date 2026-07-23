import { createApp } from '../src/app';
import { setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting, setTranscriberForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import {
  setTelegramTransportForTesting,
  WhatsAppChannelProvider,
  FacebookChannelProvider,
} from '../src/modules/channels';
import { setBinaryFetcherForTesting } from '../src/utils/binary-fetch';
import {
  connectTelegram,
  makeTelegramTransport,
  telegramSecret,
  tgWebhook,
  tgVoiceUpdate,
} from './telegram-helpers';

const app = createApp();
const TRANSCRIPT = 'مرحبا اريد الاسعار';
const OGG_BYTES = Buffer.from('OggS-fake-voice-note-bytes');

let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  setTelegramTransportForTesting(makeTelegramTransport().transport);
  setBinaryFetcherForTesting(async () => ({
    ok: true,
    status: 200,
    buffer: OGG_BYTES,
    mimeType: 'audio/ogg',
  }));
  setTranscriberForTesting(async () => ({ text: TRANSCRIPT, model: 'whisper-1' }));
});
afterEach(() => {
  setTelegramTransportForTesting(null);
  setBinaryFetcherForTesting(null);
  setTranscriberForTesting(null);
  setAIProviderForTesting(null);
});

async function connected(tenant: Tenant) {
  const res = await connectTelegram(app, tenant.tokens.owner);
  const id = res.body.data.account.id as string;
  const secret = await telegramSecret(tenant.company.id, id);
  return { id, secret };
}

describe('Voice messages — Telegram webhook end-to-end', () => {
  it('stores an AUDIO message with public media URL + transcript; replay stays idempotent', async () => {
    const { id, secret } = await connected(acme);

    const res = await tgWebhook(app, id, tgVoiceUpdate({ updateId: 20, messageId: 77 }), secret);
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1);

    const msg = await prisma.message.findFirst({
      where: { companyId: acme.company.id, senderType: 'CUSTOMER' },
    });
    expect(msg?.contentType).toBe('AUDIO');
    expect(msg?.content).toBe(TRANSCRIPT);
    expect(msg?.mediaUrl).toContain('/api/v1/public/images/');
    expect((msg?.metadata as { transcription?: { model?: string } })?.transcription?.model).toBe('whisper-1');

    // The audio bytes are stored and served on the public media URL.
    const storedId = msg!.mediaUrl!.split('/').pop()!;
    const stored = await prisma.storedImage.findUnique({ where: { id: storedId } });
    expect(stored?.companyId).toBe(acme.company.id);
    expect(stored?.mimeType).toBe('audio/ogg');
    expect(stored?.fileName).toBe('voice-77');
    expect(Buffer.from(stored!.data)).toEqual(OGG_BYTES);

    // Idempotent replay (same update_id): no second message, no second image.
    const dup = await tgWebhook(app, id, tgVoiceUpdate({ updateId: 20, messageId: 77 }), secret);
    expect(dup.body.data.duplicates).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'CUSTOMER' } })).toBe(1);
    expect(await prisma.storedImage.count({ where: { companyId: acme.company.id } })).toBe(1);
  });

  it('auto-replies to the transcription like a normal text question', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'Voice AI reply.' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const { id, secret } = await connected(acme);

    await tgWebhook(app, id, tgVoiceUpdate({ updateId: 21, messageId: 78 }), secret);
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, channelType: 'TELEGRAM' },
    });
    const ai = await prisma.message.findFirst({
      where: { conversationId: conv!.id, senderType: 'AI' },
    });
    expect(ai?.content).toBe('Voice AI reply.');
  });

  it('keeps the AUDIO message with empty content and NO auto-reply when transcription is unavailable', async () => {
    const fake = makeFakeProvider({ text: 'Should never be generated.' });
    setAIProviderForTesting(fake.provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    setTranscriberForTesting(() => Promise.resolve(null));
    const { id, secret } = await connected(acme);

    const res = await tgWebhook(app, id, tgVoiceUpdate({ updateId: 22, messageId: 79 }), secret);
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1);

    const msg = await prisma.message.findFirst({
      where: { companyId: acme.company.id, senderType: 'CUSTOMER' },
    });
    expect(msg?.contentType).toBe('AUDIO');
    expect(msg?.content).toBe('');
    expect(msg?.mediaUrl).toContain('/api/v1/public/images/');

    // No auto-reply attempt without a transcript.
    expect(fake.calls).toHaveLength(0);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'AI' } })).toBe(0);
  });
});

describe('Voice messages — WhatsApp normalization', () => {
  it('normalizes an inbound audio message into an incoming_message with media', async () => {
    const provider = new WhatsAppChannelProvider();
    const events = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '1111111111' },
                  contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
                  messages: [
                    {
                      id: 'wamid.AUDIO.1',
                      from: '15551230000',
                      timestamp: '1710000000',
                      type: 'audio',
                      audio: { id: 'media-123', mime_type: 'audio/ogg; codecs=opus', voice: true },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      headers: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('incoming_message');
    if (events[0].kind === 'incoming_message') {
      expect(events[0].content).toBe('');
      expect(events[0].media).toEqual({
        kind: 'audio',
        providerMediaId: 'media-123',
        mimeType: 'audio/ogg; codecs=opus',
      });
      expect(events[0].metadata?.messageType).toBe('audio');
    }
  });
});

describe('Voice messages — Facebook normalization', () => {
  it('normalizes an audio attachment into an incoming_message carrying the CDN url', async () => {
    const provider = new FacebookChannelProvider();
    const events = await provider.parseWebhook({
      channelType: 'FACEBOOK',
      body: {
        object: 'page',
        entry: [
          {
            id: '100000000000123',
            messaging: [
              {
                sender: { id: '7788990011223344' },
                recipient: { id: '100000000000123' },
                timestamp: 1710000000000,
                message: {
                  mid: 'fb.audio.1',
                  attachments: [{ type: 'audio', payload: { url: 'https://cdn.fb.test/voice.mp4' } }],
                },
              },
            ],
          },
        ],
      },
      headers: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('incoming_message');
    if (events[0].kind === 'incoming_message') {
      expect(events[0].content).toBe('');
      expect(events[0].media).toEqual({ kind: 'audio', url: 'https://cdn.fb.test/voice.mp4' });
      expect(events[0].metadata?.messageType).toBe('audio');
    }
  });
});
