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
    faqIds: string[];
    knowledgeIds: string[];
    approxCharacters: number;
  };
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
        faqIds,
        knowledgeIds,
        approxCharacters: contextText.length,
      },
    };
  },
};

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
