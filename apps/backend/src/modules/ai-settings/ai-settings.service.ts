import { aiSettingsRepository } from './ai-settings.repository';
import {
  buildDefaultSettings,
  serializeSettings,
  type AISettingsView,
} from './ai-settings.types';
import type { UpdateAISettingsInput } from './ai-settings.validation';

export const aiSettingsService = {
  /** Return stored settings, or non-persisted defaults when none exist yet. */
  async get(companyId: string): Promise<AISettingsView> {
    const row = await aiSettingsRepository.findByCompany(companyId);
    return row ? serializeSettings(row) : buildDefaultSettings(companyId);
  },

  /**
   * Create or update settings via upsert. Only provided fields are written;
   * omitted fields fall back to the DB defaults (on create) or keep their
   * current values (on update). This is configuration only — no AI is invoked.
   */
  async save(
    companyId: string,
    input: UpdateAISettingsInput,
  ): Promise<AISettingsView> {
    const row = await aiSettingsRepository.upsert(companyId, input);
    return serializeSettings(row);
  },
};
