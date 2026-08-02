import type { Company, Customer } from '@prisma/client';
import { companiesRepository } from '../companies/companies.repository';
import { businessHoursRepository } from '../business-hours/business-hours.repository';
import { ORDERED_DAYS } from '../business-hours/business-hours.types';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import type { RetrievalResult } from './ai-retrieval.service';

export interface BuiltContext {
  contextText: string;
  companyName: string;
  summary: {
    companyProfile: boolean;
    businessHoursIncluded: boolean;
    serviceIds: string[];
    productIds: string[];
    faqIds: string[];
    knowledgeIds: string[];
    documentIds: string[];
    approxCharacters: number;
  };
}

/** Image the AI reply should carry, resolved from a recommended item. */
export interface RecommendedAttachment {
  imageUrl: string;
  sourceType: 'service' | 'product';
  sourceId: string;
  sourceName: string;
}

function priceLabel(
  price: { toString(): string } | null,
  currency: string,
  priceType: string,
): string {
  if (priceType === 'CONTACT_US') return 'Contact us for pricing';
  if (priceType === 'FREE') return 'Free';
  if (priceType === 'VARIABLE') return 'Variable pricing';
  if (price === null) return 'Price on request';
  const prefix = priceType === 'STARTING_FROM' ? 'From ' : '';
  return `${prefix}${price.toString()} ${currency}`;
}

/**
 * Build a concise, deterministic, tenant-scoped company context. Only ACTIVE
 * records and the authenticated company's data are ever included, and the whole
 * block is capped at AI_CONTEXT_MAX_CHARACTERS.
 */
export const aiContextService = {
  async build(
    companyId: string,
    retrieval: RetrievalResult,
    customer: Customer | null,
  ): Promise<BuiltContext> {
    const company = await companiesRepository.findById(companyId);
    if (!company) throw AppError.notFound('Company not found');

    const budget = env.AI_CONTEXT_MAX_CHARACTERS;
    const sections: string[] = [];
    let used = 0;
    const add = (text: string): boolean => {
      if (used + text.length > budget) return false;
      sections.push(text);
      used += text.length;
      return true;
    };

    add(buildProfile(company, retrieval.includeContact));

    let businessHoursIncluded = false;
    if (retrieval.includeBusinessHours) {
      const rows = await businessHoursRepository.listByCompany(companyId);
      if (rows.length > 0) {
        const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
        const lines = ORDERED_DAYS.map((day) => {
          const r = byDay.get(day);
          const label = day.charAt(0) + day.slice(1).toLowerCase();
          if (!r || r.isClosed) return `${label}: Closed`;
          return `${label}: ${r.openTime}-${r.closeTime}`;
        });
        businessHoursIncluded = add(`BUSINESS HOURS\n${lines.join('\n')}\n`);
      }
    }

    const serviceIds: string[] = [];
    if (retrieval.services.length > 0) {
      const lines = retrieval.services.map((s) => {
        serviceIds.push(s.id);
        const price = priceLabel(s.price, s.currency, s.priceType);
        const desc = s.description ? ` — ${s.description}` : '';
        const dur = s.durationMinutes ? ` (${s.durationMinutes} min)` : '';
        return `- ${s.name}: ${price}${dur}${desc}`;
      });
      add(`SERVICES\n${lines.join('\n')}\n`);
    }

    const productIds: string[] = [];
    if (retrieval.products.length > 0) {
      const lines = retrieval.products.map((p) => {
        productIds.push(p.id);
        const price =
          p.price === null
            ? 'Price on request'
            : `${p.price.toString()} ${p.currency}`;
        const stock =
          p.stockQuantity === null
            ? ''
            : p.stockQuantity > 0
              ? ' (in stock)'
              : ' (out of stock)';
        const cat = p.category ? ` [${p.category}]` : '';
        const desc = p.description ? ` — ${p.description}` : '';
        return `- ${p.name}${cat}: ${price}${stock}${desc}`;
      });
      add(`PRODUCTS\n${lines.join('\n')}\n`);
    }

    const faqIds: string[] = [];
    if (retrieval.faqs.length > 0) {
      const lines = retrieval.faqs.map((f) => {
        faqIds.push(f.id);
        return `Q: ${f.question}\nA: ${f.answer}`;
      });
      add(`FAQS\n${lines.join('\n')}\n`);
    }

    const knowledgeIds: string[] = [];
    if (retrieval.knowledge.length > 0) {
      const lines = retrieval.knowledge.map((k) => {
        knowledgeIds.push(k.id);
        return `${k.title}: ${k.content}`;
      });
      add(`KNOWLEDGE BASE\n${lines.join('\n')}\n`);
    }

    // Relevant excerpts from uploaded PDF documents. Grouped under one block
    // with the source file named, so the model can ground answers in them.
    const documentIds: string[] = [];
    if (retrieval.documentChunks.length > 0) {
      const lines = retrieval.documentChunks.map((c) => {
        if (!documentIds.includes(c.documentId)) documentIds.push(c.documentId);
        return `[${c.fileName}] ${c.content}`;
      });
      add(`DOCUMENTS (excerpts from the company's uploaded files)\n${lines.join('\n---\n')}\n`);
    }

    if (customer) {
      const name =
        customer.fullName || customer.username || 'the customer';
      add(`CUSTOMER\nYou are speaking with: ${name}\n`);
    }

    const contextText = sections.join('\n');
    return {
      contextText,
      companyName: company.displayName || company.name,
      summary: {
        companyProfile: true,
        businessHoursIncluded,
        serviceIds,
        productIds,
        faqIds,
        knowledgeIds,
        documentIds,
        approxCharacters: contextText.length,
      },
    };
  },

  /**
   * Pick the image to attach to an AI reply: the retrieved service/product
   * that (a) has an image and (b) is mentioned in the generated text —
   * tolerating partial mentions ("CRM Pro" for "CRM Pro License"), which
   * happen routinely when the model replies in another language and
   * translates the generic part of a name. Deterministic — the model never
   * sees or emits URLs; the attachment rides out-of-band next to the text.
   *
   * A reply naming SEVERAL items gets no attachment at all. A message carries
   * one photo, so a five-item price list would ship with a single picture of
   * whichever name happened to match best — which reads as though that one item
   * is the answer, and leaves the customer wondering why the others have no
   * photo. Nothing is the honest attachment for a list; the customer names the
   * item they want to see and that reply carries its photo.
   */
  /**
   * How many retrieved services/products the reply names.
   *
   * Callers need to tell "named nothing" from "named several": both leave the
   * reply without an attachment, but only the first is a case where guessing a
   * picture helps. Guessing on the second illustrates a list with one of its
   * rows.
   */
  countNamedItems(responseText: string, retrieval: RetrievalResult): number {
    const lowered = responseText.toLowerCase();
    let count = 0;
    for (const s of retrieval.services) {
      if (mentionScore(lowered, s.name) >= 0) count += 1;
    }
    for (const p of retrieval.products) {
      if (mentionScore(lowered, p.name) >= 0) count += 1;
    }
    return count;
  },

  findRecommendedAttachment(
    responseText: string,
    retrieval: RetrievalResult,
  ): RecommendedAttachment | null {
    const lowered = responseText.toLowerCase();

    let best: RecommendedAttachment | null = null;
    let bestScore = -1;
    let spelledOut = 0;

    const consider = (
      item: { id: string; name: string; imageUrl: string | null },
      sourceType: 'service' | 'product',
    ) => {
      const score = mentionScore(lowered, item.name);
      // Whole names only. A partial-token match is NOT evidence of a second
      // item: "Basic Wash" scores against "I recommend our Premium Wash"
      // purely because both end in "wash", and counting that would strip the
      // photo from a reply about one service. Items with no image count too —
      // a list of five where one has a photo is still a list.
      if (isSpelledOut(score)) spelledOut += 1;
      if (!item.imageUrl) return;
      if (score > bestScore) {
        bestScore = score;
        best = {
          imageUrl: item.imageUrl,
          sourceType,
          sourceId: item.id,
          sourceName: item.name,
        };
      }
    };

    for (const s of retrieval.services) consider(s, 'service');
    for (const p of retrieval.products) consider(p, 'product');

    if (spelledOut >= 2 || looksLikeItemList(responseText)) return null;
    return bestScore >= 0 ? best : null;
  },

  /**
   * Fallback used when the customer explicitly asked for a photo but the reply
   * text names nothing matchable (e.g. an apologetic or very short answer).
   * Returns the FIRST retrieved product with an image, then the first service —
   * products first because photo requests are overwhelmingly about goods, and
   * retrieval order is already relevance-ranked.
   */
  firstAttachmentCandidate(
    retrieval: RetrievalResult,
  ): RecommendedAttachment | null {
    const product = retrieval.products.find((p) => p.imageUrl);
    if (product?.imageUrl) {
      return {
        imageUrl: product.imageUrl,
        sourceType: 'product',
        sourceId: product.id,
        sourceName: product.name,
      };
    }
    const service = retrieval.services.find((s) => s.imageUrl);
    if (service?.imageUrl) {
      return {
        imageUrl: service.imageUrl,
        sourceType: 'service',
        sourceId: service.id,
        sourceName: service.name,
      };
    }
    return null;
  },
};

/**
 * Explicit "send me a photo" intent. Multilingual and deliberately
 * noun-anchored so ordinary questions never trigger it.
 *
 * Arabic notes: the boundary guards matter — `مشكلة` ("problem") contains
 * `شكل`, and `بصورة عامة` ("generally") contains `صور`; both must stay FALSE.
 * The optional `ال`/`و`/`ف` prefixes keep `الصورة` and `وصورة` TRUE.
 */
const IMAGE_REQUEST_PATTERNS: RegExp[] = [
  // English nouns (whole word): photo(s), picture(s), image(s), pic(s), snapshot.
  /\b(photos?|photograph|pictures?|images?|pics?|snapshots?)\b/i,
  // Arabic: صورة / صور / الصور / صورته …
  /(^|[^ء-ي])(ال|و|ف|)صور/,
  // Arabic: شكل / الشكل / شكله ("how does it look")
  /(^|[^ء-ي])(ال|)شكل/,
];

/** True when the customer is asking to SEE the item, not just to hear about it. */
export function detectImageRequest(text: string): boolean {
  return IMAGE_REQUEST_PATTERNS.some((re) => re.test(text));
}

// Words too generic to identify WHICH catalog item a reply refers to. A name
// consisting only of these (e.g. "Premium Support Plan") still matches via
// the full-name path, never via single generic words.
const GENERIC_NAME_TOKENS = new Set([
  'license', 'licence', 'plan', 'pack', 'kit', 'bundle', 'set',
  'add', 'addon', 'addons', 'on',
  'service', 'services', 'product', 'products', 'support',
  'hour', 'hours', 'standard', 'premium', 'basic', 'starter',
  'pro', 'plus', 'custom', 'the', 'and', 'for', 'with', 'of', 'a', 'an',
]);

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((t) => t.length >= 2);
}

/** Whole-word occurrence check (boundaries = anything non-alphanumeric). */
function tokenInText(lowered: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(^|[^a-z0-9؀-ۿ])${escaped}([^a-z0-9؀-ۿ]|$)`,
  ).test(lowered);
}

/**
 * How strongly `name` is mentioned in the (lowercased) reply; -1 = not
 * mentioned. Full-name substring outranks everything; otherwise EVERY
 * distinctive token of the name must appear, and the count of matched tokens
 * ranks competing items ("CRM Pro" prefers "CRM Pro License" over
 * "CRM Basic License").
 */
/**
 * Did the reply spell this item's name out in full? {@link mentionScore} adds
 * the 1000 band only for a verbatim whole-name hit, which is the one signal
 * strong enough to say "the reply is talking about THIS item" rather than
 * "the reply happens to share a word with it".
 */
function isSpelledOut(score: number): boolean {
  return score >= 1000;
}

/**
 * Does the reply read as a list of items?
 *
 * A second, independent signal to the whole-name count, and it catches what
 * that misses: a list written in the customer's language, where translated
 * names never match verbatim. Tied to the bullet layout the formatting rules
 * require, so the two move together.
 */
function looksLikeItemList(responseText: string): boolean {
  const bulletLines = responseText
    .split(/\r?\n/)
    .filter((line) => /^\s*[••\-*]\s+\S/.test(line)).length;
  return bulletLines >= 2;
}

function mentionScore(lowered: string, name: string): number {
  const full = name.toLowerCase().trim();
  const tokens = tokenizeName(name);
  if (full.length > 0 && lowered.includes(full)) {
    return 1000 + tokens.length;
  }

  const distinctive = tokens.filter((t) => !GENERIC_NAME_TOKENS.has(t));
  if (distinctive.length === 0) return -1;
  if (!distinctive.every((t) => tokenInText(lowered, t))) return -1;

  return tokens.filter((t) => tokenInText(lowered, t)).length;
}

function buildProfile(company: Company, includeContact: boolean): string {
  const lines: string[] = [
    'COMPANY PROFILE',
    `Name: ${company.displayName || company.name}`,
  ];
  if (company.industry) lines.push(`Industry: ${company.industry}`);
  if (company.description) lines.push(`About: ${company.description}`);
  if (includeContact) {
    if (company.email) lines.push(`Email: ${company.email}`);
    if (company.phone) lines.push(`Phone: ${company.phone}`);
    if (company.whatsappNumber) lines.push(`WhatsApp: ${company.whatsappNumber}`);
    if (company.websiteUrl) lines.push(`Website: ${company.websiteUrl}`);
    const location = [company.address, company.city, company.country]
      .filter(Boolean)
      .join(', ');
    if (location) lines.push(`Location: ${location}`);
  }
  return `${lines.join('\n')}\n`;
}
