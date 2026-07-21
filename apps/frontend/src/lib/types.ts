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
}

export interface AuthData {
  user: User;
  company: Company;
  accessToken: string;
  refreshToken?: string;
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
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  contentType: 'TEXT';
  content: string;
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
export type AIGenerationType = 'DRAFT' | 'AUTO_REPLY' | 'PLAYGROUND' | 'REGENERATE';

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
