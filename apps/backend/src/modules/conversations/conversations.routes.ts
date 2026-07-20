import { z } from 'zod';
import { Router } from 'express';
import { conversationsController } from './conversations.controller';
import {
  archiveSchema,
  conversationListQuerySchema,
  createConversationSchema,
  prioritySchema,
  statusSchema,
  updateConversationSchema,
} from './conversations.validation';
import { conversationTagsController } from '../conversation-tags/conversation-tags.controller';
import { assignmentSchema } from '../assignments/assignments.validation';
import { messagesRoutes } from '../messages/messages.routes';
import { internalNotesRoutes } from '../internal-notes/internal-notes.routes';
import { aiController } from '../ai/ai.controller';
import {
  aiModeSchema,
  draftSchema,
  regenerateSchema,
  replySchema,
} from '../ai/ai.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { aiRateLimiter } from '../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const convParam = uuidParam('conversationId');
const convTagParams = z.object({
  conversationId: z.string().uuid(),
  tagId: z.string().uuid(),
});

router.use(authenticate);

// --- collection ---
router.get(
  '/',
  validate({ query: conversationListQuerySchema }),
  asyncHandler(conversationsController.list),
);

router.post(
  '/',
  writeRoles,
  validate({ body: createConversationSchema }),
  asyncHandler(conversationsController.create),
);

// --- nested sub-resources (all roles) ---
router.use('/:conversationId/messages', messagesRoutes);
router.use('/:conversationId/notes', internalNotesRoutes);

// Tag attach/detach — AGENT may attach/detach existing tags.
router.post(
  '/:conversationId/tags/:tagId',
  validate({ params: convTagParams }),
  asyncHandler(conversationTagsController.attach),
);
router.delete(
  '/:conversationId/tags/:tagId',
  validate({ params: convTagParams }),
  asyncHandler(conversationTagsController.detach),
);

// --- Day 4: AI actions on a conversation ---
// Drafts: any authenticated role. Direct AI send: OWNER/ADMIN only.
router.post(
  '/:conversationId/ai/draft',
  aiRateLimiter,
  validate({ params: convParam, body: draftSchema }),
  asyncHandler(aiController.draft),
);
router.post(
  '/:conversationId/ai/regenerate',
  aiRateLimiter,
  validate({ params: convParam, body: regenerateSchema }),
  asyncHandler(aiController.regenerate),
);
router.post(
  '/:conversationId/ai/reply',
  writeRoles,
  aiRateLimiter,
  validate({ params: convParam, body: replySchema }),
  asyncHandler(aiController.reply),
);
router.patch(
  '/:conversationId/ai-mode',
  validate({ params: convParam, body: aiModeSchema }),
  asyncHandler(aiController.setMode),
);

// --- single-conversation state changes ---
router.patch(
  '/:conversationId/status',
  validate({ params: convParam, body: statusSchema }),
  asyncHandler(conversationsController.setStatus),
);
router.patch(
  '/:conversationId/priority',
  validate({ params: convParam, body: prioritySchema }),
  asyncHandler(conversationsController.setPriority),
);
router.patch(
  '/:conversationId/assignment',
  validate({ params: convParam, body: assignmentSchema }),
  asyncHandler(conversationsController.setAssignment),
);
router.patch(
  '/:conversationId/archive',
  writeRoles,
  validate({ params: convParam, body: archiveSchema }),
  asyncHandler(conversationsController.setArchived),
);
router.patch(
  '/:conversationId/read',
  validate({ params: convParam }),
  asyncHandler(conversationsController.markRead),
);
router.get(
  '/:conversationId/activity',
  validate({ params: convParam }),
  asyncHandler(conversationsController.activity),
);

// --- single conversation (generic) — declared after the specific sub-paths ---
router.get(
  '/:conversationId',
  validate({ params: convParam }),
  asyncHandler(conversationsController.getOne),
);
router.patch(
  '/:conversationId',
  writeRoles,
  validate({ params: convParam, body: updateConversationSchema }),
  asyncHandler(conversationsController.update),
);

export const conversationsRoutes = router;
