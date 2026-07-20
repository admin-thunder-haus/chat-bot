import type { ActivityType, ConversationActivity, Prisma } from '@prisma/client';

export interface ActivityInput {
  companyId: string;
  conversationId: string;
  actorUserId?: string | null;
  activityType: ActivityType;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append a conversation activity row. Always call inside the same transaction
 * as the change it records so audit history can never drift from reality.
 * Activities are append-only — there are no update/delete helpers by design.
 */
export function logActivity(
  tx: Prisma.TransactionClient,
  input: ActivityInput,
): Promise<ConversationActivity> {
  return tx.conversationActivity.create({
    data: {
      companyId: input.companyId,
      conversationId: input.conversationId,
      actorUserId: input.actorUserId ?? null,
      activityType: input.activityType,
      ...(input.previousValue !== undefined
        ? { previousValue: input.previousValue }
        : {}),
      ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });
}
