import { aiRepository, utcDay, type UsageDelta } from './ai.repository';
import { AIError } from './ai.errors';
import { env } from '../../config/env';
import { billingLimitsService } from '../billing/billing-limits.service';

export interface UsageSummary {
  date: string;
  today: {
    requestCount: number;
    totalTokenCount: number;
    estimatedCostUsd: string;
  };
  month: {
    totalTokenCount: number;
  };
  limits: {
    dailyRequestLimit: number;
    monthlyTokenLimit: number;
  };
  withinQuota: boolean;
}

export const aiUsageService = {
  /** Throw a safe quota error BEFORE any provider call if limits are reached. */
  async assertWithinQuota(companyId: string): Promise<void> {
    // Billing gates first: an EXPIRED subscription blocks AI entirely
    // (SUBSCRIPTION_EXPIRED) and the plan's monthly AI request cap applies
    // (PLAN_LIMIT_REACHED) alongside the env-level limits below.
    await billingLimitsService.assertAiRequestAllowed(companyId);

    const today = utcDay();
    const daily = await aiRepository.getDaily(companyId, today);
    if (daily && daily.requestCount >= env.AI_DAILY_COMPANY_REQUEST_LIMIT) {
      throw AIError.quotaExceeded('Daily AI request limit reached');
    }
    const monthTokens = await aiRepository.monthlyTokenTotal(companyId, today);
    if (monthTokens >= env.AI_MONTHLY_COMPANY_TOKEN_LIMIT) {
      throw AIError.quotaExceeded('Monthly AI token limit reached');
    }
  },

  /** Record a completed provider call into the daily aggregate (atomic). */
  record(companyId: string, delta: UsageDelta): Promise<void> {
    return aiRepository.recordUsage(companyId, utcDay(), delta);
  },

  async getSummary(companyId: string): Promise<UsageSummary> {
    const today = utcDay();
    const daily = await aiRepository.getDaily(companyId, today);
    const monthTokens = await aiRepository.monthlyTokenTotal(companyId, today);
    return {
      date: today.toISOString().slice(0, 10),
      today: {
        requestCount: daily?.requestCount ?? 0,
        totalTokenCount: daily?.totalTokenCount ?? 0,
        estimatedCostUsd: (daily?.estimatedCostUsd ?? 0).toString(),
      },
      month: { totalTokenCount: monthTokens },
      limits: {
        dailyRequestLimit: env.AI_DAILY_COMPANY_REQUEST_LIMIT,
        monthlyTokenLimit: env.AI_MONTHLY_COMPANY_TOKEN_LIMIT,
      },
      withinQuota:
        (daily?.requestCount ?? 0) < env.AI_DAILY_COMPANY_REQUEST_LIMIT &&
        monthTokens < env.AI_MONTHLY_COMPANY_TOKEN_LIMIT,
    };
  },
};
