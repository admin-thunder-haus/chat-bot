import type { Company } from '@prisma/client';
import { companiesRepository } from './companies.repository';
import { AppError } from '../../utils/AppError';
import type { UpdateProfileInput } from './companies.validation';

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
};
