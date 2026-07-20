import type { DayOfWeek } from '@prisma/client';
import { businessHoursRepository } from './business-hours.repository';
import {
  buildWeeklySchedule,
  serializeHour,
  type WeeklyDay,
} from './business-hours.types';
import type {
  SingleDayInput,
  UpdateScheduleInput,
} from './business-hours.validation';

export const businessHoursService = {
  /** Full weekly schedule (all 7 days, missing days default to closed). */
  async getSchedule(companyId: string): Promise<WeeklyDay[]> {
    const rows = await businessHoursRepository.listByCompany(companyId);
    return buildWeeklySchedule(rows);
  },

  /** Upsert the provided days, then return the complete weekly schedule. */
  async saveSchedule(
    companyId: string,
    input: UpdateScheduleInput,
  ): Promise<WeeklyDay[]> {
    const days = input.hours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      isClosed: h.isClosed,
      openTime: h.openTime ?? null,
      closeTime: h.closeTime ?? null,
    }));
    await businessHoursRepository.upsertMany(companyId, days);
    return this.getSchedule(companyId);
  },

  /** Upsert a single day and return it. */
  async updateDay(
    companyId: string,
    dayOfWeek: DayOfWeek,
    input: SingleDayInput,
  ): Promise<WeeklyDay> {
    const row = await businessHoursRepository.upsertOne(companyId, {
      dayOfWeek,
      isClosed: input.isClosed,
      openTime: input.openTime ?? null,
      closeTime: input.closeTime ?? null,
    });
    return serializeHour(row);
  },
};
