import type { Request, Response } from 'express';
import { knowledgeDocumentsService } from './knowledge-documents.service';
import { sendSuccess } from '../../utils/apiResponse';

export const knowledgeDocumentsController = {
  async list(req: Request, res: Response): Promise<void> {
    const documents = await knowledgeDocumentsService.list(
      req.user!.companyId,
    );
    sendSuccess(res, { documents }, 'Documents retrieved successfully');
  },

  async upload(req: Request, res: Response): Promise<void> {
    const documents = await knowledgeDocumentsService.upload(
      req.user!.companyId,
      req.files as Express.Multer.File[],
    );
    sendSuccess(res, { documents }, 'Documents uploaded successfully', 201);
  },

  async replace(req: Request, res: Response): Promise<void> {
    const files = req.files as Express.Multer.File[];
    const document = await knowledgeDocumentsService.replace(
      req.user!.companyId,
      req.params.documentId,
      files[0],
    );
    sendSuccess(res, { document }, 'Document replaced successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const document = await knowledgeDocumentsService.setActive(
      req.user!.companyId,
      req.params.documentId,
      req.body.isActive,
    );
    sendSuccess(res, { document }, 'Document status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await knowledgeDocumentsService.remove(
      req.user!.companyId,
      req.params.documentId,
    );
    sendSuccess(res, null, 'Document deleted successfully');
  },

  async download(req: Request, res: Response): Promise<void> {
    const { fileName, mimeType, data } = await knowledgeDocumentsService.download(
      req.user!.companyId,
      req.params.documentId,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.send(data);
  },
};
