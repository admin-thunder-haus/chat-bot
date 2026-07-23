export type UserRole = 'OWNER' | 'ADMIN' | 'AGENT';
export type UserStatus = 'ACTIVE' | 'DISABLED';
export type CompanyStatus = 'ACTIVE' | 'SUSPENDED';

export type ServicePriceType =
  | 'FIXED'
  | 'STARTING_FROM'
  | 'VARIABLE'
  | 'CONTACT_US'
  | 'FREE';

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type ReplyTone =
  | 'PROFESSIONAL'
  | 'FRIENDLY'
  | 'CASUAL'
  | 'FORMAL'
  | 'CONCISE';

export interface User {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  displayName: string | null;
  description: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  websiteUrl: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  defaultLanguage: string;
  responseLanguage: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiError {
  success: false;
  message: string;
  errors: { field?: string; message: string }[];
  requestId: string;
  /** Machine-readable discriminator (e.g. EMAIL_NOT_VERIFIED). */
  code?: string;
}

export interface AuthData {
  user: User;
  company: Company;
  accessToken: string;
  refreshToken?: string;
}

/** Registration response: no tokens until the email is verified. */
export interface RegisterData {
  user: User;
  company: Company;
  accessToken?: string;
  refreshToken?: string;
  requiresEmailVerification: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface Service {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  price: string | null;
  currency: string;
  priceType: ServicePriceType;
  durationMinutes: number | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  sku: string | null;
  category: string | null;
  /** Decimal serialized as a string; null means "price on request". */
  price: string | null;
  currency: string;
  stockQuantity: number | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// --- Excel import (services + products) ---

export interface ImportRowResult {
  rowNumber: number;
  data: Record<string, unknown> | null;
  raw: Record<string, unknown>;
  errors: { field?: string; message: string }[];
}

export interface ImportPreview {
  rows: ImportRowResult[];
  summary: { totalRows: number; validRows: number; invalidRows: number };
}

export interface ImportResult {
  created: number;
  updated: number;
  deleted: number;
  total: number;
}

export interface WeeklyDay {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface Faq {
  id: string;
  companyId: string;
  question: string;
  answer: string;
  category: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntry {
  id: string;
  companyId: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AISettings {
  id: string | null;
  companyId: string;
  assistantName: string | null;
  systemInstructions: string | null;
  replyTone: ReplyTone;
  preferredLanguage: string;
  fallbackMessage: string;
  humanHandoffMessage: string;
  maxReplyLength: number | null;
  useEmojis: boolean;
  autoReplyEnabled: boolean;
  handoffOnRequest: boolean;
  handoffOnLowConfidence: boolean;
  handoffKeywords: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

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

// --- Day 3: inbox (customers, conversations, messages) ---

export type ChannelType =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'TELEGRAM'
  | 'WEBCHAT'
  | 'EMAIL'
  | 'MANUAL';

export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type ConversationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSenderType = 'CUSTOMER' | 'AGENT' | 'SYSTEM' | 'AI';
export type MessageStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'RECEIVED';
export type ActivityType =
  | 'CONVERSATION_CREATED'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'
  | 'NOTE_ADDED'
  | 'ASSIGNEE_CHANGED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'TAG_ADDED'
  | 'TAG_REMOVED'
  | 'CUSTOMER_UPDATED'
  | 'AI_MODE_CHANGED'
  | 'AI_HANDOFF_REQUESTED';

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export interface Customer {
  id: string;
  companyId: string;
  externalId: string | null;
  channelType: ChannelType;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary {
  id: string;
  companyId: string;
  channelType: ChannelType;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface Tag {
  id: string;
  companyId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagAssignment {
  tag: Tag;
}

export interface MessagePreview {
  id: string;
  content: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  status: MessageStatus;
  createdAt: string;
}

export interface ConversationListItem {
  id: string;
  companyId: string;
  customerId: string;
  channelType: ChannelType;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundMessageAt: string | null;
  lastOutboundMessageAt: string | null;
  unreadCount: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  customer: CustomerSummary;
  assignedUser: UserSummary | null;
  tagAssignments: TagAssignment[];
  messages: MessagePreview[];
}

export interface ConversationDetail {
  id: string;
  companyId: string;
  customerId: string;
  channelType: ChannelType;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundMessageAt: string | null;
  lastOutboundMessageAt: string | null;
  unreadCount: number;
  isArchived: boolean;
  resolvedAt: string | null;
  closedAt: string | null;
  aiMode: AIConversationMode;
  aiPausedAt: string | null;
  handoffRequestedAt: string | null;
  handoffReason: string | null;
  aiSummary: string | null;
  aiSummaryGeneratedAt: string | null;
  detectedLanguage: string | null;
  createdAt: string;
  updatedAt: string;
  customer: Customer;
  assignedUser: UserSummary | null;
  tagAssignments: TagAssignment[];
}

export interface Message {
  id: string;
  companyId: string;
  conversationId: string;
  customerId: string | null;
  senderUserId: string | null;
  direction: MessageDirection;
  senderType: MessageSenderType;
  contentType: 'TEXT' | 'IMAGE' | 'AUDIO';
  content: string;
  mediaUrl: string | null;
  status: MessageStatus;
  createdAt: string;
  sentAt: string | null;
  senderUser: UserSummary | null;
  // Day 5 Part 2: provider delivery snapshot (null for local/manual/AI messages).
  delivery?: MessageDelivery | null;
}

export interface Note {
  id: string;
  companyId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: UserSummary | null;
}

export interface Activity {
  id: string;
  companyId: string;
  conversationId: string;
  actorUserId: string | null;
  activityType: ActivityType;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// --- Day 4: AI response engine ---

export type AIConversationMode = 'ENABLED' | 'PAUSED' | 'HUMAN_ONLY';
export type AIGenerationType =
  | 'DRAFT'
  | 'AUTO_REPLY'
  | 'PLAYGROUND'
  | 'REGENERATE'
  | 'SUMMARY'
  | 'SUGGESTION';

export interface AIContextSummary {
  companyProfile: boolean;
  businessHoursIncluded: boolean;
  serviceIds: string[];
  faqIds: string[];
  knowledgeIds: string[];
  historyMessageCount: number;
  approxCharacters: number;
  injectionSuspected: boolean;
}

export interface AIGenerationResult {
  generationId: string;
  generationType: AIGenerationType;
  text: string;
  model: string;
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
  handoffRequested: boolean;
  usedFallback: boolean;
  contextSummary: AIContextSummary;
}

export interface AIUsageSummary {
  date: string;
  today: {
    requestCount: number;
    totalTokenCount: number;
    estimatedCostUsd: string;
  };
  month: { totalTokenCount: number };
  limits: { dailyRequestLimit: number; monthlyTokenLimit: number };
  withinQuota: boolean;
}

// --- Day 5 Part 1: channel integration framework ---

export type ChannelAccountStatus =
  | 'DRAFT'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'SUSPENDED';

export type ChannelConnectionState =
  | 'UNKNOWN'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'AUTH_EXPIRED';

export interface ChannelCapabilities {
  textMessages: boolean;
  mediaMessages: boolean;
  messageReplies: boolean;
  deliveryReceipts: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  reactions: boolean;
  templates: boolean;
  customerProfiles: boolean;
  webhookVerification: boolean;
  webhookSignatures: boolean;
  outboundMessaging: boolean;
  inboundMessaging: boolean;
}

export interface ChannelProviderDescriptor {
  key: string;
  displayName: string;
  channelType: ChannelType;
  capabilities: ChannelCapabilities;
  available: boolean;
  developmentOnly: boolean;
  configurationComplete: boolean;
  comingSoon: boolean;
}

export type ChannelDeliveryStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type ChannelDeliveryFailureType = 'NONE' | 'TEMPORARY' | 'PERMANENT';

export interface MessageDelivery {
  status: ChannelDeliveryStatus;
  failureType: ChannelDeliveryFailureType;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
}

export interface ChannelHealthSample {
  id: string;
  checkType: 'MANUAL' | 'DELIVERY' | 'DIAGNOSTIC';
  state: ChannelConnectionState;
  healthy: boolean;
  healthScore: number;
  latencyMs: number | null;
  errorCode: string | null;
  source: string | null;
  createdAt: string;
}

export interface ChannelDiagnostics {
  account: ChannelAccount;
  health: {
    connectionState: ChannelConnectionState;
    healthScore: number;
    successCount: number;
    failureCount: number;
    consecutiveFailures: number;
    lastSuccessfulDeliveryAt: string | null;
    lastFailedDeliveryAt: string | null;
    lastHealthCheckAt: string | null;
  };
  healthHistory: ChannelHealthSample[];
  deliveryMetrics: { total: number; byStatus: Record<string, number> };
  retryStats: {
    totalAttempts: number;
    byOutcome: Record<string, number>;
    retriedDeliveries: number;
  };
  recentFailures: {
    id: string;
    messageId: string;
    status: ChannelDeliveryStatus;
    failureType: ChannelDeliveryFailureType;
    failureCode: string | null;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    updatedAt: string;
  }[];
  recentRecoveries: {
    id: string;
    activityType: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }[];
}

export interface DeliveryRetryResult {
  status: 'sent' | 'retry_scheduled' | 'failed' | 'expired' | 'skipped';
  deliveryId: string;
  attemptNumber?: number;
  reason?: string;
}

export interface WebChatConfig {
  title: string;
  welcomeMessage: string;
  themeColor: string;
  position: 'left' | 'right';
  locale: string;
  launcherText: string;
  agentLabel: string;
  assistantLabel: string;
  allowedOrigins: string[];
}

/** WhatsApp connect request. Secrets are sent once, encrypted server-side. */
export interface WhatsAppConnectInput {
  displayName: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber?: string;
  businessName?: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export interface InstagramConnectInput {
  displayName: string;
  instagramAccountId: string;
  instagramUsername?: string;
  facebookPageId?: string;
  businessName?: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export interface FacebookConnectInput {
  displayName: string;
  pageId: string;
  pageName?: string;
  businessName?: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export interface TelegramConnectInput {
  displayName: string;
  botToken: string;
}

export interface ChannelAccount {
  id: string;
  providerKey: string;
  channelType: ChannelType;
  displayName: string;
  externalAccountId: string | null;
  externalPageId: string | null;
  publicId: string | null;
  status: ChannelAccountStatus;
  connectionState: ChannelConnectionState;
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: ChannelCapabilities | null;
  metadata: Record<string, unknown> | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthyAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Day 11: knowledge documents (PDF) + AI analytics ---

export type KnowledgeDocumentStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface KnowledgeDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeDocumentStatus;
  pageCount: number | null;
  extractedCharacters: number | null;
  failureReason: string | null;
  isActive: boolean;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIAnalytics {
  rangeDays: number;
  since: string;
  conversationVolume: {
    total: number;
    byDay: { date: string; count: number }[];
    byChannel: { channelType: ChannelType; count: number }[];
  };
  resolution: {
    byStatus: { status: ConversationStatus; count: number }[];
    resolvedInRange: number;
    avgResolutionHours: number | null;
  };
  handoff: {
    total: number;
    /** 0..1 */
    rate: number;
    byReason: { reason: string; count: number }[];
  };
  aiGenerations: {
    total: number;
    completed: number;
    failed: number;
    /** 0..1 */
    successRate: number;
    byType: { type: string; count: number }[];
    autoRepliesSent: number;
  };
  topFaqs: { id: string; question: string; count: number }[];
  topServices: { id: string; name: string; count: number }[];
  topProducts: { id: string; name: string; count: number }[];
  topDocuments: { id: string; fileName: string; count: number }[];
  languages: { code: string; count: number }[];
}

// --- Day 12: billing & subscriptions ---

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

export type BillingCycle = 'MONTHLY' | 'YEARLY';

/** Per-plan usage caps; null = unlimited. */
export interface PlanLimits {
  maxChannels: number | null;
  maxUsers: number | null;
  maxAiRequestsPerMonth: number | null;
  maxKnowledgeDocuments: number | null;
  maxProducts: number | null;
  maxServices: number | null;
}

export interface BillingPlan {
  code: string;
  name: string;
  description: string | null;
  /** Decimal strings, e.g. "19" / "19.5". */
  monthlyPriceUsd: string;
  yearlyPriceUsd: string;
  limits: PlanLimits;
  features: string[];
  sortOrder: number;
}

export interface UsageStat {
  used: number;
  /** null = unlimited on the current plan. */
  limit: number | null;
}

export interface BillingUsage {
  channels: UsageStat;
  users: UsageStat;
  aiRequestsThisMonth: UsageStat;
  knowledgeDocuments: UsageStat;
  products: UsageStat;
  services: UsageStat;
}

export interface Subscription {
  plan: BillingPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  daysLeftInTrial: number | null;
  usage: BillingUsage;
}

/** changePlan either applies offline or redirects to hosted checkout. */
export type ChangePlanResult =
  | { checkoutUrl: string }
  | { subscription: Subscription };

// --- Day 12: notifications ---

export type NotificationType =
  | 'NEW_CONVERSATION'
  | 'HANDOFF_REQUESTED'
  | 'AI_REPLY_FAILED'
  | 'SUBSCRIPTION_EVENT'
  | 'SYSTEM_ALERT';

export interface AppNotification {
  id: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

// --- Day 12: public API keys + outbound webhooks ---

export type DomainEventType =
  | 'conversation.created'
  | 'conversation.resolved'
  | 'customer.created'
  | 'handoff.requested'
  | 'ai.reply_failed'
  | 'subscription.updated'
  | 'action.executed';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once at creation: the serialized row plus the full key. */
export interface ApiKeyCreated {
  apiKey: ApiKey;
  key: string;
}

export interface OutboundWebhook {
  id: string;
  url: string;
  events: DomainEventType[];
  isActive: boolean;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryCount?: number;
}

/** Returned once at creation: the webhook plus its signing secret. */
export interface OutboundWebhookCreated {
  webhook: OutboundWebhook;
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: 'delivered' | 'failed' | string;
  attemptCount: number;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
}

// --- Day 12: AI actions / operations ---

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED';

export interface Appointment {
  id: string;
  customerId: string | null;
  conversationId: string | null;
  serviceId: string | null;
  scheduledAt: string;
  durationMinutes: number | null;
  notes: string | null;
  status: AppointmentStatus;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = 'NEW' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED';

export interface OrderItem {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  /** Decimal string (e.g. "10.5") or null when the product has no price. */
  unitPrice: string | null;
  currency: string;
}

export interface Order {
  id: string;
  customerId: string | null;
  conversationId: string | null;
  status: OrderStatus;
  /** Decimal string or null when no item had a published price. */
  totalAmount: string | null;
  currency: string;
  notes: string | null;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface SupportTicket {
  id: string;
  customerId: string | null;
  conversationId: string | null;
  subject: string;
  description: string | null;
  priority: ConversationPriority;
  status: TicketStatus;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
}

export type ActionExecutionStatus = 'completed' | 'failed' | 'rejected';

export interface AIActionExecution {
  id: string;
  conversationId: string | null;
  generationId: string | null;
  actionKey: string;
  input: unknown;
  /** Handler result — includes a human-readable `summary` when completed. */
  result: { summary?: string } | null;
  status: ActionExecutionStatus;
  errorMessage: string | null;
  createdAt: string;
}
