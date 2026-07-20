import { request } from '../api';
import type {
  ChannelType,
  ConversationDetail,
  Customer,
  Message,
} from '../types';

export interface MockInboundInput {
  channelType: ChannelType;
  externalCustomerId: string;
  customer?: {
    fullName?: string;
    phone?: string;
    email?: string;
    username?: string;
  };
  message: {
    externalMessageId: string;
    content: string;
  };
}

export interface MockInboundResult {
  idempotent: boolean;
  customer: Customer;
  conversation: ConversationDetail;
  message: Message;
}

export const mockInboundApi = {
  send(input: MockInboundInput): Promise<MockInboundResult> {
    return request('/dev/mock-inbound-message', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
};
