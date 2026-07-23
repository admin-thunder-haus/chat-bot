import type {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
} from '@prisma/client';

/** API representation of an uploaded document — never includes the bytes. */
export interface SerializedKnowledgeDocument {
  id: string;
  companyId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeDocumentStatus;
  pageCount: number | null;
  extractedCharacters: number | null;
  failureReason: string | null;
  isActive: boolean;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeKnowledgeDocument(
  row: Omit<KnowledgeDocument, 'data'> & { _count?: { chunks: number } },
): SerializedKnowledgeDocument {
  return {
    id: row.id,
    companyId: row.companyId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    pageCount: row.pageCount,
    extractedCharacters: row.extractedCharacters,
    failureReason: row.failureReason,
    isActive: row.isActive,
    chunkCount: row._count?.chunks ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
