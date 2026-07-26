import type { Company } from '@prisma/client';
import { prisma } from '../../config/prisma';
import {
  imageStorageKey,
  knowledgeDocumentStorageKey,
  storageService,
} from '../storage/storage.service';
import { companiesRepository } from './companies.repository';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import type { UpdateProfileInput } from './companies.validation';

/**
 * Remove every stored object belonging to a tenant.
 *
 * Best-effort per object: a bucket that refuses one delete must not abort the
 * account deletion the customer asked for. A failure is logged loudly with the
 * key so it can be cleaned up by hand or by a lifecycle rule — the alternative
 * (refusing to delete the account because one object is stuck) is worse.
 */
async function deleteStoredFiles(companyId: string): Promise<void> {
  const [images, documents] = await Promise.all([
    prisma.storedImage.findMany({ where: { companyId }, select: { id: true } }),
    prisma.knowledgeDocument.findMany({
      where: { companyId },
      select: { id: true },
    }),
  ]);

  const keys = [
    ...images.map((i) => imageStorageKey(companyId, i.id)),
    ...documents.map((d) => knowledgeDocumentStorageKey(companyId, d.id)),
  ];

  let failed = 0;
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await storageService.delete(key);
    } catch (err) {
      failed += 1;
      logger.error('company.delete.storageObjectFailed', {
        companyId,
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('company.delete.storageCleaned', {
    companyId,
    provider: storageService.providerName(),
    objects: keys.length,
    failed,
  });
}

/**
 * Business logic for companies. companyId is always supplied by the caller
 * from the authenticated identity (req.user.companyId), never from client input.
 */
export const companiesService = {
  async getById(companyId: string): Promise<Company> {
    const company = await companiesRepository.findById(companyId);
    if (!company) {
      throw AppError.notFound('Company not found');
    }
    return company;
  },

  /** Return the authenticated company's full profile. */
  getProfile(companyId: string): Promise<Company> {
    return this.getById(companyId);
  },

  /**
   * Apply a partial profile update. The slug is intentionally NOT derived from
   * a changed `name` here — slugs are stable identifiers and rotating them
   * could break external references. id/slug/status are never touched.
   */
  async updateProfile(
    companyId: string,
    input: UpdateProfileInput,
  ): Promise<Company> {
    // Ensure the company exists (and surfaces a clean 404 if somehow missing).
    await this.getById(companyId);
    return companiesRepository.updateProfile(companyId, input);
  },

  /**
   * Permanently delete the tenant and everything in it. OWNER-only (enforced by
   * the route) and guarded by a typed-name confirmation: the caller must retype
   * the company name exactly, so this cannot happen through a mis-click or a
   * CSRF-style replay of an empty body.
   *
   * The comparison is case-insensitive and whitespace-trimmed — the point of
   * the confirmation is to prove intent, not to test typing accuracy.
   *
   * There is NO soft delete and no recovery. That is the honest behaviour for a
   * "delete my data" request: a tenant that asks to be erased must actually be
   * erased, not hidden behind a flag.
   */
  async deleteCompany(
    companyId: string,
    confirmName: string,
  ): Promise<{ deletedCompanyName: string }> {
    const company = await this.getById(companyId);

    const normalize = (v: string) => v.trim().toLowerCase();
    if (normalize(confirmName) !== normalize(company.name)) {
      throw AppError.badRequest(
        'The name you typed does not match this company. Type the company name exactly to confirm deletion.',
        [{ field: 'confirmName', message: 'This does not match the company name' }],
        'COMPANY_NAME_MISMATCH',
      );
    }

    logger.warn('company.delete.requested', {
      companyId,
      slug: company.slug,
      name: company.name,
    });

    // Stored FILES first, while the rows that name them still exist. In DB mode
    // this is a no-op (the bytes are in those rows and cascade with them); with
    // a bucket configured, the rows are the only record of which objects belong
    // to this tenant — delete them first and the objects are orphaned forever,
    // which would mean a customer who asked to be erased still has their
    // documents and their customers' voice notes sitting in our bucket.
    await deleteStoredFiles(companyId);

    await companiesRepository.hardDelete(companyId);

    // Logged at warn: this is irreversible, and the log line is the only trace
    // that survives it.
    logger.warn('company.delete.completed', { companyId, slug: company.slug });

    return { deletedCompanyName: company.name };
  },
};
