# Day 11 — Advanced AI Features: Completion Report

Seven capabilities delivered on the existing architecture (controller → service
→ repository, central errors, one shared channel pipeline, provider-specific
logic only inside providers). No new frameworks; two new npm deps
(`pdf-parse` runtime, `pdf-lib` test-only).

## 1. Architecture decisions

- **PDF knowledge = keyword retrieval over chunks, not a vector store.** The
  existing deterministic retrieval (services/products/FAQs/KB) was extended
  with a fifth source: `knowledge_document_chunks` (~1500 chars, 200 overlap,
  soft boundaries). This keeps retrieval fast, tenant-scoped, dependency-free,
  and swappable for embeddings later behind the same `RetrievalResult`
  interface. Original PDF bytes stay in Postgres (download/re-process);
  extraction happens synchronously at upload (`pdf-parse`), with
  PROCESSING/READY/FAILED status.
- **Handoff is two-layered and configurable.** (a) Explicit requests are
  detected deterministically (multilingual regexes + per-company
  `handoffKeywords`) BEFORE any provider call — zero tokens spent; the
  customer immediately receives the configured `humanHandoffMessage` as a
  SYSTEM message through the normal outbound path. (b) Low confidence uses a
  prompt sentinel (`HANDOFF_REQUIRED`): the model emits it when it cannot
  answer from company information; the platform replaces it with the handoff
  message (customers never see the sentinel) and pauses the AI. Both gates
  live in `CompanyAISettings` (`handoffOnRequest`, `handoffOnLowConfidence`),
  future rules extend `handoffKeywords` or add new reasons — the conversation
  model already stores `handoffReason` as free text.
- **AI stays silent after handoff** because auto-reply already gates on
  `aiMode === 'ENABLED'`; handoff sets `PAUSED`. "Return to AI" (existing
  ai-mode endpoint, OWNER/ADMIN) clears `handoffRequestedAt/-Reason` so the
  inbox badge disappears; the audit trail stays in conversation activities.
- **Summaries reuse the generation audit trail.** `SUMMARY` is a new
  `AIGenerationType`; every summary is a recorded generation (tokens, cost,
  latency) like any other AI call. Auto-generation hooks into
  `conversationsService.setStatus` (RESOLVED/CLOSED) via a best-effort wrapper
  that can never block or fail the status change.
- **Suggestions are one provider call, N replies** (sentinel-split `###`),
  recorded as `SUGGESTION` generations, never persisted as messages — the
  agent sends through the existing message path or edits in the composer.
- **Voice is normalized at the provider boundary.** Providers translate
  platform payloads (Telegram `voice`, WhatsApp `audio`, Meta audio
  attachments) into the same normalized event with a `media` descriptor and
  implement an optional `fetchInboundMedia()` (Telegram `getFile`+download,
  WhatsApp media-node lookup + authorized CDN fetch, Meta direct URL). The
  webhook engine stores bytes in the existing StoredImage store (served
  publicly by UUID), transcribes via OpenAI Whisper (injectable for tests),
  writes the transcript into `Message.content` — so the AI, retrieval,
  language detection, and analytics all work on voice for free. A new
  `voiceMessages` capability flag marks provider support.
- **Language detection is a pure util in the shared pipeline** (script
  analysis + stop-word evidence, no dependency, ~0 cost), so every current and
  future channel gets it. It stores `Conversation.detectedLanguage` +
  `Customer.preferredLanguage` and feeds the prompt's language hint when the
  company preference is `auto`; mixed-language chats mirror the latest
  message. The generation result also reports `detectedLanguage`.
- **Analytics derives everything from existing data** — no counters to keep in
  sync. "Most asked about" tallies come from `AIResponseGeneration.
  contextSummary` (which already records which FAQs/services/products/
  documents were surfaced per answer). One endpoint returns one cohesive
  payload; new sections = new keys, no new endpoints.

## 2. Database changes (migration `day11_ai_capabilities`)

- New: `knowledge_documents` (bytes + status + page/char counts + isActive),
  `knowledge_document_chunks` (unique `(documentId, chunkIndex)`).
- `company_ai_settings`: `handoffOnRequest` (default true),
  `handoffOnLowConfidence` (default true), `handoffKeywords TEXT[]`.
- `conversations`: `aiSummary`, `aiSummaryGeneratedAt`, `detectedLanguage`.
- `customers`: `preferredLanguage`.
- Enums: `AIGenerationType` += SUMMARY, SUGGESTION; `MessageContentType` +=
  AUDIO; new `KnowledgeDocumentStatus`.
All changes additive; Render applies them via `prisma migrate deploy` on
deploy.

## 3. New / changed APIs

- `POST /api/v1/knowledge-documents` (multipart `files`×≤5, OWNER/ADMIN),
  `GET /`, `POST /:id/replace`, `PATCH /:id/status`, `DELETE /:id`,
  `GET /:id/download`.
- `POST /api/v1/conversations/:id/ai/suggestions` `{ count: 1..3 }`.
- `POST /api/v1/conversations/:id/summary` `{}`.
- `GET /api/v1/analytics/ai?days=1..90`.
- `PATCH /api/v1/ai-settings` accepts `handoffOnRequest`,
  `handoffOnLowConfidence`, `handoffKeywords[]`.
- Conversation payloads now include `aiSummary`, `aiSummaryGeneratedAt`,
  `detectedLanguage`; messages can be `contentType: 'AUDIO'` with `mediaUrl`
  (stored voice) and `content` (transcript).

## 4. AI pipeline changes

`runGeneration` now: detects the customer language per call and injects it
into the prompt; optionally allows the handoff sentinel (auto-reply only,
gated by settings); replaces sentinel output with the configured handoff
message (`lowConfidence: true` in the result, no image attachment on handoff
replies); passes company `handoffKeywords` into explicit-request detection.
Retrieval gained document chunks (`MAX_DOCUMENT_CHUNKS = 4`); context gained a
`DOCUMENTS` block + `documentIds` in the context summary (which analytics
tallies). New prompt version `v2-2026-07`. New `aiTranscriptionService`
(Whisper) with test injection, mirroring the AI-provider factory pattern.

## 5. Frontend

New Analytics dashboard page (range selector, stat cards, CSS bar chart,
top-entity panels, language chips) + nav entry; Documents (PDF) manager inside
Knowledge Base; AI Settings handoff section (toggles + keywords); Inbox:
handoff badge + reason + Return-to-AI, detected-language chip, "Suggest"
panel (send / use-in-composer with typed-text confirmation), audio player
bubbles with transcripts, AI summary block in the details drawer
(generate/regenerate).

## 6. Testing

- Backend: **50 suites / 502 tests passing** (was 44/449; new suites:
  `language-detect`, `ai-handoff`, `ai-summary-suggestions`, `analytics`,
  `knowledge-documents`, `voice-messages`), plus clean `tsc --noEmit`,
  ESLint, and production build. Jest now runs with
  `--experimental-vm-modules` (pdfjs requirement) via the workspace-root
  Jest binary.
- Frontend: **5 Vitest files / 20 tests passing** (11 new: resource contracts
  + SuggestionPanel behavior incl. the composer-overwrite confirm gate),
  plus clean typecheck, ESLint, and production build (new
  `/dashboard/analytics` route in the bundle).
- Test fixtures: real PDFs generated with `pdf-lib` (dev-only dep); voice
  flow tested end-to-end through the Telegram webhook with injected JSON
  transport, binary fetcher, and transcriber (no network).

## 7. Manual verification steps

1. Knowledge Base → Documents: upload a PDF with distinctive facts → status
   READY → ask the web-chat widget about those facts → AI answers from the
   document.
2. Ask the widget "بدي احكي مع موظف" → handoff notice message arrives, inbox
   shows the amber handoff badge, AI stays silent; "Return to AI" resumes.
3. Ask something unanswerable → AI replies with the handoff message and
   pauses (low_confidence reason).
4. Resolve a conversation → AI summary appears in the details drawer.
5. Inbox → "Suggest" → two suggestion cards; Send one directly.
6. Send a Telegram voice note to the connected bot → audio bubble + transcript
   in the inbox; AI replies to the transcript.
7. Dashboard → Analytics: volumes, rates, and top entities reflect the above.

## 8. Future extensibility

- Retrieval interface unchanged → embeddings/vector search can replace the
  keyword ranker without touching callers.
- Handoff reasons are free-form strings + keyword list → SLA/office-hours
  rules can call `aiService.requestHandoff(companyId, convId, '<reason>')`.
- Analytics = one service fan-out → add keys, not endpoints.
- `fetchInboundMedia` + `media` descriptor generalize to images/documents
  inbound; `voiceMessages` capability already per-provider.
- Language detector returns ISO codes → per-language routing/analytics ready.
