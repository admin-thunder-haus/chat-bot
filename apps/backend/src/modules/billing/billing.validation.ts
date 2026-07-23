import { z } from 'zod';

/** Body for POST /billing/change-plan. */
export const changePlanSchema = z
  .object({
    planCode: z.string().trim().min(1).max(50),
    billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof changePlanSchema>;
