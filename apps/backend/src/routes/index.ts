import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes';
import { healthRoutes } from './health.routes';
import { companiesRoutes } from '../modules/companies/companies.routes';
import { servicesRoutes } from '../modules/services/services.routes';
import { productsRoutes } from '../modules/products/products.routes';
import { imagesRoutes, publicImagesRoutes } from '../modules/images/images.routes';
import { businessHoursRoutes } from '../modules/business-hours/business-hours.routes';
import { faqsRoutes } from '../modules/faqs/faqs.routes';
import { knowledgeBaseRoutes } from '../modules/knowledge-base/knowledge-base.routes';
import { aiSettingsRoutes } from '../modules/ai-settings/ai-settings.routes';
import { overviewRoutes } from '../modules/overview/overview.routes';
import { customersRoutes } from '../modules/customers/customers.routes';
import { conversationsRoutes } from '../modules/conversations/conversations.routes';
import { conversationTagsRoutes } from '../modules/conversation-tags/conversation-tags.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { mockInboundRoutes } from '../modules/mock-inbound/mock-inbound.routes';
import { aiRoutes } from '../modules/ai/ai.routes';
import { channelsRoutes } from '../modules/channels';
import { isProduction } from '../config/env';

/**
 * Root router for API version 1. Mounted at /api/v1 in app.ts.
 * New feature modules (channels, conversations, etc.) register here.
 */
const router = Router();

// Day 1
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

// Day 2 — company business configuration
router.use('/company', companiesRoutes);
router.use('/services', servicesRoutes);
router.use('/products', productsRoutes);
// Image uploads (auth) + anonymous serving for channel-provider fetches.
router.use('/images', imagesRoutes);
router.use('/public/images', publicImagesRoutes);
router.use('/business-hours', businessHoursRoutes);
router.use('/faqs', faqsRoutes);
router.use('/knowledge-base', knowledgeBaseRoutes);
router.use('/ai-settings', aiSettingsRoutes);
router.use('/overview', overviewRoutes);

// Day 3 — inbox: customers, conversations, messaging, tags
router.use('/customers', customersRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/conversation-tags', conversationTagsRoutes);
router.use('/users', usersRoutes);

// Day 4 — AI response engine (global routes; conversation-scoped AI routes
// live under /conversations/:id/ai/*).
router.use('/ai', aiRoutes);

// Day 5 Part 1 — channel integration framework (tenant-scoped account APIs).
// The public webhook engine is mounted separately in app.ts (no JWT).
router.use('/channels', channelsRoutes);

// Development-only mock inbound endpoint (never mounted in production).
if (!isProduction) {
  router.use('/dev', mockInboundRoutes);
}

export const apiV1Router = router;
