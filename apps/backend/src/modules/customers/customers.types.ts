import type { ChannelType, Prisma } from '@prisma/client';

export interface CustomerListFilters {
  page: number;
  limit: number;
  search?: string;
  channelType?: ChannelType;
  sortBy: 'createdAt' | 'lastSeenAt' | 'firstSeenAt' | 'fullName';
  sortOrder: 'asc' | 'desc';
}

/** Compact customer shape embedded in conversation payloads. */
export const customerSummarySelect = {
  id: true,
  companyId: true,
  channelType: true,
  fullName: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  username: true,
  avatarUrl: true,
} satisfies Prisma.CustomerSelect;
