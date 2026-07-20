import type { FrequentlyAskedQuestion } from '@prisma/client';
import { faqsRepository } from './faqs.repository';
import { AppError } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import type {
  CreateFaqInput,
  FaqListQuery,
  ReorderInput,
  UpdateFaqInput,
} from './faqs.validation';

export const faqsService = {
  async list(
    companyId: string,
    query: FaqListQuery,
  ): Promise<PaginatedResult<FrequentlyAskedQuestion>> {
    const { items, total } = await faqsRepository.list(companyId, query);
    return paginate(items, total, query.page, query.limit);
  },

  async getById(
    companyId: string,
    id: string,
  ): Promise<FrequentlyAskedQuestion> {
    const faq = await faqsRepository.findByIdScoped(companyId, id);
    if (!faq) throw AppError.notFound('FAQ not found');
    return faq;
  },

  create(
    companyId: string,
    input: CreateFaqInput,
  ): Promise<FrequentlyAskedQuestion> {
    return faqsRepository.create(companyId, {
      question: input.question,
      answer: input.answer,
      category: input.category ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateFaqInput,
  ): Promise<FrequentlyAskedQuestion> {
    const updated = await faqsRepository.update(companyId, id, input);
    if (!updated) throw AppError.notFound('FAQ not found');
    return updated;
  },

  async setStatus(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<FrequentlyAskedQuestion> {
    const updated = await faqsRepository.update(companyId, id, { isActive });
    if (!updated) throw AppError.notFound('FAQ not found');
    return updated;
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await faqsRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('FAQ not found');
  },

  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<FrequentlyAskedQuestion[]> {
    const ids = input.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      throw AppError.badRequest('Validation failed', [
        { field: 'items', message: 'Duplicate FAQ ids are not allowed' },
      ]);
    }
    const owned = await faqsRepository.countByIds(companyId, ids);
    if (owned !== ids.length) {
      throw AppError.notFound('One or more FAQs were not found');
    }
    await faqsRepository.reorder(companyId, input.items);
    return faqsRepository.listOrdered(companyId);
  },
};
