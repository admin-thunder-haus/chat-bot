import { companiesRepository } from '../companies/companies.repository';
import { servicesRepository } from '../services/services.repository';
import { faqsRepository } from '../faqs/faqs.repository';
import { knowledgeBaseRepository } from '../knowledge-base/knowledge-base.repository';
import { businessHoursRepository } from '../business-hours/business-hours.repository';
import { aiSettingsRepository } from '../ai-settings/ai-settings.repository';
import { AppError } from '../../utils/AppError';

export interface OverviewStats {
  company: { id: string; name: string; slug: string };
  counts: {
    services: number;
    activeServices: number;
    faqs: number;
    knowledgeBaseEntries: number;
    businessHoursConfiguredDays: number;
  };
  businessHoursComplete: boolean;
  autoReplyEnabled: boolean;
  setup: {
    completedSteps: number;
    totalSteps: number;
    progressPercent: number;
  };
}

const TOTAL_DAYS = 7;

/** Aggregate all Day 2 counts for the authenticated company in one round-trip. */
export const overviewService = {
  async getStats(companyId: string): Promise<OverviewStats> {
    const company = await companiesRepository.findById(companyId);
    if (!company) throw AppError.notFound('Company not found');

    const [
      services,
      activeServices,
      faqs,
      knowledgeBaseEntries,
      businessHoursConfiguredDays,
      aiSettings,
    ] = await Promise.all([
      servicesRepository.countAll(companyId),
      servicesRepository.countActive(companyId),
      faqsRepository.countAll(companyId),
      knowledgeBaseRepository.countAll(companyId),
      businessHoursRepository.countByCompany(companyId),
      aiSettingsRepository.findByCompany(companyId),
    ]);

    const businessHoursComplete = businessHoursConfiguredDays >= TOTAL_DAYS;

    // Setup checklist — 6 steps, each contributes equally to the percentage.
    const steps = [
      Boolean(company.description || company.displayName),
      services > 0,
      businessHoursConfiguredDays > 0,
      faqs > 0,
      knowledgeBaseEntries > 0,
      aiSettings !== null,
    ];
    const completedSteps = steps.filter(Boolean).length;
    const totalSteps = steps.length;

    return {
      company: { id: company.id, name: company.name, slug: company.slug },
      counts: {
        services,
        activeServices,
        faqs,
        knowledgeBaseEntries,
        businessHoursConfiguredDays,
      },
      businessHoursComplete,
      autoReplyEnabled: aiSettings?.autoReplyEnabled ?? false,
      setup: {
        completedSteps,
        totalSteps,
        progressPercent: Math.round((completedSteps / totalSteps) * 100),
      },
    };
  },
};
