import { z } from 'zod';
import { Router } from 'express';
import { internalNotesController } from './internal-notes.controller';
import {
  createNoteSchema,
  updateNoteSchema,
} from './internal-notes.validation';
import { uuidParam } from '../../validations/common.validation';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router({ mergeParams: true });
const convParam = uuidParam('conversationId');
const convNoteParams = z.object({
  conversationId: z.string().uuid(),
  noteId: z.string().uuid(),
});

router.get(
  '/',
  validate({ params: convParam }),
  asyncHandler(internalNotesController.list),
);

router.post(
  '/',
  validate({ params: convParam, body: createNoteSchema }),
  asyncHandler(internalNotesController.create),
);

router.patch(
  '/:noteId',
  validate({ params: convNoteParams, body: updateNoteSchema }),
  asyncHandler(internalNotesController.update),
);

router.delete(
  '/:noteId',
  validate({ params: convNoteParams }),
  asyncHandler(internalNotesController.remove),
);

export const internalNotesRoutes = router;
