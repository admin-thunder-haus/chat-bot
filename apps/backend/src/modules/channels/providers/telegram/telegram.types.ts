/**
 * Telegram Bot API types. Everything platform-specific lives inside the Telegram
 * provider — these types never leak into core modules.
 *
 * Telegram differs from the Meta providers: auth is a single bot token (in the
 * request PATH, never a header), there is NO HMAC signature (webhook security is
 * a secret token echoed in the X-Telegram-Bot-Api-Secret-Token header), there is
 * NO GET verification handshake, and the inbound update already carries the
 * sender's name/username (no profile lookup needed).
 */

/** Encrypted per-account secrets (stored via ChannelCredential, never returned). */
export interface TelegramCredentials {
  /** Bot token from @BotFather, e.g. "123456789:AA…". Used in the API path. */
  botToken: string;
  /** Random secret set via setWebhook; echoed by Telegram in a header we verify. */
  secretToken: string;
}

/** Safe, non-secret account config (stored in ChannelAccount.metadata.telegram). */
export interface TelegramConfig {
  /** Numeric bot id (the part before ":" in the token; also externalAccountId). */
  botId: string;
  /** Bot @username (display only). */
  botUsername?: string;
  /** Human-readable bot name (display only). */
  botName?: string;
}

// --- Telegram webhook Update shapes (defensively partial/optional) ---

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: { id?: string };
}

export interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  date?: number; // unix seconds
  text?: string;
  reply_to_message?: { message_id?: number };
  /** Inbound voice note (downloaded via getFile + transcribed). */
  voice?: TelegramVoice;
  // Non-text content markers (recorded as unsupported):
  photo?: unknown[];
  document?: unknown;
  sticker?: unknown;
  video?: unknown;
  location?: unknown;
}

export interface TelegramVoice {
  file_id?: string;
  file_unique_id?: string;
  duration?: number; // seconds
  mime_type?: string;
}

export interface TelegramUser {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id?: number;
  type?: string; // "private" | "group" | ...
  first_name?: string;
  last_name?: string;
  username?: string;
}

// --- Bot API response shapes ---

export interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export interface TelegramSendResult {
  message_id?: number;
}

/** getFile result: the relative path used on the file-download endpoint. */
export interface TelegramGetFileResult {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramGetMeResult {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
