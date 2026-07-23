import { PDFParse } from 'pdf-parse';
import { knowledgeDocumentsRepository } from './knowledge-documents.repository';
import {
  serializeKnowledgeDocument,
  type SerializedKnowledgeDocument,
} from './knowledge-documents.types';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

/**
 * Chunking parameters: sized so a handful of retrieved chunks fit comfortably
 * inside the AI context budget. Overlap keeps sentences that straddle a
 * boundary findable from either side.
 */
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_DOCUMENT = 400;

/** Split extracted text into overlapping chunks on soft boundaries. */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
    let end = Math.min(start + CHUNK_SIZE, normalized.length);

    // Prefer to break at a paragraph, then sentence, then word boundary.
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf(' '),
      );
      if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Extract text + persist chunks for one stored document. Never throws. */
async function processDocument(
  companyId: string,
  documentId: string,
  buffer: Buffer,
): Promise<void> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    let text = '';
    let pageCount = 0;
    try {
      const parsed = await parser.getText();
      text = parsed.text ?? '';
      pageCount = parsed.total ?? 0;
    } finally {
      await parser.destroy();
    }
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await knowledgeDocumentsRepository.applyExtraction(companyId, documentId, {
        status: 'FAILED',
        failureReason:
          'No extractable text found (the PDF may be scanned images without a text layer)',
      });
      return;
    }

    await knowledgeDocumentsRepository.applyExtraction(companyId, documentId, {
      status: 'READY',
      pageCount,
      extractedCharacters: text.length,
      chunks,
    });
  } catch (err) {
    logger.warn('knowledge-document extraction failed', {
      companyId,
      documentId,
      message: err instanceof Error ? err.message : String(err),
    });
    await knowledgeDocumentsRepository.applyExtraction(companyId, documentId, {
      status: 'FAILED',
      failureReason: 'The file could not be read as a valid PDF',
    });
  }
}

export const knowledgeDocumentsService = {
  async list(companyId: string): Promise<SerializedKnowledgeDocument[]> {
    const rows = await knowledgeDocumentsRepository.list(companyId);
    return rows.map(serializeKnowledgeDocument);
  },

  /** Upload one or more PDFs; each is extracted + chunked synchronously. */
  async upload(
    companyId: string,
    files: UploadFile[],
  ): Promise<SerializedKnowledgeDocument[]> {
    const results: SerializedKnowledgeDocument[] = [];

    for (const file of files) {
      const created = await knowledgeDocumentsRepository.create({
        companyId,
        fileName: file.originalname,
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        data: file.buffer,
      });

      await processDocument(companyId, created.id, file.buffer);

      const fresh = await knowledgeDocumentsRepository.findByIdScoped(
        companyId,
        created.id,
      );
      if (fresh) results.push(serializeKnowledgeDocument(fresh));
    }

    return results;
  },

  /** Replace the file behind an existing document and re-extract. */
  async replace(
    companyId: string,
    id: string,
    file: UploadFile,
  ): Promise<SerializedKnowledgeDocument> {
    const count = await knowledgeDocumentsRepository.replaceFile(
      companyId,
      id,
      {
        fileName: file.originalname,
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        data: file.buffer,
      },
    );
    if (count === 0) throw AppError.notFound('Document not found');

    await processDocument(companyId, id, file.buffer);

    const fresh = await knowledgeDocumentsRepository.findByIdScoped(
      companyId,
      id,
    );
    if (!fresh) throw AppError.notFound('Document not found');
    return serializeKnowledgeDocument(fresh);
  },

  async setActive(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<SerializedKnowledgeDocument> {
    const count = await knowledgeDocumentsRepository.setActive(
      companyId,
      id,
      isActive,
    );
    if (count === 0) throw AppError.notFound('Document not found');
    const fresh = await knowledgeDocumentsRepository.findByIdScoped(
      companyId,
      id,
    );
    if (!fresh) throw AppError.notFound('Document not found');
    return serializeKnowledgeDocument(fresh);
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await knowledgeDocumentsRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Document not found');
  },

  /** Original bytes for download (tenant-scoped). */
  async download(
    companyId: string,
    id: string,
  ): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
    const doc = await knowledgeDocumentsRepository.findDataScoped(
      companyId,
      id,
    );
    if (!doc) throw AppError.notFound('Document not found');
    return {
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      data: Buffer.from(doc.data),
    };
  },
};
