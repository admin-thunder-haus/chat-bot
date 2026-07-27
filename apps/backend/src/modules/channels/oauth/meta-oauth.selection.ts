import { prisma } from '../../../config/prisma';
import { AppError } from '../../../utils/AppError';
import { channelSecurityService } from '../channel-security.service';
import type { MetaOauthProvider } from './meta-oauth.types';

/**
 * Pending asset selections for the Meta OAuth flow.
 *
 * When an authorization returns more than one eligible asset the flow parks the
 * discovered assets here and sends the operator to a picker, rather than
 * guessing. Two properties make this safe to expose to a browser:
 *
 * 1. The stored payload is ENCRYPTED (same AES-256-GCM service as channel
 *    credentials) because it carries Page / business access tokens next to the
 *    asset ids. Nothing in it is ever returned to the client — `toClientView`
 *    projects a token-free shape, and that projection is the ONLY way a
 *    selection is serialised outward.
 * 2. Every read is scoped by companyId. A selection id is a UUID a user could
 *    conceivably obtain (a shared screenshot, a copied URL), so possession of
 *    the id alone must never be enough. `load` requires the caller's own
 *    companyId to match, and answers "not found" — never "forbidden" — so the
 *    endpoint cannot be used to probe which selection ids exist.
 */

/** How long an operator has to choose before the selection expires. */
export const SELECTION_TTL_MS = 15 * 60 * 1000;

// --- Stored (secret-bearing) shapes ---------------------------------------

/** A Facebook Page, plus the Page token needed to actually connect it. */
export interface StoredPageAsset {
  pageId: string;
  pageName?: string;
  /** SECRET — never leaves the backend. */
  pageAccessToken: string;
  /** Present only when the Page has a linked Instagram professional account. */
  instagramAccountId?: string;
}

export interface StoredPhoneAsset {
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface StoredWabaAsset {
  wabaId: string;
  wabaName?: string;
  phones: StoredPhoneAsset[];
}

export interface StoredSelectionPayload {
  /** SECRET — the user/business token used for the connect + subscribe calls. */
  accessToken: string;
  pages?: StoredPageAsset[];
  wabas?: StoredWabaAsset[];
}

export interface LoadedSelection {
  id: string;
  companyId: string;
  userId: string;
  provider: MetaOauthProvider;
  payload: StoredSelectionPayload;
  expiresAt: Date;
}

// --- Client-facing (token-free) shapes ------------------------------------

export interface SelectionPageView {
  pageId: string;
  pageName: string | null;
  /** Instagram flow only: the professional account linked to this Page. */
  instagramAccountId: string | null;
}

export interface SelectionWabaView {
  wabaId: string;
  wabaName: string | null;
  phones: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }[];
}

export interface SelectionView {
  id: string;
  provider: MetaOauthProvider;
  expiresAt: Date;
  pages: SelectionPageView[];
  wabas: SelectionWabaView[];
}

/**
 * Project a selection for the client. Deliberately field-by-field rather than
 * a spread-and-delete: a token added to the stored shape later cannot leak by
 * being forgotten here, because it would have to be added explicitly.
 */
export function toClientView(selection: LoadedSelection): SelectionView {
  return {
    id: selection.id,
    provider: selection.provider,
    expiresAt: selection.expiresAt,
    pages: (selection.payload.pages ?? []).map((p) => ({
      pageId: p.pageId,
      pageName: p.pageName ?? null,
      instagramAccountId: p.instagramAccountId ?? null,
    })),
    wabas: (selection.payload.wabas ?? []).map((w) => ({
      wabaId: w.wabaId,
      wabaName: w.wabaName ?? null,
      phones: w.phones.map((ph) => ({
        phoneNumberId: ph.phoneNumberId,
        displayPhoneNumber: ph.displayPhoneNumber ?? null,
        verifiedName: ph.verifiedName ?? null,
      })),
    })),
  };
}

export const metaOauthSelectionStore = {
  /** Park the discovered assets and return the id the browser will carry. */
  async create(input: {
    companyId: string;
    userId: string;
    provider: MetaOauthProvider;
    payload: StoredSelectionPayload;
  }): Promise<string> {
    const encrypted = channelSecurityService.encrypt(
      input.payload as unknown as Record<string, unknown>,
    );
    const row = await prisma.metaOauthSelection.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        provider: input.provider,
        encryptedPayload: encrypted.encryptedPayload,
        encryptionVersion: encrypted.encryptionVersion,
        expiresAt: new Date(Date.now() + SELECTION_TTL_MS),
      },
      select: { id: true },
    });
    return row.id;
  },

  /**
   * Load a selection for a specific tenant. Returns null for every failure
   * mode — unknown id, another company's id, already consumed, expired — so a
   * caller cannot distinguish them and the endpoint leaks nothing.
   */
  async load(id: string, companyId: string): Promise<LoadedSelection | null> {
    const row = await prisma.metaOauthSelection.findFirst({
      // companyId in the WHERE, not checked afterwards: a scoping condition
      // that lives in the query cannot be skipped by an early return later.
      where: { id, companyId, consumedAt: null },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;

    const payload = channelSecurityService.decrypt(
      row.encryptedPayload,
      row.encryptionVersion,
    ) as unknown as StoredSelectionPayload;

    return {
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      provider: row.provider as MetaOauthProvider,
      payload,
      expiresAt: row.expiresAt,
    };
  },

  /**
   * Burn a selection. Conditional on it still being unconsumed, so two
   * concurrent connects cannot both proceed — the loser gets `false` and is
   * turned into the same "not found" the client would see for a stale id.
   */
  async consume(id: string, companyId: string): Promise<boolean> {
    const res = await prisma.metaOauthSelection.updateMany({
      where: { id, companyId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return res.count === 1;
  },

  /** Housekeeping: drop consumed/expired rows. */
  async prune(): Promise<number> {
    const res = await prisma.metaOauthSelection.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { consumedAt: { not: null } },
        ],
      },
    });
    return res.count;
  },
};

/** The single "this selection is not usable" error, used by every path. */
export function selectionNotFound(): AppError {
  return AppError.notFound('This connection request is no longer available');
}
