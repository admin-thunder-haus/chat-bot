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
   */
  findRecommendedAttachment(
    responseText: string,
    retrieval: RetrievalResult,
  ): RecommendedAttachment | null {
    const lowered = responseText.toLowerCase();

    let best: RecommendedAttachment | null = null;
    let bestScore = -1;

    const consider = (
      item: { id: string; name: string; imageUrl: string | null },
      sourceType: 'service' | 'product',
    ) => {
      if (!item.imageUrl) return;
      const score = mentionScore(lowered, item.name);
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

    return bestScore >= 0 ? best : null;
  },
};

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
