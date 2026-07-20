import type { InternalNote, UserRole } from '@prisma/client';
import {
  internalNotesRepository,
  type NoteRow,
} from './internal-notes.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../../utils/activity';

interface Actor {
  id: string;
  role: UserRole;
}

/** OWNER/ADMIN may manage any note; others only their own. */
function canManage(note: InternalNote, actor: Actor): boolean {
  return (
    actor.role === 'OWNER' ||
    actor.role === 'ADMIN' ||
    note.authorUserId === actor.id
  );
}

async function requireConversation(
  companyId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await conversationsRepository.findByIdScoped(
    companyId,
    conversationId,
  );
  if (!conversation) throw AppError.notFound('Conversation not found');
}

export const internalNotesService = {
  async list(companyId: string, conversationId: string): Promise<NoteRow[]> {
    await requireConversation(companyId, conversationId);
    return internalNotesRepository.listForConversation(companyId, conversationId);
  },

  async create(
    companyId: string,
    conversationId: string,
    authorUserId: string,
    content: string,
  ): Promise<InternalNote> {
    await requireConversation(companyId, conversationId);
    return prisma.$transaction(async (tx) => {
      const note = await internalNotesRepository.create(tx, companyId, {
        conversationId,
        authorUserId,
        content,
      });
      await logActivity(tx, {
        companyId,
        conversationId,
        actorUserId: authorUserId,
        activityType: 'NOTE_ADDED',
        metadata: { noteId: note.id },
      });
      return note;
    });
  },

  async update(
    companyId: string,
    conversationId: string,
    noteId: string,
    actor: Actor,
    content: string,
  ): Promise<NoteRow> {
    const note = await internalNotesRepository.findScoped(
      companyId,
      conversationId,
      noteId,
    );
    if (!note) throw AppError.notFound('Note not found');
    if (!canManage(note, actor)) {
      throw AppError.forbidden('You cannot edit this note');
    }
    const updated = await internalNotesRepository.update(companyId, noteId, content);
    if (!updated) throw AppError.notFound('Note not found');
    return updated;
  },

  async remove(
    companyId: string,
    conversationId: string,
    noteId: string,
    actor: Actor,
  ): Promise<void> {
    const note = await internalNotesRepository.findScoped(
      companyId,
      conversationId,
      noteId,
    );
    if (!note) throw AppError.notFound('Note not found');
    if (!canManage(note, actor)) {
      throw AppError.forbidden('You cannot delete this note');
    }
    await internalNotesRepository.remove(companyId, noteId);
  },
};
