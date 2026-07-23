-- CreateTable
CREATE TABLE "stored_images" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_images_companyId_idx" ON "stored_images"("companyId");

-- AddForeignKey
ALTER TABLE "stored_images" ADD CONSTRAINT "stored_images_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
