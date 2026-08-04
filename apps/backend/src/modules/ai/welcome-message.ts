import { detectLanguage } from '../../utils/language-detect';

/**
 * The greeting a customer gets on their very first message, before the
 * assistant answers anything.
 *
 * It exists because a first contact that opens with a bare answer reads as a
 * machine talking to itself — the customer does not yet know who picked up, or
 * that anyone did. The greeting names the business, says an assistant is
 * replying, and invites the actual question.
 *
 * WHOSE NAME IS ON IT. The business's, always. The customer messaged a barber
 * shop, not the platform that runs its inbox, and greeting them by the
 * platform's name would be actively confusing. The platform appears once, in a
 * small attribution line underneath — visible enough to be seen by every
 * customer of every tenant, quiet enough not to intrude on the relationship.
 */

/** Shown in the attribution line under every greeting. */
export const PLATFORM_BRAND = 'Thunder.AI';

/**
 * Where the attribution line points.
 *
 * Bare URL, no markdown link syntax: these channels render our text verbatim,
 * so `[Thunder.AI](https://…)` would arrive with the brackets visible while
 * every one of them auto-links a plain URL on its own.
 */
export const PLATFORM_URL = 'https://ai.thunder-haus.com/';

/**
 * Languages with a hand-written greeting. Anything else falls back to English
 * rather than machine-translating, because a greeting is the one message where
 * awkward phrasing is most visible.
 */
type WelcomeLocale = 'ar' | 'en';

function resolveLocale(
  preferredLanguage: string,
  customerMessage: string,
): WelcomeLocale {
  if (preferredLanguage === 'ar') return 'ar';
  if (preferredLanguage === 'en') return 'en';
  // 'auto': mirror the customer, exactly as the assistant's own replies do.
  return detectLanguage(customerMessage) === 'ar' ? 'ar' : 'en';
}

/**
 * Emoji use is deliberate and bounded: one on the greeting line, one on the
 * invitation. A greeting is where warmth belongs, but a wall of emoji reads as
 * spam — and on the channels this ships to, spam is what gets an account
 * reported.
 */
function defaultBody(locale: WelcomeLocale, companyName: string): string {
  if (locale === 'ar') {
    return [
      `أهلاً وسهلاً بك في ${companyName} 👋`,
      '',
      'أنا المساعد الذكي هون، جاهز أساعدك على مدار الساعة — اسألني عن خدماتنا أو منتجاتنا أو أي استفسار عندك.',
      '',
      'كيف بقدر أساعدك؟ ✨',
    ].join('\n');
  }
  return [
    `Welcome to ${companyName} 👋`,
    '',
    "I'm the assistant here, available any time — ask me about our services, our products, or anything else you need.",
    '',
    'How can I help? ✨',
  ].join('\n');
}

function attribution(locale: WelcomeLocale): string {
  return locale === 'ar'
    ? `⚡ مدعوم بواسطة ${PLATFORM_BRAND} — ${PLATFORM_URL}`
    : `⚡ Powered by ${PLATFORM_BRAND} — ${PLATFORM_URL}`;
}

/**
 * Build the greeting. `customMessage` (a company's own wording) replaces the
 * body only — the attribution line is appended either way, so a company cannot
 * remove it by writing its own text, and cannot accidentally duplicate it by
 * including it.
 */
export function buildWelcomeMessage(input: {
  companyName: string;
  preferredLanguage: string;
  customerMessage: string;
  customMessage?: string | null;
}): string {
  const locale = resolveLocale(input.preferredLanguage, input.customerMessage);
  const custom = input.customMessage?.trim();
  const body = custom || defaultBody(locale, input.companyName);
  const line = attribution(locale);
  // A company that pasted the attribution into its own text gets one line, not
  // two — cheaper to tolerate here than to police in validation.
  if (body.includes(PLATFORM_BRAND)) return body;
  return `${body}\n\n${line}`;
}
