import { Router } from 'express';
import { z } from 'zod';
import { knowledgeDocumentsController } from './knowledge-documents.controller';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { uploadPdfFiles } from '../../middlewares/upload.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const documentIdParam = uuidParam('documentId');
const statusSchema = z.object({ isActive: z.boolean() }).strict();

router.use(authenticate);

// Reads — any authenticated role.
router.get('/', asyncHandler(knowledgeDocumentsController.list));

router.get(
  '/:documentId/download',
  validate({ params: documentIdParam }),
  asyncHandler(knowledgeDocumentsController.download),
);

// Writes — OWNER / ADMIN only.
router.post(
  '/',
  writeRoles,
  uploadPdfFiles,
  asyncHandler(knowledgeDocumentsController.upload),
);

router.post(
  '/:documentId/replace',
  writeRoles,
  validate({ params: documentIdParam }),
  uploadPdfFiles,
  asyncHandler(knowledgeDocumentsController.replace),
);

router.patch(
  '/:documentId/status',
  writeRoles,
  validate({ params: documentIdParam, body: statusSchema }),
  asyncHandler(knowledgeDocumentsController.setStatus),
);

router.delete(
  '/:documentId',
  writeRoles,
  validate({ params: documentIdParam }),
  asyncHandler(knowledgeDocumentsController.remove),
);

export const knowledgeDocumentsRoutes = router;
