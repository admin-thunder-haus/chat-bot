import { WebChatChannelProvider } from '../src/modules/channels';

describe('Web Chat provider (reference real provider)', () => {
  const provider = new WebChatChannelProvider();

  it('is a real provider (not dev-only) for the WEBCHAT channel', () => {
    expect(provider.key).toBe('webchat');
    expect(provider.channelType).toBe('WEBCHAT');
    expect(provider.developmentOnly).toBe(false);
  });

  it('advertises text + inbound/outbound capabilities', () => {
    expect(provider.capabilities.textMessages).toBe(true);
    expect(provider.capabilities.inboundMessaging).toBe(true);
    expect(provider.capabilities.outboundMessaging).toBe(true);
    expect(provider.capabilities.typingIndicators).toBe(true);
    expect(provider.capabilities.mediaMessages).toBe(true);
  });

  it('initializes an account with a public widget key + default config', () => {
    const init = provider.initializeAccount({ displayName: 'Site chat' });
    expect(init.publicId).toMatch(/^wc_/);
    expect(init.connectionState).toBe('HEALTHY');
    expect((init.metadata as { webchat?: unknown }).webchat).toBeDefined();
  });

  it('normalizes an inbound widget payload into a standard event', async () => {
    const events = await provider.parseWebhook({
      channelType: 'WEBCHAT',
      body: {
        externalMessageId: 'm1',
        visitorId: 'v1',
        content: 'Hello',
        visitor: { name: 'Sam' },
      },
      headers: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('incoming_message');
    if (events[0].kind === 'incoming_message') {
      expect(events[0].externalMessageId).toBe('m1');
      expect(events[0].customer.externalCustomerId).toBe('v1');
      expect(events[0].content).toBe('Hello');
    }
  });

  it('ignores a malformed inbound payload', async () => {
    const events = await provider.parseWebhook({
      channelType: 'WEBCHAT',
      body: { visitorId: 'v1' },
      headers: {},
    });
    expect(events).toHaveLength(0);
  });

  it('acknowledges outbound sends (poll transport) and reports HEALTHY', async () => {
    const sent = await provider.sendMessage({ channelType: 'WEBCHAT', text: 'hi' });
    expect(sent.status).toBe('sent');
    expect(sent.externalMessageId).toMatch(/^webchat-out-/);
    const health = await provider.checkConnection({});
    expect(health.state).toBe('HEALTHY');
  });
});
