import type {
  ChannelAccount,
  ChannelAccountStatus,
  ChannelConnectionState,
  ChannelDelivery,
  ChannelType,
  Prisma,
} from '@prisma/client';

/**
 * Public, credential-free view of a channel account. This is the ONLY shape
 * returned by the channel APIs — the linked ChannelCredential is never loaded
 * or serialized here, so encrypted payloads can never leak through the API.
 */
export interface ChannelAccountView {
  id: string;
  providerKey: string;
  channelType: ChannelType;
  displayName: string;
  externalAccountId: string | null;
  externalPageId: string | null;
  publicId: string | null;
  status: ChannelAccountStatus;
  connectionState: ChannelConnectionState;
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastHealthCheckAt: Date | null;
  lastHealthyAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Serialize a channel account for API responses (never includes credentials). */
export function serializeChannelAccount(a: ChannelAccount): ChannelAccountView {
  return {
    id: a.id,
    providerKey: a.providerKey,
    channelType: a.channelType,
    displayName: a.displayName,
    externalAccountId: a.externalAccountId,
    externalPageId: a.externalPageId,
    publicId: a.publicId,
    status: a.status,
    connectionState: a.connectionState,
    isEnabled: a.isEnabled,
    isDefault: a.isDefault,
    capabilities: a.capabilities,
    metadata: a.metadata,
    connectedAt: a.connectedAt,
    disconnectedAt: a.disconnectedAt,
    lastHealthCheckAt: a.lastHealthCheckAt,
    lastHealthyAt: a.lastHealthyAt,
    lastErrorCode: a.lastErrorCode,
    lastErrorMessage: a.lastErrorMessage,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** Public view of an outbound delivery record (for the inbox delivery badge). */
export interface ChannelDeliveryView {
  id: string;
  messageId: string;
  channelAccountId: string;
  providerKey: string;
  externalMessageId: string | null;
  status: ChannelDelivery['status'];
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
}

export function serializeChannelDelivery(d: ChannelDelivery): ChannelDeliveryView {
  return {
    id: d.id,
    messageId: d.messageId,
    channelAccountId: d.channelAccountId,
    providerKey: d.providerKey,
    externalMessageId: d.externalMessageId,
    status: d.status,
    sentAt: d.sentAt,
    deliveredAt: d.deliveredAt,
    readAt: d.readAt,
    failedAt: d.failedAt,
    failureCode: d.failureCode,
    createdAt: d.createdAt,
  };
}
