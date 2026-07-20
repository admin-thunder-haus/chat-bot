// Aggregation point for module controllers. Controllers only receive validated
// input, call services, and shape responses — no business logic.
export { authController } from '../modules/auth/auth.controller';
export { companiesController } from '../modules/companies/companies.controller';
export { servicesController } from '../modules/services/services.controller';
export { businessHoursController } from '../modules/business-hours/business-hours.controller';
export { faqsController } from '../modules/faqs/faqs.controller';
export { knowledgeBaseController } from '../modules/knowledge-base/knowledge-base.controller';
export { aiSettingsController } from '../modules/ai-settings/ai-settings.controller';
export { overviewController } from '../modules/overview/overview.controller';
export { customersController } from '../modules/customers/customers.controller';
export { conversationsController } from '../modules/conversations/conversations.controller';
export { messagesController } from '../modules/messages/messages.controller';
export { internalNotesController } from '../modules/internal-notes/internal-notes.controller';
export { conversationTagsController } from '../modules/conversation-tags/conversation-tags.controller';
export { mockInboundController } from '../modules/mock-inbound/mock-inbound.controller';
export { usersController } from '../modules/users/users.controller';
export { aiController } from '../modules/ai/ai.controller';
