import type { ConversationTag } from '@prisma/client';
import { conversationTagsRepository } from './conversation-tags.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../../utils/activity';
import type { CreateTagInput, UpdateTagInput } from './conversation-tags.validation';

export const conversationTagsService = {
  list(companyId: string): Promise<ConversationTag[]> {
    return conversationTagsRepository.list(companyId);
  },

  async create(
    companyId: string,
    input: CreateTagInput,
  ): Promise<ConversationTag> {
    if (await conversationTagsRepository.nameExists(companyId, input.name)) {
      throw AppError.conflict('A tag with this name already exists', [
        { field: 'name', message: 'Name is already in use' },
      ]);
    }
    return conversationTagsRepository.create(companyId, {
      name: input.name,
      color: input.color ?? null,
    });
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateTagInput,
  ): Promise<ConversationTag> {
    const existing = await conversationTagsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Tag not found');
    if (input.name && input.name !== existing.name) {
      if (await conversationTagsRepository.nameExists(companyId, input.name, id)) {
        throw AppError.conflict('A tag with this name already exists', [
          { field: 'name', message: 'Name is already in use' },
        ]);
      }
    }
    const updated = await conversationTagsRepository.update(companyId, id, input);
    if (!updated) throw AppError.notFound('Tag not found');
    return updated;
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await conversationTagsRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Tag not found');
  },

  /** Attach an existing tag to a conversation (idempotent) + activity. */
  async attach(
    companyId: string,
    conversationId: string,
    tagId: string,
    actorUserId: string,
  ): Promise<ConversationTag[]> {
    const conversation = await conversationsRepository.findByIdScoped(
      companyId,
      conversationId,
    );
    if (!conversation) throw AppError.notFound('Conversation not found');
    const tag = await conversationTagsRepository.findByIdScoped(companyId, tagId);
    if (!tag) throw AppError.notFound('Tag not found');

    await prisma.$transaction(async (tx) => {
      const existing = await tx.conversationTagAssignment.findUnique({
        where: { conversationId_tagId: { conversationId, tagId } },
      });
      if (existing) return; // idempotent
      await tx.conversationTagAssignment.create({
        data: { conversationId, tagId, companyId },
      });
      await logActivity(tx, {
        companyId,
        conversationId,
        actorUserId,
        activityType: 'TAG_ADDED',
        newValue: { tagId, name: tag.name },
      });
    });

    return conversationTagsRepository.listForConversation(companyId, conversationId);
  },

  /** Remove a tag from a conversation + activity. */
  async detach(
    companyId: string,
    conversationId: string,
    tagId: string,
    actorUserId: string,
  ): Promise<ConversationTag[]> {
    const conversation = await conversationsRepository.findByIdScoped(
      companyId,
      conversationId,
    );
    if (!conversation) throw AppError.notFound('Conversation not found');
    const tag = await conversationTagsRepository.findByIdScoped(companyId, tagId);
    if (!tag) throw AppError.notFound('Tag not found');

    await prisma.$transaction(async (tx) => {
      const existing = await tx.conversationTagAssignment.findUnique({
        where: { conversationId_tagId: { conversationId, tagId } },
      });
      if (!existing) return;
      await tx.conversationTagAssignment.delete({
        where: { conversationId_tagId: { conversationId, tagId } },
      });
      await logActivity(tx, {
        companyId,
        conversationId,
        actorUserId,
        activityType: 'TAG_REMOVED',
        previousValue: { tagId, name: tag.name },
      });
    });

    return conversationTagsRepository.listForConversation(companyId, conversationId);
  },
};
