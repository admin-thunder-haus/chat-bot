import type { User } from '@prisma/client';
import { usersRepository } from './users.repository';
import { AppError } from '../../utils/AppError';

/**
 * Business logic for users. The companyId argument always originates from the
 * authenticated JWT identity, guaranteeing tenant isolation.
 */
export const usersService = {
  listByCompany(
    companyId: string,
  ): Promise<Omit<User, 'passwordHash'>[]> {
    return usersRepository.findManyByCompany(companyId);
  },

  async getByIdScoped(
    id: string,
    companyId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await usersRepository.findByIdScoped(id, companyId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return user;
  },

  listAssignable(companyId: string): Promise<Omit<User, 'passwordHash'>[]> {
    return usersRepository.findAssignable(companyId);
  },
};
