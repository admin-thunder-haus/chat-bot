import type { Message } from '@prisma/client';
import {
  messagesRepository,
  type MessagePage,
} from './messages.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { channelPipelineService } from '../channels/channel-pipeline.service';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import type { MessageListQuery, SendMessageInput } from './messages.validation';

export const messagesService = {
  async list(
    companyId: string,
    conversationId: string,
    query: MessageListQuery,
  ): Promise<MessagePage> {
    // Tenant + existence check before returning any messages.
    const conversation = await conversationsRepository.findByIdScoped(
      companyId,
      conversationId,
    );
    if (!conversation) throw AppError.notFound('Conversation not found');

    return messagesRepository.list(
      companyId,
      conversationId,
      query.limit,
      query.before,
    );
  },

  /**
   * Send a manual OUTBOUND agent message. Sender is derived from the JWT — the
   * client can never set direction, senderType, status, or senderUserId.
   */
  async send(
    companyId: string,
    conversationId: string,
    senderUserId: string,
    input: SendMessageInput,
  ): Promise<Message> {
    const conversation = await conversationsRepository.findByIdScoped(
      companyId,
      conversationId,
    );
    if (!conversation) throw AppError.notFound('Conversation not found');

    // If replying to a message, it must belong to the same conversation/tenant.
    if (input.replyToMessageId) {
      const parent = await prisma.message.findFirst({
        where: { id: input.replyToMessageId, companyId, conversationId },
        select: { id: true },
      });
      if (!parent) {
        throw AppError.badRequest('Validation failed', [
          { field: 'replyToMessageId', message: 'Reply target not found' },
        ]);
      }
    }

    // Delegate persistence + dispatch to the shared outgoing pipeline. Manual /
    // legacy conversations (no channel account) send locally exactly as before;
    // conversations bound to an enabled provider go out through that provider and
    // record a ChannelDelivery — without any platform-specific logic here.
    const { message } = await channelPipelineService.sendOutbound({
      companyId,
      conversation,
      senderUserId,
      senderType: 'AGENT',
      content: input.content,
      replyToMessageId: input.replyToMessageId ?? null,
      actorUserId: senderUserId,
    });
    return message;
  },
};
