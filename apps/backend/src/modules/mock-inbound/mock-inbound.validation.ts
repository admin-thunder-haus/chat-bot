import { z } from 'zod';
import { ChannelType } from '@prisma/client';
import { MAX_MESSAGE_LENGTH } from '../conversations/conversations.validation';

// Day 3 simulates only MANUAL / WEBCHAT inbound traffic.
const allowedChannels = z.enum([ChannelType.MANUAL, ChannelType.WEBCHAT]);

const optionalTrim = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

export const mockInboundSchema = z
  .object({
    channelType: allowedChannels.default(ChannelType.MANUAL),
    externalCustomerId: z.string().trim().min(1).max(191),
    customer: z
      .object({
        fullName: optionalTrim(120),
        firstName: optionalTrim(80),
        lastName: optionalTrim(80),
        phone: optionalTrim(30),
        email: z.preprocess(
          (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
          z.string().trim().toLowerCase().email().max(254).optional(),
        ),
        username: optionalTrim(120),
      })
      .strict()
      .optional(),
    message: z
      .object({
        externalMessageId: z.string().trim().min(1).max(191),
        content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
      })
      .strict(),
  })
  .strict();

export type MockInboundInput = z.infer<typeof mockInboundSchema>;
