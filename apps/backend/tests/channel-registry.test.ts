import { channelRegistry } from '../src/modules/channels';
import { FakeChannelProvider } from '../src/modules/channels';
import type { ChannelProvider } from '../src/modules/channels';

function makeProvider(key: string): ChannelProvider {
  const base = new FakeChannelProvider();
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'key') return key;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (target as any)[prop];
    },
  }) as ChannelProvider;
}

describe('Channel provider registry', () => {
  const TEST_KEY = 'test-provider-xyz';

  afterEach(() => {
    channelRegistry.unregister(TEST_KEY);
  });

  it('has the built-in fake provider registered', () => {
    expect(channelRegistry.has('fake')).toBe(true);
    expect(channelRegistry.get('fake').key).toBe('fake');
  });

  it('registers and resolves a provider by key', () => {
    channelRegistry.register(makeProvider(TEST_KEY));
    expect(channelRegistry.has(TEST_KEY)).toBe(true);
    expect(channelRegistry.get(TEST_KEY).key).toBe(TEST_KEY);
    expect(channelRegistry.tryGet(TEST_KEY)?.key).toBe(TEST_KEY);
  });

  it('rejects duplicate registration of the same key', () => {
    channelRegistry.register(makeProvider(TEST_KEY));
    expect(() => channelRegistry.register(makeProvider(TEST_KEY))).toThrow(
      /already registered/,
    );
  });

  it('returns a safe error for an unknown provider', () => {
    expect(() => channelRegistry.get('does-not-exist')).toThrow(
      /Unknown channel provider/,
    );
    expect(channelRegistry.tryGet('does-not-exist')).toBeNull();
  });

  it('exposes provider capabilities', () => {
    const caps = channelRegistry.get('fake').capabilities;
    expect(caps.textMessages).toBe(true);
    expect(caps.outboundMessaging).toBe(true);
    expect(caps.inboundMessaging).toBe(true);
    expect(caps.mediaMessages).toBe(false);
  });

  it('lists an honest catalog: fake + webchat + whatsapp + instagram available, future providers coming soon', () => {
    const catalog = channelRegistry.catalog();
    const fake = catalog.find((p) => p.key === 'fake');
    const webchat = catalog.find((p) => p.key === 'webchat');
    const whatsapp = catalog.find((p) => p.key === 'whatsapp');
    const instagram = catalog.find((p) => p.key === 'instagram');
    expect(fake?.available).toBe(true);
    expect(fake?.developmentOnly).toBe(true);
    // Web Chat is a REAL provider (Day 5 Part 3) — available, not dev-only.
    expect(webchat?.available).toBe(true);
    expect(webchat?.developmentOnly).toBe(false);
    // WhatsApp is a REAL provider (Day 6) — available, not dev-only.
    expect(whatsapp?.available).toBe(true);
    expect(whatsapp?.developmentOnly).toBe(false);
    // Instagram (Day 7) + Facebook Messenger (Day 8) are REAL providers.
    expect(instagram?.available).toBe(true);
    expect(instagram?.developmentOnly).toBe(false);
    expect(instagram?.comingSoon).toBe(false);
    // Facebook Messenger (Day 8) + Telegram (Day 9) are REAL providers now.
    for (const key of ['facebook', 'telegram']) {
      expect(catalog.find((p) => p.key === key)?.available).toBe(true);
      expect(catalog.find((p) => p.key === key)?.comingSoon).toBe(false);
    }
    // No "coming soon" placeholders remain.
    expect(catalog.every((p) => p.comingSoon === false)).toBe(true);
  });
});
