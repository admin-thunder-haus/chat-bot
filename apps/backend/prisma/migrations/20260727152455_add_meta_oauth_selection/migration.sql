-- CreateTable
CREATE TABLE "meta_oauth_selections" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "encryptionVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_oauth_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_oauth_selections_companyId_createdAt_idx" ON "meta_oauth_selections"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "meta_oauth_selections" ADD CONSTRAINT "meta_oauth_selections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
