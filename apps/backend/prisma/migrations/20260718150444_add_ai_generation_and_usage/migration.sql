-- CreateEnum
CREATE TYPE "AIConversationMode" AS ENUM ('ENABLED', 'PAUSED', 'HUMAN_ONLY');

-- CreateEnum
CREATE TYPE "AIGenerationType" AS ENUM ('DRAFT', 'AUTO_REPLY', 'PLAYGROUND', 'REGENERATE');

-- CreateEnum
CREATE TYPE "AIGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'AI_MODE_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'AI_HANDOFF_REQUESTED';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "aiMode" "AIConversationMode" NOT NULL DEFAULT 'ENABLED',
ADD COLUMN     "aiPausedAt" TIMESTAMP(3),
ADD COLUMN     "aiPausedByUserId" UUID,
ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "handoffRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ai_response_generations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID,
    "sourceMessageId" UUID,
    "generatedMessageId" UUID,
    "requestedByUserId" UUID,
    "generationType" "AIGenerationType" NOT NULL,
    "status" "AIGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokenCount" INTEGER,
    "outputTokenCount" INTEGER,
    "totalTokenCount" INTEGER,
    "estimatedCostUsd" DECIMAL(12,6),
    "latencyMs" INTEGER,
    "responseText" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "providerResponseId" TEXT,
    "contextSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "ai_response_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_daily" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokenCount" INTEGER NOT NULL DEFAULT 0,
    "outputTokenCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokenCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_response_generations_companyId_idx" ON "ai_response_generations"("companyId");

-- CreateIndex
CREATE INDEX "ai_response_generations_companyId_createdAt_idx" ON "ai_response_generations"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_response_generations_conversationId_createdAt_idx" ON "ai_response_generations"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_response_generations_companyId_generationType_idx" ON "ai_response_generations"("companyId", "generationType");

-- CreateIndex
CREATE INDEX "ai_usage_daily_companyId_idx" ON "ai_usage_daily"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_daily_companyId_date_key" ON "ai_usage_daily"("companyId", "date");

-- AddForeignKey
ALTER TABLE "ai_response_generations" ADD CONSTRAINT "ai_response_generations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_response_generations" ADD CONSTRAINT "ai_response_generations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "ai_usage_daily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
