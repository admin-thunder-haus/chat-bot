import { prisma } from '../../config/prisma';

/**
 * GDPR Art. 20 data portability: everything the tenant put into the platform,
 * as one machine-readable JSON document.
 *
 * Two rules shape what is in here:
 *
 *  1. NOTHING that would compromise security if the file leaked. Password
 *     hashes, refresh/reset tokens, encrypted channel credentials, API key
 *     hashes and webhook signing secrets are all deliberately excluded — the
 *     export is a copy of the customer's DATA, not of its credentials.
 *  2. File BYTES are excluded. Documents and images are listed as metadata
 *     with their public URL; a single JSON blob carrying every PDF and voice
 *     note would be unusable (and would not fit in memory). The owner can
 *     download those individually from the URLs.
 *
 * Deliberately assembled in memory: an export is a rare, per-tenant,
 * owner-initiated action, and the volumes here (a small business's
 * conversations) are far from a streaming problem. If a tenant ever outgrows
 * that, this is the one function to make streaming.
 */

/** Emitted alongside the data so a future importer knows what it is reading. */
const EXPORT_FORMAT_VERSION = 1;

export interface CompanyExport {
  meta: {
    formatVersion: number;
    exportedAt: string;
    companyId: string;
    /** What was left out on purpose, so the recipient is not left guessing. */
    excluded: string[];
    counts: Record<string, number>;
  };
  company: unknown;
  users: unknown[];
  customers: unknown[];
  conversations: unknown[];
  messages: unknown[];
  services: unknown[];
  products: unknown[];
  businessHours: unknown[];
  faqs: unknown[];
  knowledgeBaseEntries: unknown[];
  knowledgeDocuments: unknown[];
  aiSettings: unknown;
  appointments: unknown[];
  orders: unknown[];
  supportTickets: unknown[];
  channelAccounts: unknown[];
}

const EXCLUDED = [
  'user password hashes',
  'refresh and password-reset tokens',
  'encrypted channel credentials',
  'API key and webhook signing secrets',
  'file bytes (documents and images are listed with their URLs instead)',
];

export const companyExportService = {
  /**
   * Build the export for one tenant. Every query is companyId-scoped; the id
   * comes from the authenticated identity, never from client input.
   */
  async build(companyId: string): Promise<CompanyExport> {
    const [
      company,
      users,
      customers,
      conversations,
      messages,
      services,
      products,
      businessHours,
      faqs,
      knowledgeBaseEntries,
      knowledgeDocuments,
      aiSettings,
      appointments,
      orders,
      supportTickets,
      channelAccounts,
    ] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      // select, not omit: an added sensitive column must not appear here by
      // default. Everything in this file lists fields explicitly for that
      // reason.
      prisma.user.findMany({
        where: { companyId },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.customer.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.conversation.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.message.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.businessService.findMany({
        where: { companyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.product.findMany({
        where: { companyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.businessHour.findMany({ where: { companyId } }),
      prisma.frequentlyAskedQuestion.findMany({
        where: { companyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.knowledgeBaseEntry.findMany({
        where: { companyId },
        orderBy: { sortOrder: 'asc' },
      }),
      // Metadata only — `data` (the raw PDF bytes) is never selected.
      prisma.knowledgeDocument.findMany({
        where: { companyId },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
          pageCount: true,
          extractedCharacters: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.companyAISettings.findUnique({ where: { companyId } }),
      prisma.appointment.findMany({ where: { companyId } }),
      prisma.order.findMany({
        where: { companyId },
        include: { items: true },
      }),
      prisma.supportTicket.findMany({ where: { companyId } }),
      // Channel accounts WITHOUT their credentials (a separate, encrypted
      // table that is never exported).
      prisma.channelAccount.findMany({
        where: { companyId },
        select: {
          id: true,
          providerKey: true,
          channelType: true,
          displayName: true,
          externalAccountId: true,
          status: true,
          connectionState: true,
          isEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      meta: {
        formatVersion: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        companyId,
        excluded: EXCLUDED,
        counts: {
          users: users.length,
          customers: customers.length,
          conversations: conversations.length,
          messages: messages.length,
          services: services.length,
          products: products.length,
          faqs: faqs.length,
          knowledgeBaseEntries: knowledgeBaseEntries.length,
          knowledgeDocuments: knowledgeDocuments.length,
          appointments: appointments.length,
          orders: orders.length,
          supportTickets: supportTickets.length,
          channelAccounts: channelAccounts.length,
        },
      },
      company,
      users,
      customers,
      conversations,
      messages,
      services,
      products,
      businessHours,
      faqs,
      knowledgeBaseEntries,
      knowledgeDocuments,
      aiSettings,
      appointments,
      orders,
      supportTickets,
      channelAccounts,
    };
  },

  /** Stable, human-recognisable download filename. */
  fileName(slug: string): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${slug}-export-${date}.json`;
  },
};
