import type {
  BusinessService,
  FrequentlyAskedQuestion,
  KnowledgeBaseEntry,
  Prisma,
  Product,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { knowledgeDocumentsRepository } from '../knowledge-documents/knowledge-documents.repository';

/**
 * Day 4 retrieval is deterministic KEYWORD search over PostgreSQL — NOT semantic
 * / vector search. It is tenant-scoped and only ever reads ACTIVE records. The
 * interface is intentionally simple so embeddings can replace or augment it later.
 */

/** Retrieved slice of an uploaded PDF (see knowledge-documents module). */
export interface RetrievedDocumentChunk {
  id: string;
  documentId: string;
  fileName: string;
  content: string;
}

export interface RetrievalResult {
  services: BusinessService[];
  products: Product[];
  faqs: FrequentlyAskedQuestion[];
  knowledge: KnowledgeBaseEntry[];
  documentChunks: RetrievedDocumentChunk[];
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
const MAX_PRODUCTS = 5;
const MAX_FAQS = 5;
const MAX_KNOWLEDGE = 4;
const MAX_DOCUMENT_CHUNKS = 4;
// Chunk search casts a wider net than the final cut so ranking has choices.
const DOCUMENT_CHUNK_CANDIDATES = 25;

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

    const [services, products, faqs, knowledge, documentCandidates] = await Promise.all([
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
      prisma.product.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            ...contains(terms).map((f) => ({ name: f })),
            ...contains(terms).map((f) => ({ description: f })),
            ...contains(terms).map((f) => ({ category: f })),
            ...contains(terms).map((f) => ({ sku: f })),
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
      knowledgeDocumentsRepository.searchChunks(
        companyId,
        terms,
        DOCUMENT_CHUNK_CANDIDATES,
      ),
    ]);

    const rankedServices = services
      .map((s) => ({ s, score: score(terms, s.name, s.name, s.description) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SERVICES)
      .map((r) => r.s);

    const rankedProducts = products
      .map((p) => ({
        p,
        score: score(terms, p.name, p.name, p.description, p.category),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PRODUCTS)
      .map((r) => r.p);

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

    const rankedChunks = documentCandidates
      .map((c) => ({ c, score: score(terms, c.content, c.fileName) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DOCUMENT_CHUNKS)
      .map((r) => r.c);

    const anyMatch =
      rankedServices.length +
        rankedProducts.length +
        rankedFaqs.length +
        rankedKnowledge.length +
        rankedChunks.length >
      0;
    if (!anyMatch) {
      return this.fallback(companyId, includeBusinessHours, includeContact);
    }

    return {
      services: rankedServices,
      products: rankedProducts,
      faqs: rankedFaqs,
      knowledge: rankedKnowledge,
      documentChunks: rankedChunks,
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
    const [services, products, faqs] = await Promise.all([
      prisma.businessService.findMany({
        where: { companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: MAX_SERVICES,
      }),
      prisma.product.findMany({
        where: { companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: MAX_PRODUCTS,
      }),
      prisma.frequentlyAskedQuestion.findMany({
        where: { companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: MAX_FAQS,
      }),
    ]);
    return {
      services,
      products,
      faqs,
      knowledge: [],
      documentChunks: [],
      includeBusinessHours,
      includeContact,
      usedFallback: true,
    };
  },
};
