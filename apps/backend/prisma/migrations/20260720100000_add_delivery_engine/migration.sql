-- CreateEnum
CREATE TYPE "ChannelDeliveryFailureType" AS ENUM ('NONE', 'TEMPORARY', 'PERMANENT');

-- CreateEnum
CREATE TYPE "ChannelDeliveryAttemptStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'PERMANENT_FAILURE');

-- CreateEnum
CREATE TYPE "ChannelHealthCheckType" AS ENUM ('MANUAL', 'DELIVERY', 'DIAGNOSTIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelActivityType" ADD VALUE 'DELIVERY_RETRY_SCHEDULED';
ALTER TYPE "ChannelActivityType" ADD VALUE 'DELIVERY_RECOVERED';
ALTER TYPE "ChannelActivityType" ADD VALUE 'DELIVERY_EXPIRED';
ALTER TYPE "ChannelActivityType" ADD VALUE 'DELIVERY_CANCELLED';
ALTER TYPE "ChannelActivityType" ADD VALUE 'CHANNEL_DEGRADED';
ALTER TYPE "ChannelActivityType" ADD VALUE 'CHANNEL_RECOVERED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelDeliveryStatus" ADD VALUE 'QUEUED';
ALTER TYPE "ChannelDeliveryStatus" ADD VALUE 'SENDING';
ALTER TYPE "ChannelDeliveryStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "ChannelDeliveryStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ChannelDeliveryStatus" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "channel_accounts" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "lastFailedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "successCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "channel_deliveries" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "failureType" "ChannelDeliveryFailureType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "channel_delivery_attempts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channelAccountId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "ChannelDeliveryAttemptStatus" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "failureType" "ChannelDeliveryFailureType" NOT NULL DEFAULT 'NONE',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "providerMetadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_health_checks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channelAccountId" UUID NOT NULL,
    "checkType" "ChannelHealthCheckType" NOT NULL,
    "state" "ChannelConnectionState" NOT NULL,
    "healthy" BOOLEAN NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_delivery_attempts_companyId_idx" ON "channel_delivery_attempts"("companyId");

-- CreateIndex
CREATE INDEX "channel_delivery_attempts_deliveryId_idx" ON "channel_delivery_attempts"("deliveryId");

-- CreateIndex
CREATE INDEX "channel_delivery_attempts_channelAccountId_createdAt_idx" ON "channel_delivery_attempts"("channelAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_health_checks_companyId_idx" ON "channel_health_checks"("companyId");

-- CreateIndex
CREATE INDEX "channel_health_checks_channelAccountId_createdAt_idx" ON "channel_health_checks"("channelAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_deliveries_status_nextAttemptAt_idx" ON "channel_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_deliveries_companyId_idempotencyKey_key" ON "channel_deliveries"("companyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "channel_delivery_attempts" ADD CONSTRAINT "channel_delivery_attempts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_delivery_attempts" ADD CONSTRAINT "channel_delivery_attempts_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_delivery_attempts" ADD CONSTRAINT "channel_delivery_attempts_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "channel_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_health_checks" ADD CONSTRAINT "channel_health_checks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_health_checks" ADD CONSTRAINT "channel_health_checks_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

