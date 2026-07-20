import type { Message } from '@prisma/client';
import type { WebChatConfig } from '../channels/providers/webchat.config';

/** Visitor-facing role for a message (no agent identity is ever exposed). */
export type WidgetMessageRole = 'visitor' | 'agent' | 'assistant' | 'system';

export interface WidgetMessage {
  id: string;
  role: WidgetMessageRole;
  content: string;
  createdAt: Date;
}

export interface WidgetPublicConfig {
  publicId: string;
  channelType: 'WEBCHAT';
  config: WebChatConfig;
}

export interface WidgetSessionResult {
  sessionToken: string;
  visitorId: string;
  conversationId: string | null;
  config: WebChatConfig;
  messages: WidgetMessage[];
}

/** Map an internal Message to the safe, visitor-facing widget shape. */
export function toWidgetMessage(m: {
  id: string;
  direction: Message['direction'];
  senderType: Message['senderType'];
  content: string;
  createdAt: Date;
}): WidgetMessage {
  let role: WidgetMessageRole;
  if (m.direction === 'INBOUND') role = 'visitor';
  else if (m.senderType === 'AI') role = 'assistant';
  else if (m.senderType === 'SYSTEM') role = 'system';
  else role = 'agent';
  return { id: m.id, role, content: m.content, createdAt: m.createdAt };
}
