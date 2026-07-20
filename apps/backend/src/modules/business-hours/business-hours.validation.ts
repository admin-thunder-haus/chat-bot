import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';
import { hhmmSchema } from '../../validations/common.validation';

/** Cross-field rules for a single day's hours. */
function validateDay(
  data: { isClosed: boolean; openTime?: string | null; closeTime?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (data.isClosed) {
    if (data.openTime != null || data.closeTime != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['openTime'],
        message: 'A closed day must not have open/close times',
      });
    }
    return;
  }
  if (!data.openTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['openTime'],
      message: 'Opening time is required when the day is open',
    });
  }
  if (!data.closeTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closeTime'],
      message: 'Closing time is required when the day is open',
    });
  }
  // "HH:mm" strings compare lexicographically for 24-hour zero-padded values.
  if (data.openTime && data.closeTime && data.closeTime <= data.openTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closeTime'],
      message: 'Closing time must be after opening time',
    });
  }
}

const dayEntrySchema = z
  .object({
    dayOfWeek: z.nativeEnum(DayOfWeek, {
      errorMap: () => ({ message: 'Invalid day of week' }),
    }),
    isClosed: z.boolean().default(false),
    openTime: hhmmSchema.nullable().optional(),
    closeTime: hhmmSchema.nullable().optional(),
  })
  .strict()
  .superRefine(validateDay);

/** PUT /business-hours — upsert a full weekly schedule. */
export const updateScheduleSchema = z
  .object({
    hours: z.array(dayEntrySchema).min(1).max(7),
  })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<DayOfWeek>();
    data.hours.forEach((h, index) => {
      if (seen.has(h.dayOfWeek)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hours', index, 'dayOfWeek'],
          message: `Duplicate entry for ${h.dayOfWeek}`,
        });
      }
      seen.add(h.dayOfWeek);
    });
  });

/** PATCH /business-hours/:dayOfWeek — single day (day comes from the param). */
export const singleDayBodySchema = z
  .object({
    isClosed: z.boolean().default(false),
    openTime: hhmmSchema.nullable().optional(),
    closeTime: hhmmSchema.nullable().optional(),
  })
  .strict()
  .superRefine(validateDay);

export const dayOfWeekParamSchema = z.object({
  dayOfWeek: z.nativeEnum(DayOfWeek, {
    errorMap: () => ({ message: 'Invalid day of week' }),
  }),
});

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type SingleDayInput = z.infer<typeof singleDayBodySchema>;
