-- CreateEnum
CREATE TYPE "LoginAuditOutcome" AS ENUM ('SUCCESS', 'INVALID_PASSWORD', 'UNKNOWN_EMAIL', 'ACCOUNT_DISABLED', 'EMAIL_NOT_VERIFIED', 'COMPANY_SUSPENDED');

-- CreateTable
CREATE TABLE "login_audit_events" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "userId" UUID,
    "email" TEXT NOT NULL,
    "outcome" "LoginAuditOutcome" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_audit_events_userId_createdAt_idx" ON "login_audit_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_audit_events_companyId_createdAt_idx" ON "login_audit_events"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "login_audit_events" ADD CONSTRAINT "login_audit_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_audit_events" ADD CONSTRAINT "login_audit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
