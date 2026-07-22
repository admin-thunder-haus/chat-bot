import type {
  Company,
  Conversation,
  Customer,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { prisma } from './setup';
import { signAccessToken } from '../src/utils/jwt';

/**
 * Test fixtures mint access tokens directly (the auth middleware re-validates
 * the user against the DB), avoiding slow bcrypt login round-trips. Passwords
 * are irrelevant here, so a placeholder hash is stored.
 */
const PLACEHOLDER_HASH = 'test-placeholder-hash';

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createUser(
  companyId: string,
  role: UserRole,
  email: string,
): Promise<User> {
  return prisma.user.create({
    data: {
      companyId,
      email,
      fullName: `${role} user`,
      passwordHash: PLACEHOLDER_HASH,
      role,
      status: 'ACTIVE',
      // Helper-created users are verified so auth flows work out of the box.
      emailVerifiedAt: new Date(),
    },
  });
}

export interface Tenant {
  company: Company;
  users: { owner: User; admin: User; agent: User };
  tokens: { owner: string; admin: string; agent: string };
}

function tokenFor(user: User): string {
  return signAccessToken({
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
  });
}

/** Create a company with OWNER, ADMIN and AGENT users, plus their tokens. */
export async function setupTenant(prefix: string): Promise<Tenant> {
  const company = await prisma.company.create({
    data: { name: `${prefix} Co`, slug: prefix },
  });
  const owner = await createUser(company.id, 'OWNER', `${prefix}-owner@test.com`);
  const admin = await createUser(company.id, 'ADMIN', `${prefix}-admin@test.com`);
  const agent = await createUser(company.id, 'AGENT', `${prefix}-agent@test.com`);

  return {
    company,
    users: { owner, admin, agent },
    tokens: {
      owner: tokenFor(owner),
      admin: tokenFor(admin),
      agent: tokenFor(agent),
    },
  };
}

/** Fixture: create a customer directly (fast, bypasses the API). */
export function makeCustomer(
  companyId: string,
  overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {},
): Promise<Customer> {
  return prisma.customer.create({
    data: {
      companyId,
      channelType: 'MANUAL',
      fullName: 'Test Customer',
      ...overrides,
    },
  });
}

/** Fixture: create a conversation directly (fast, bypasses the API). */
export function makeConversation(
  companyId: string,
  customerId: string,
  overrides: Partial<Prisma.ConversationUncheckedCreateInput> = {},
): Promise<Conversation> {
  return prisma.conversation.create({
    data: {
      companyId,
      customerId,
      channelType: 'MANUAL',
      ...overrides,
    },
  });
}
