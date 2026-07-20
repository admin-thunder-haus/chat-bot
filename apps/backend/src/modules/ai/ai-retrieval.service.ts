import type {
  BusinessService,
  FrequentlyAskedQuestion,
  KnowledgeBaseEntry,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';

/**
 * Day 4 retrieval is deterministic KEYWORD search over PostgreSQL — NOT semantic
 * / vector search. It is tenant-scoped and only ever reads ACTIVE records. The
 * interface is intentionally simple so embeddings can replace or augment it later.
 */

export interface RetrievalResult {
  services: BusinessService[];
  faqs: FrequentlyAskedQuestion[];
  knowledge: KnowledgeBaseEntry[];
  includeBusinessHours: boolean;
  includeContact: boolean;
  usedFallback: boolean;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'you', 'your', 'can', 'how', 'what', 'when',
  'where', 'who', 'why', 'this', 'that', 'with', 'have', 'has', 'does', 'did',
  'will', 'would', 'about', 'from', 'they', 'them', 'our', 'was', 'were',
]);

const HOURS_HINTS = [
  'open', 'hour', 'close', 'time', 'when', 'available', 'schedule', 'today',
  'tomorrow', 'weekend', 'working',
];
const CONTACT_HINTS = [
  'contact', 'phone', 'call', 'email', 'address', 'location', 'where',
  'website', 'reach', 'whatsapp', 'number',
];

const MAX_SERVICES = 5;
const MAX_FAQS = 5;
const MAX_KNOWLEDGE = 4;

/** Lowercase, strip punctuation, drop stopwords/short tokens, dedupe. */
export function tokenize(question: string): string[] {
  const raw = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(raw)).slice(0, 12);
}

function contains(terms: string[]): Prisma.StringFilter[] {
  return terms.map((t) => ({ contains: t, mode: 'insensitive' as const }));
}

/** Count how many distinct terms appear in the given texts (relevance score). */
function score(terms: string[], ...texts: (string | null)[]): number {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
}

export const aiRetrievalService = {
  async retrieve(
    companyId: string,
    question: string,
  ): Promise<RetrievalResult> {
    const terms = tokenize(question);
    const lower = question.toLowerCase();
    const includeBusinessHours = HOURS_HINTS.some((h) => lower.includes(h));
    const includeContact = CONTACT_HINTS.some((h) => lower.includes(h));

    if (terms.length === 0) {
      return this.fallback(companyId, includeBusinessHours, includeContact);
    }

    const [services, faqs, knowledge] = await Promise.all([
      prisma.businessService.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            ...contains(terms).map((f) => ({ name: f })),
            ...contains(terms).map((f) => ({ description: f })),
          ],
        },
        take: 25,
      }),
      prisma.frequentlyAskedQuestion.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            ...contains(terms).map((f) => ({ question: f })),
            ...contains(terms).map((f) => ({ answer: f })),
            ...contains(terms).map((f) => ({ category: f })),
          ],
        },
        take: 25,
      }),
      prisma.knowledgeBaseEntry.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            ...contains(terms).map((f) => ({ title: f })),
            ...contains(terms).map((f) => ({ content: f })),
            ...contains(terms).map((f) => ({ category: f })),
            { tags: { hasSome: terms } },
          ],
        },
        take: 25,
      }),
    ]);

    const rankedServices = services
      .map((s) => ({ s, score: score(terms, s.name, s.name, s.description) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SERVICES)
      .map((r) => r.s);

    const rankedFaqs = faqs
      .map((f) => ({ f, score: score(terms, f.question, f.question, f.answer, f.category) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FAQS)
      .map((r) => r.f);

    const rankedKnowledge = knowledge
      .map((k) => ({ k, score: score(terms, k.title, k.title, k.content, k.category) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_KNOWLEDGE)
      .map((r) => r.k);

    const anyMatch =
      rankedServices.length + rankedFaqs.length + rankedKnowledge.length > 0;
    if (!anyMatch) {
      return this.fallback(companyId, includeBusinessHours, includeContact);
    }

    return {
      services: rankedServices,
      faqs: rankedFaqs,
      knowledge: rankedKnowledge,
      includeBusinessHours,
      includeContact,
      usedFallback: false,
    };
  },

  /** Limited general company summary when nothing matches directly. */
  async fallback(
    companyId: string,
    includeBusinessHours: boolean,
    includeContact: boolean,
  ): Promise<RetrievalResult> {
    const [services, faqs] = await Promise.all([
      prisma.businessService.findMany({
        where: { companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: MAX_SERVICES,
      }),
      prisma.frequentlyAskedQuestion.findMany({
        where: { companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: MAX_FAQS,
      }),
    ]);
    return {
      services,
      faqs,
      knowledge: [],
      includeBusinessHours,
      includeContact,
      usedFallback: true,
    };
  },
};
