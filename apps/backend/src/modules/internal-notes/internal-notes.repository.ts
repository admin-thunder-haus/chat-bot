import type { InternalNote, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { assignedUserSelect } from '../conversations/conversations.types';

const noteInclude = {
  author: { select: assignedUserSelect },
} satisfies Prisma.InternalNoteInclude;

export type NoteRow = Prisma.InternalNoteGetPayload<{
  include: typeof noteInclude;
}>;

/** Tenant-scoped data-access for internal notes. */
export const internalNotesRepository = {
  create(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: { conversationId: string; authorUserId: string; content: string },
  ): Promise<InternalNote> {
    return tx.internalNote.create({ data: { ...data, companyId } });
  },

  listForConversation(
    companyId: string,
    conversationId: string,
  ): Promise<NoteRow[]> {
    return prisma.internalNote.findMany({
      where: { companyId, conversationId },
      orderBy: { createdAt: 'asc' },
      include: noteInclude,
    });
  },

  findScoped(
    companyId: string,
    conversationId: string,
    noteId: string,
  ): Promise<InternalNote | null> {
    return prisma.internalNote.findFirst({
      where: { id: noteId, companyId, conversationId },
    });
  },

  async update(
    companyId: string,
    noteId: string,
    content: string,
  ): Promise<NoteRow | null> {
    await prisma.internalNote.updateMany({
      where: { id: noteId, companyId },
      data: { content },
    });
    return prisma.internalNote.findFirst({
      where: { id: noteId, companyId },
      include: noteInclude,
    });
  },

  async remove(companyId: string, noteId: string): Promise<void> {
    await prisma.internalNote.deleteMany({ where: { id: noteId, companyId } });
  },
};
