import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
} from '../../validations/common.validation';

/** POST /auth/register */
export const registerSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, 'Company name must be at least 2 characters')
    .max(100, 'Company name must be at most 100 characters'),
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must be at most 100 characters'),
  email: emailSchema,
  password: passwordSchema,
});

/** POST /auth/login */
export const loginSchema = z.object({
  email: emailSchema,
  // Only presence is checked here; strength is irrelevant for login.
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /auth/refresh — the token normally arrives via httpOnly cookie, but a
 * body fallback is accepted for non-browser clients.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
