import type { BusinessHour, DayOfWeek } from '@prisma/client';
import { prisma } from '../../config/prisma';

interface DayData {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

/** Tenant-scoped data-access for business hours. */
export const businessHoursRepository = {
  listByCompany(companyId: string): Promise<BusinessHour[]> {
    return prisma.businessHour.findMany({
      where: { companyId },
      orderBy: { dayOfWeek: 'asc' },
    });
  },

  /** Upsert a full set of days in one transaction. */
  async upsertMany(companyId: string, days: DayData[]): Promise<void> {
    await prisma.$transaction(
      days.map((d) =>
        prisma.businessHour.upsert({
          where: { companyId_dayOfWeek: { companyId, dayOfWeek: d.dayOfWeek } },
          create: {
            companyId,
            dayOfWeek: d.dayOfWeek,
            isClosed: d.isClosed,
            openTime: d.openTime,
            closeTime: d.closeTime,
          },
          update: {
            isClosed: d.isClosed,
            openTime: d.openTime,
            closeTime: d.closeTime,
          },
        }),
      ),
    );
  },

  upsertOne(companyId: string, day: DayData): Promise<BusinessHour> {
    return prisma.businessHour.upsert({
      where: {
        companyId_dayOfWeek: { companyId, dayOfWeek: day.dayOfWeek },
      },
      create: {
        companyId,
        dayOfWeek: day.dayOfWeek,
        isClosed: day.isClosed,
        openTime: day.openTime,
        closeTime: day.closeTime,
      },
      update: {
        isClosed: day.isClosed,
        openTime: day.openTime,
        closeTime: day.closeTime,
      },
    });
  },

  countByCompany(companyId: string): Promise<number> {
    return prisma.businessHour.count({ where: { companyId } });
  },
};
