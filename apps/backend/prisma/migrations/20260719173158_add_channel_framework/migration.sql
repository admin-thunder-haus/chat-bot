-- CreateEnum
CREATE TYPE "ChannelAccountStatus" AS ENUM ('DRAFT', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ChannelConnectionState" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'AUTH_EXPIRED');

-- CreateEnum
CREATE TYPE "ChannelWebhookEventStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'NORMALIZED', 'PROCESSED', 'IGNORED', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelActivityType" AS ENUM ('CHANNEL_ACCOUNT_CREATED', 'CHANNEL_ACCOUNT_UPDATED', 'CHANNEL_ACCOUNT_CONNECTED', 'CHANNEL_ACCOUNT_DISCONNECTED', 'CHANNEL_HEALTH_CHANGED', 'WEBHOOK_RECEIVED', 'WEBHOOK_DUPLICATE', 'CHANNEL_MESSAGE_SENT', 'CHANNEL_MESSAGE_FAILED', 'DELIVERY_STATUS_CHANGED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "channelAccountId" UUID,
ADD COLUMN     "providerKey" TEXT;

-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "externalPageId" TEXT,
    "status" "ChannelAccountStatus" NOT NULL DEFAULT 'DRAFT',
    "connectionState" "ChannelConnectionState" NOT NULL DEFAULT 'UNKNOWN',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB,
    "metadata" JSONB,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_credentials" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channelAccountId" UUID NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "encryptionVersion" TEXT NOT NULL,
    "keyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "channel_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_webhook_events" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "channelAccountId" UUID,
    "providerKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT,
    "status" "ChannelWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "rawPayloadHash" TEXT NOT NULL,
    "normalizedPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_deliveries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channelAccountId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "status" "ChannelDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_activities" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channelAccountId" UUID,
    "conversationId" UUID,
    "actorUserId" UUID,
    "activityType" "ChannelActivityType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_accounts_companyId_idx" ON "channel_accounts"("companyId");

-- CreateIndex
CREATE INDEX "channel_accounts_companyId_channelType_idx" ON "channel_accounts"("companyId", "channelType");

-- CreateIndex
CREATE INDEX "channel_accounts_companyId_providerKey_idx" ON "channel_accounts"("companyId", "providerKey");

-- CreateIndex
CREATE INDEX "channel_accounts_companyId_status_idx" ON "channel_accounts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_companyId_providerKey_externalAccountId_key" ON "channel_accounts"("companyId", "providerKey", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_credentials_channelAccountId_key" ON "channel_credentials"("channelAccountId");

-- CreateIndex
CREATE INDEX "channel_credentials_companyId_idx" ON "channel_credentials"("companyId");

-- CreateIndex
CREATE INDEX "channel_webhook_events_companyId_idx" ON "channel_webhook_events"("companyId");

-- CreateIndex
CREATE INDEX "channel_webhook_events_channelAccountId_idx" ON "channel_webhook_events"("channelAccountId");

-- CreateIndex
CREATE INDEX "channel_webhook_events_providerKey_idx" ON "channel_webhook_events"("providerKey");

-- CreateIndex
CREATE INDEX "channel_webhook_events_status_idx" ON "channel_webhook_events"("status");

-- CreateIndex
CREATE INDEX "channel_webhook_events_receivedAt_idx" ON "channel_webhook_events"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_webhook_events_channelAccountId_providerKey_externa_key" ON "channel_webhook_events"("channelAccountId", "providerKey", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_deliveries_messageId_key" ON "channel_deliveries"("messageId");

-- CreateIndex
CREATE INDEX "channel_deliveries_companyId_idx" ON "channel_deliveries"("companyId");

-- CreateIndex
CREATE INDEX "channel_deliveries_channelAccountId_idx" ON "channel_deliveries"("channelAccountId");

-- CreateIndex
CREATE INDEX "channel_deliveries_status_idx" ON "channel_deliveries"("status");

-- CreateIndex
CREATE INDEX "channel_activities_companyId_idx" ON "channel_activities"("companyId");

-- CreateIndex
CREATE INDEX "channel_activities_companyId_channelAccountId_idx" ON "channel_activities"("companyId", "channelAccountId");

-- CreateIndex
CREATE INDEX "channel_activities_companyId_createdAt_idx" ON "channel_activities"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_companyId_channelAccountId_idx" ON "conversations"("companyId", "channelAccountId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_credentials" ADD CONSTRAINT "channel_credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_credentials" ADD CONSTRAINT "channel_credentials_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_activities" ADD CONSTRAINT "channel_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_activities" ADD CONSTRAINT "channel_activities_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
