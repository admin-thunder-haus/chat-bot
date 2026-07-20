import type { UserRole } from '@prisma/client';
import { conversationsRepository } from '../conversations/conversations.repository';
import type { ConversationDetail } from '../conversations/conversations.repository';
import { usersRepository } from '../users/users.repository';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../../utils/activity';

interface Actor {
  id: string;
  role: UserRole;
}

/**
 * Assignment rules:
 * - Target user must belong to the company and be ACTIVE.
 * - OWNER/ADMIN may assign to anyone (or unassign).
 * - AGENT may only assign to themselves, or clear an assignment that is
 *   currently theirs.
 */
export const assignmentsService = {
  async setAssignment(
    companyId: string,
    conversationId: string,
    actor: Actor,
    assignedUserId: string | null,
  ): Promise<ConversationDetail> {
    const conversation = await conversationsRepository.findByIdScoped(
      companyId,
      conversationId,
    );
    if (!conversation) throw AppError.notFound('Conversation not found');

    const isAgent = actor.role === 'AGENT';
    if (isAgent) {
      const assigningToSelf = assignedUserId === actor.id;
      const clearingOwn =
        assignedUserId === null && conversation.assignedUserId === actor.id;
      if (!assigningToSelf && !clearingOwn) {
        throw AppError.forbidden(
          'Agents can only assign conversations to themselves',
        );
      }
    }

    if (assignedUserId !== null) {
      const target = await usersRepository.findByIdScoped(
        assignedUserId,
        companyId,
      );
      if (!target || target.status !== 'ACTIVE') {
        throw AppError.badRequest('Validation failed', [
          {
            field: 'assignedUserId',
            message: 'Assigned user must be an active member of this company',
          },
        ]);
      }
    }

    if (conversation.assignedUserId !== assignedUserId) {
      await prisma.$transaction(async (tx) => {
        await conversationsRepository.updateById(tx, conversationId, {
          assignedUser: assignedUserId
            ? { connect: { id: assignedUserId } }
            : { disconnect: true },
        });
        await logActivity(tx, {
          companyId,
          conversationId,
          actorUserId: actor.id,
          activityType: 'ASSIGNEE_CHANGED',
          previousValue: { assignedUserId: conversation.assignedUserId },
          newValue: { assignedUserId },
        });
      });
    }

    const detail = await conversationsRepository.findDetail(
      companyId,
      conversationId,
    );
    if (!detail) throw AppError.notFound('Conversation not found');
    return detail;
  },
};
