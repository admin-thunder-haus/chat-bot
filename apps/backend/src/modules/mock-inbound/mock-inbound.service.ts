import { prisma } from '../../config/prisma';
import { conversationsRepository } from '../conversations/conversations.repository';
import type { ConversationDetail } from '../conversations/conversations.repository';
import { channelPipelineService } from '../channels/channel-pipeline.service';
import type { NormalizedInboundMessage } from '../channels/channel-normalizer.service';
import type { MockInboundInput } from './mock-inbound.validation';

export interface MockInboundResult {
  idempotent: boolean;
  customer: unknown;
  conversation: ConversationDetail | null;
  message: unknown;
  autoReply?: { generated: boolean; reason?: string };
}

/**
 * Simulates a social-platform inbound message. This dev-only tool now flows
 * through the SAME shared channel pipeline the real webhook engine uses — no
 * channel account is attached, so it exercises the legacy/manual path. Find-or-
 * create customer + conversation, append an inbound message, bump unread /
 * timestamps, reopen a resolved/closed conversation, record activity, and run
 * the optional AI auto-reply — all with the pipeline's idempotency guarantees.
 */
export const mockInboundService = {
  async handle(
    companyId: string,
    actorUserId: string,
    input: MockInboundInput,
  ): Promise<MockInboundResult> {
    const message: NormalizedInboundMessage = {
      externalMessageId: input.message.externalMessageId,
      externalConversationId: null,
      externalCustomerId: input.externalCustomerId,
      replyToExternalMessageId: null,
      customer: {
        fullName: input.customer?.fullName ?? null,
        firstName: input.customer?.firstName ?? null,
        lastName: input.customer?.lastName ?? null,
        phone: input.customer?.phone ?? null,
        email: input.customer?.email ?? null,
        username: input.customer?.username ?? null,
      },
      content: input.message.content,
      timestamp: new Date(),
    };

    const ingest = await channelPipelineService.ingestInbound({
      companyId,
      channelType: input.channelType,
      channelAccountId: null,
      providerKey: null,
      actorUserId,
      source: 'mock-inbound',
      message,
    });

    const result = await this.buildResult(
      companyId,
      ingest.messageId,
      ingest.idempotent,
    );

    // Auto-reply only on a freshly created inbound (never on idempotent replay).
    if (!ingest.idempotent) {
      result.autoReply = await channelPipelineService.maybeAutoReply(
        companyId,
        ingest.messageId,
      );
    }

    return result;
  },

  async buildResult(
    companyId: string,
    messageId: string,
    idempotent: boolean,
  ): Promise<MockInboundResult> {
    const message = await prisma.message.findFirst({
      where: { id: messageId, companyId },
    });
    const conversation = message
      ? await conversationsRepository.findDetail(companyId, message.conversationId)
      : null;
    const customer =
      message?.customerId
        ? await prisma.customer.findFirst({
            where: { id: message.customerId, companyId },
          })
        : null;
    return { idempotent, customer, conversation, message };
  },
};
