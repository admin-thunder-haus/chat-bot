import type { KnowledgeBaseEntry } from '@prisma/client';
import { knowledgeBaseRepository } from './knowledge-base.repository';
import { AppError } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import type {
  CreateKnowledgeInput,
  KnowledgeListQuery,
  ReorderInput,
  UpdateKnowledgeInput,
} from './knowledge-base.validation';

/** Trim, drop empties, and de-duplicate tags (case-insensitive). */
function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export const knowledgeBaseService = {
  async list(
    companyId: string,
    query: KnowledgeListQuery,
  ): Promise<PaginatedResult<KnowledgeBaseEntry>> {
    const { items, total } = await knowledgeBaseRepository.list(
      companyId,
      query,
    );
    return paginate(items, total, query.page, query.limit);
  },

  async getById(
    companyId: string,
    id: string,
  ): Promise<KnowledgeBaseEntry> {
    const entry = await knowledgeBaseRepository.findByIdScoped(companyId, id);
    if (!entry) throw AppError.notFound('Knowledge base entry not found');
    return entry;
  },

  create(
    companyId: string,
    input: CreateKnowledgeInput,
  ): Promise<KnowledgeBaseEntry> {
    return knowledgeBaseRepository.create(companyId, {
      title: input.title,
      content: input.content,
      category: input.category ?? null,
      tags: normalizeTags(input.tags),
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateKnowledgeInput,
  ): Promise<KnowledgeBaseEntry> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (input.category !== undefined) data.category = input.category;
    if (input.tags !== undefined) data.tags = normalizeTags(input.tags);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await knowledgeBaseRepository.update(companyId, id, data);
    if (!updated) throw AppError.notFound('Knowledge base entry not found');
    return updated;
  },

  async setStatus(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<KnowledgeBaseEntry> {
    const updated = await knowledgeBaseRepository.update(companyId, id, {
      isActive,
    });
    if (!updated) throw AppError.notFound('Knowledge base entry not found');
    return updated;
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await knowledgeBaseRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Knowledge base entry not found');
  },

  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<KnowledgeBaseEntry[]> {
    const ids = input.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      throw AppError.badRequest('Validation failed', [
        { field: 'items', message: 'Duplicate entry ids are not allowed' },
      ]);
    }
    const owned = await knowledgeBaseRepository.countByIds(companyId, ids);
    if (owned !== ids.length) {
      throw AppError.notFound('One or more entries were not found');
    }
    await knowledgeBaseRepository.reorder(companyId, input.items);
    return knowledgeBaseRepository.listOrdered(companyId);
  },
};
