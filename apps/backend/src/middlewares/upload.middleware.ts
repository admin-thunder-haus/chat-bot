import multer, { MulterError } from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

/**
 * Excel (.xlsx) upload middleware. Files are held in memory only — parsed and
 * discarded within the request; nothing is ever written to disk.
 */

const MAX_EXCEL_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Some clients send generic types for .xlsx; the extension check below and
  // the workbook parser itself are the real gatekeepers.
  'application/octet-stream',
]);

const excelMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EXCEL_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const hasXlsxExtension = /\.xlsx$/i.test(file.originalname);
    if (!hasXlsxExtension || !XLSX_MIME_TYPES.has(file.mimetype)) {
      cb(
        AppError.badRequest('Only .xlsx Excel files are supported', [
          { field: 'file', message: 'Upload an Excel file (.xlsx)' },
        ]),
      );
      return;
    }
    cb(null, true);
  },
}).single('file');

const MAX_PDF_FILES_PER_UPLOAD = 5;
const MAX_PDF_FILE_BYTES = env.KNOWLEDGE_DOC_MAX_FILE_MB * 1024 * 1024;

const pdfMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_FILE_BYTES, files: MAX_PDF_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      /\.pdf$/i.test(file.originalname) &&
      ['application/pdf', 'application/octet-stream'].includes(file.mimetype);
    if (!isPdf) {
      cb(
        AppError.badRequest('Only PDF files are supported', [
          { field: 'files', message: 'Upload PDF files (.pdf)' },
        ]),
      );
      return;
    }
    cb(null, true);
  },
}).array('files', MAX_PDF_FILES_PER_UPLOAD);

/** Parse one or more PDF "files" fields, translating Multer errors. */
export function uploadPdfFiles(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  pdfMulter(req, res, (err: unknown) => {
    if (!err) {
      if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        next(
          AppError.badRequest('At least one PDF file is required', [
            { field: 'files', message: 'Attach PDFs as the "files" field' },
          ]),
        );
        return;
      }
      next();
      return;
    }

    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `A file is too large (max ${env.KNOWLEDGE_DOC_MAX_FILE_MB} MB per PDF)`
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Too many files (max ${MAX_PDF_FILES_PER_UPLOAD} per upload)`
            : 'Invalid file upload';
      next(AppError.badRequest(message, [{ field: 'files', message }]));
      return;
    }

    next(err);
  });
}

const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(
        AppError.badRequest('Only PNG, JPEG, WebP, or GIF images are supported', [
          { field: 'file', message: 'Unsupported image type' },
        ]),
      );
      return;
    }
    cb(null, true);
  },
}).single('file');

/** Parse a single image "file" field, translating Multer errors into AppErrors. */
export function uploadImageFile(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  imageMulter(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) {
        next(
          AppError.badRequest('An image file is required', [
            { field: 'file', message: 'Attach the image as the "file" field' },
          ]),
        );
        return;
      }
      next();
      return;
    }

    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Image is too large (max ${MAX_IMAGE_FILE_BYTES / (1024 * 1024)} MB)`
          : 'Invalid file upload';
      next(AppError.badRequest(message, [{ field: 'file', message }]));
      return;
    }

    next(err);
  });
}

/** Parse a single "file" field, translating Multer errors into AppErrors. */
export function uploadExcelFile(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  excelMulter(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) {
        next(
          AppError.badRequest('An Excel file is required', [
            { field: 'file', message: 'Attach the file as the "file" field' },
          ]),
        );
        return;
      }
      next();
      return;
    }

    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File is too large (max ${MAX_EXCEL_FILE_BYTES / (1024 * 1024)} MB)`
          : 'Invalid file upload';
      next(AppError.badRequest(message, [{ field: 'file', message }]));
      return;
    }

    next(err);
  });
}
