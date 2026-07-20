import { z } from 'zod';

export const assignmentSchema = z
  .object({
    // Explicit null means "unassign". A UUID assigns to that user.
    assignedUserId: z.string().uuid().nullable(),
  })
  .strict();

export type AssignmentInput = z.infer<typeof assignmentSchema>;
