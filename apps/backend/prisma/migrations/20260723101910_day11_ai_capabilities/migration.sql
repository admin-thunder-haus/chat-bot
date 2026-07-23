-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AIGenerationType" ADD VALUE 'SUMMARY';
ALTER TYPE "AIGenerationType" ADD VALUE 'SUGGESTION';

-- AlterEnum
ALTER TYPE "MessageContentType" ADD VALUE 'AUDIO';

-- AlterTable
ALTER TABLE "company_ai_settings" ADD COLUMN     "handoffKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "handoffOnLowConfidence" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "handoffOnRequest" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "aiSummaryGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "detectedLanguage" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "preferredLanguage" TEXT;

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "pageCount" INTEGER,
    "extractedCharacters" INTEGER,
    "failureReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_chunks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_companyId_idx" ON "knowledge_documents"("companyId");

-- CreateIndex
CREATE INDEX "knowledge_documents_companyId_status_idx" ON "knowledge_documents"("companyId", "status");

-- CreateIndex
CREATE INDEX "knowledge_document_chunks_companyId_idx" ON "knowledge_document_chunks"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_chunks_documentId_chunkIndex_key" ON "knowledge_document_chunks"("documentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_chunks" ADD CONSTRAINT "knowledge_document_chunks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_chunks" ADD CONSTRAINT "knowledge_document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
