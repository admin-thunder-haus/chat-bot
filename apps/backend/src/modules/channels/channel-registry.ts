import type { ChannelType } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { isFakeChannelEnabled, isInstagramEnabled } from '../../config/env';
import type {
  ChannelCapabilities,
  ChannelProvider,
} from './providers/channel-provider.interface';
import { NO_CAPABILITIES } from './providers/channel-provider.interface';
import { FakeChannelProvider } from './providers/fake-channel.provider';
import { WebChatChannelProvider } from './providers/webchat-channel.provider';
import { WhatsAppChannelProvider } from './providers/whatsapp';
import { InstagramChannelProvider } from './providers/instagram';

/**
 * Public, safe descriptor of a provider for the dashboard "Channels" page.
 * `available` distinguishes providers that can actually be used now (fake)
 * from honest "coming soon" placeholders (WhatsApp, Instagram, …).
 */
export interface ChannelProviderDescriptor {
  key: string;
  displayName: string;
  channelType: ChannelType;
  capabilities: ChannelCapabilities;
  available: boolean;
  developmentOnly: boolean;
  configurationComplete: boolean;
  comingSoon: boolean;
}

/**
 * Honest descriptors for future platforms. These are NOT implemented providers —
 * they render as "coming soon / unavailable" and cannot be connected. Their
 * provider classes are added (and registered) in later phases.
 */
const FUTURE_PROVIDERS: ChannelProviderDescriptor[] = [
  {
    key: 'facebook',
    displayName: 'Facebook Messenger',
    channelType: 'FACEBOOK',
    capabilities: { ...NO_CAPABILITIES },
    available: false,
    developmentOnly: false,
    configurationComplete: false,
    comingSoon: true,
  },
  {
    key: 'telegram',
    displayName: 'Telegram',
    channelType: 'TELEGRAM',
    capabilities: { ...NO_CAPABILITIES },
    available: false,
    developmentOnly: false,
    configurationComplete: false,
    comingSoon: true,
  },
];

/**
 * Central provider registry. Providers are registered exactly once here (or via
 * dependency injection in tests); nothing else in the app instantiates provider
 * classes directly. Resolution by key/channelType is the single source of truth.
 */
class ChannelRegistry {
  private readonly providers = new Map<string, ChannelProvider>();

  register(provider: ChannelProvider): void {
    if (this.providers.has(provider.key)) {
      throw new Error(
        `Channel provider "${provider.key}" is already registered`,
      );
    }
    this.providers.set(provider.key, provider);
  }

  /** Register (or replace) a provider — for tests/DI only. */
  registerOrReplace(provider: ChannelProvider): void {
    this.providers.set(provider.key, provider);
  }

  unregister(key: string): void {
    this.providers.delete(key);
  }

  clear(): void {
    this.providers.clear();
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  /** Resolve a provider by key; returns null when unknown (no throw). */
  tryGet(key: string): ChannelProvider | null {
    return this.providers.get(key) ?? null;
  }

  /** Resolve a provider by key; throws a safe 400 when unknown. */
  get(key: string): ChannelProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw AppError.badRequest(`Unknown channel provider "${key}"`);
    }
    return provider;
  }

  /** Resolve the single registered provider for a channel type, if unambiguous. */
  getByChannelType(channelType: ChannelType): ChannelProvider | null {
    const matches = [...this.providers.values()].filter(
      (p) => p.channelType === channelType,
    );
    return matches.length === 1 ? matches[0] : null;
  }

  /** All registered (usable) providers. */
  list(): ChannelProvider[] {
    return [...this.providers.values()];
  }

  /** Safe descriptors for the UI: registered providers + future placeholders. */
  catalog(): ChannelProviderDescriptor[] {
    const registered: ChannelProviderDescriptor[] = this.list().map((p) => ({
      key: p.key,
      displayName: PROVIDER_DISPLAY_NAMES[p.key] ?? capitalize(p.key),
      channelType: p.channelType,
      capabilities: p.capabilities,
      available: true,
      developmentOnly: p.developmentOnly,
      configurationComplete: true,
      comingSoon: false,
    }));
    const registeredKeys = new Set(registered.map((r) => r.key));
    const future = FUTURE_PROVIDERS.filter((f) => !registeredKeys.has(f.key));
    return [...registered, ...future];
  }
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  fake: 'Fake / Test Channel',
  webchat: 'Web Chat',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const channelRegistry = new ChannelRegistry();

/**
 * Register the built-in providers. Called once at startup. The fake provider is
 * only registered when the development fake channel is enabled (never in prod),
 * so its public surface can never exist in production.
 */
export function registerBuiltInProviders(): void {
  // Web Chat is a REAL provider — always available in every environment.
  if (!channelRegistry.has('webchat')) {
    channelRegistry.register(new WebChatChannelProvider());
  }
  // WhatsApp Business Cloud API — a REAL provider, always available. Per-account
  // credentials are supplied at connect time (never via env).
  if (!channelRegistry.has('whatsapp')) {
    channelRegistry.register(new WhatsAppChannelProvider());
  }
  // Instagram Messaging (Meta) — a REAL provider. Per-account credentials are
  // supplied at connect time (never via env). Gated by INSTAGRAM_PROVIDER_ENABLED
  // so an environment can turn it off without code changes.
  if (isInstagramEnabled && !channelRegistry.has('instagram')) {
    channelRegistry.register(new InstagramChannelProvider());
  }
  // The fake/test provider is dev-only and never registered in production.
  if (isFakeChannelEnabled && !channelRegistry.has('fake')) {
    channelRegistry.register(new FakeChannelProvider());
  }
}

registerBuiltInProviders();
