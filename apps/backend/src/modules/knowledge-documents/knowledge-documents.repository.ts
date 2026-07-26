import crypto from 'node:crypto';
import type {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import {
  knowledgeDocumentStorageKey,
  storageService,
} from '../storage/storage.service';

// Everything except the raw bytes — the standard read shape. `data` is only
// ever selected for downloads.
const documentSelect = {
  id: true,
  companyId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  pageCount: true,
  extractedCharacters: true,
  failureReason: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.KnowledgeDocumentSelect;

export type KnowledgeDocumentRow = Omit<KnowledgeDocument, 'data'> & {
  _count: { chunks: number };
};

/** Data-access for knowledge documents. EVERY query is companyId-scoped. */
export const knowledgeDocumentsRepository = {
  /**
   * The id is generated here (not by the database default) so the object key is
   * known before the upload — see imagesRepository.create for the same reasoning.
   */
  async create(input: {
    companyId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    data: Buffer;
  }): Promise<KnowledgeDocument> {
    const id = crypto.randomUUID();
    const { inlineData } = await storageService.put({
      key: knowledgeDocumentStorageKey(input.companyId, id),
      contentType: input.mimeType,
      data: input.data,
    });
    return prisma.knowledgeDocument.create({
      // DB mode: `inlineData` is exactly `new Uint8Array(input.data)`, i.e. the
      // one INSERT of the same bytes this always did.
      data: { ...input, id, data: inlineData },
    });
  },

  list(companyId: string): Promise<KnowledgeDocumentRow[]> {
    return prisma.knowledgeDocument.findMany({
      where: { companyId },
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
    });
  },

  findByIdScoped(
    companyId: string,
    id: string,
  ): Promise<KnowledgeDocumentRow | null> {
    return prisma.knowledgeDocument.findFirst({
      where: { id, companyId },
      select: documentSelect,
    });
  },

  /**
   * Download + extraction path: the stored original bytes, resolved through the
   * storage provider. The `data` column is still selected in both modes because
   * it is the pre-migration home of the bytes AND the marker that a row has been
   * migrated (empty = the object lives in the bucket).
   */
  async findDataScoped(
    companyId: string,
    id: string,
  ): Promise<{ fileName: string; mimeType: string; data: Buffer } | null> {
    const row = await prisma.knowledgeDocument.findFirst({
      where: { id, companyId },
      select: { id: true, fileName: true, mimeType: true, data: true },
    });
    if (!row) return null;
    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      data: await storageService.get({
        key: knowledgeDocumentStorageKey(companyId, row.id),
        inline: row.data,
      }),
    };
  },

  /**
   * Persist an extraction outcome: replace the document's chunks and stamp
   * its status atomically so retrieval never sees a half-processed document.
   */
  async applyExtraction(
    companyId: string,
    documentId: string,
    outcome:
      | {
          status: 'READY';
          pageCount: number;
          extractedCharacters: number;
          chunks: string[];
        }
      | { status: 'FAILED'; failureReason: string },
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeDocumentChunk.deleteMany({
        where: { documentId, companyId },
      });

      if (outcome.status === 'READY') {
        if (outcome.chunks.length > 0) {
          await tx.knowledgeDocumentChunk.createMany({
            data: outcome.chunks.map((content, chunkIndex) => ({
              companyId,
              documentId,
              chunkIndex,
              content,
            })),
          });
        }
        await tx.knowledgeDocument.update({
          where: { id: documentId },
          data: {
            status: 'READY',
            pageCount: outcome.pageCount,
            extractedCharacters: outcome.extractedCharacters,
            failureReason: null,
          },
        });
      } else {
        await tx.knowledgeDocument.update({
          where: { id: documentId },
          data: {
            status: 'FAILED',
            pageCount: null,
            extractedCharacters: null,
            failureReason: outcome.failureReason,
          },
        });
      }
    });
  },

  /**
   * Replace the stored file ahead of re-extraction. The object key is unchanged
   * (it is derived from the id), so this OVERWRITES the previous object — no
   * orphan, and no window where the row points at the old file.
   *
   * A replace aimed at another tenant's document writes under the CALLER's own
   * key prefix and then matches zero rows here, so the victim's object is never
   * touched; the only cost is an orphaned object the caller paid for.
   */
  async replaceFile(
    companyId: string,
    id: string,
    input: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      data: Buffer;
    },
  ): Promise<number> {
    const { inlineData } = await storageService.put({
      key: knowledgeDocumentStorageKey(companyId, id),
      contentType: input.mimeType,
      data: input.data,
    });
    const result = await prisma.knowledgeDocument.updateMany({
      where: { id, companyId },
      data: {
        ...input,
        data: inlineData,
        status: 'PROCESSING' satisfies KnowledgeDocumentStatus,
      },
    });
    return result.count;
  },

  async setActive(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<number> {
    const result = await prisma.knowledgeDocument.updateMany({
      where: { id, companyId },
      data: { isActive },
    });
    return result.count;
  },

  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.knowledgeDocument.deleteMany({
      where: { id, companyId },
    });
    // Object dropped only after the row is gone (no-op in DB mode): an orphaned
    // object is cheap, a row without its file is a broken download.
    if (result.count > 0) {
      await storageService.delete(knowledgeDocumentStorageKey(companyId, id));
    }
    return result.count;
  },

  /**
   * Retrieval: rank READY+active chunks of active documents by search-term
   * hits. Uses the same case-insensitive contains strategy as the rest of
   * the retrieval layer (deterministic, no vector store).
   */
  searchChunks(
    companyId: string,
    terms: string[],
    limit: number,
  ): Promise<
    { id: string; documentId: string; content: string; fileName: string }[]
  > {
    if (terms.length === 0) return Promise.resolve([]);
    const or: Prisma.KnowledgeDocumentChunkWhereInput[] = terms.map((t) => ({
      content: { contains: t, mode: 'insensitive' },
    }));
    return prisma.knowledgeDocumentChunk
      .findMany({
        where: {
          companyId,
          OR: or,
          document: { status: 'READY', isActive: true },
        },
        select: {
          id: true,
          documentId: true,
          content: true,
          document: { select: { fileName: true } },
        },
        take: limit,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          content: r.content,
          fileName: r.document.fileName,
        })),
      );
  },
};
