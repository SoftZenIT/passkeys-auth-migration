# Changelog

All notable changes to this skill will be documented in this file.

## [1.1.0] — 2026-04-23

### Added

**New reference files:**
- `references/troubleshooting.md` — 10 problem categories with symptoms, causes,
  and fixes: rpID mismatch, Conditional UI not appearing, challenge expiry,
  origin mismatch, NotAllowedError causes, cross-browser incompatibilities,
  UV flag non-compliance, orphaned credentials, multiple passkey confusion,
  generic ceremony debugging. Includes FIDO-tested error message templates
  from passkeycentral.org messaging guidelines.
- `references/testing-guide.md` — 4-level testing strategy: unit tests (mock
  WebAuthn library), integration tests (HTTP endpoint testing), E2E tests
  (Chrome virtual authenticator via CDP with Playwright/Puppeteer), CI/CD
  configuration (GitHub Actions with HTTPS and self-signed certs).

**Backend completions:**
- Spring Boot + java-webauthn-server: full implementation added (RelyingParty
  bean, CredentialRepository interface, PasskeyController with all 6 endpoints,
  AssertionResult handling, counter update). Previously only had Maven dep + JPA entity.
- Go + Gin + go-webauthn/webauthn: full implementation added (WebAuthnUser
  interface, handler setup, all 6 routes, FinishDiscoverableLogin, challenge
  store integration). Previously only had config struct.

**Security enhancements:**
- WebAuthn Signal API documentation (signalUnknownCredential, signalAllAcceptedCredentials)
- UV flag non-compliance warning: 1Password Extension, Bitwarden Extension,
  KeePassXC, Proton Pass Extension, Okta Personal Extension all set UV=true
  without actual verification (as of April 2026)
- AAGUID → provider name mapping guide: FIDO MDS reference + top-20 inline
  lookup table + fallback label strategy

**SKILL.md improvements:**
- 4 new gotchas: Signal API for orphaned credentials, UV flag non-compliance,
  `/.well-known/passkey-endpoints` for Google PM upgrade prompts, excludeCredentials
  preventing duplicate passkeys
- Structured backend context template for frontend-only projects (replaces
  vague "ask questions" instruction)
- `/.well-known/passkey-endpoints` step added to Phase 2 frontend plan
- Signal API error handling added to Phase 2 error handling step
- References table updated with troubleshooting.md and testing-guide.md

**Rollout guide additions:**
- Real-world benchmarks: Google (13.8% → 63.8% success rate, 30s → 15s time),
  KAYAK (50% time reduction), TikTok (97% success rate), Target (99% adoption)
- Contact center cost context: 30–60% of auth support costs eliminated by passkeys
- Account recovery enrollment flow: how to prompt passkey creation during
  password reset/account recovery (with security gating requirement)
- Email notification template for new passkey creation events

**DB schema additions:**
- Performance and indexing section: query patterns, Redis sizing guidelines,
  soft delete strategy, passkey count limits (20–50 max per user)

**Compatibility:**
- All instructions use agent-agnostic language (no Claude-specific tool names)
- Compatible with: Claude Code, GitHub Copilot, Cursor, Windsurf, Gemini CLI,
  OpenAI Codex, and any code-capable AI agent

---

## [1.0.0] — 2026-04-01

### Initial release

**Backend support (12 frameworks):**
- NestJS + Prisma (full controller, service, DTO scaffold)
- Django + py_webauthn (registration + authentication views)
- Spring Boot + java-webauthn-server (JPA entity)
- Laravel + web-auth/webauthn-lib (full controller, routes, Sanctum middleware)
- Express, Fastify, Next.js API routes (via SimpleWebAuthn)
- Go + go-webauthn/webauthn (config struct)
- Rails + devise-passkeys
- ASP.NET Core + Fido2NetLib
- Rust + webauthn-rs
- Elixir Phoenix + wax

**ORM / Database schemas (8 ORMs + raw SQL):**
- Prisma (PostgreSQL + MySQL workaround)
- TypeORM
- Sequelize
- Mongoose (vanilla + NestJS decorator)
- SQLAlchemy (Alembic-compatible)
- Django ORM
- Hibernate / JPA
- Raw SQL (PostgreSQL + MySQL)

**Frontend support (7 frameworks):**
- Vue 3 (full composable with conditional UI, registration, authentication)
- React (hooks pattern)
- Angular (service pattern)
- Svelte / SvelteKit (store pattern)
- Nuxt 3 (client-only plugin)
- Next.js (dynamic import)

**UX compliance:**
- All 10 FIDO Alliance UX principles implemented
- All 3 content principles with copy templates
- 2 required design patterns (Create/Manage + Sign In)
- 7 optional design patterns documented
- Conditional UI (form autofill) with useBrowserAutofill
- Cross-device upgrade interstitial
- Post-login upgrade nudge
- Ready-to-use UX copy templates (assets/ux-copy-templates.md)
- FIDO passkey icon usage guidance

**Security:**
- 30+ checkpoint security checklist (13 categories A–M)
- 10 gotchas in SKILL.md body (rpID, challenge deletion, BigInt, etc.)
- Counter replay protection with correct BigInt/Number conversion
- AAGUID-based provider identification
- PII-free passkeyUserId per W3C spec and Google guidance
- OWASP Top 10 coverage mapping

**Rollout:**
- Gradual and Rapid rollout strategies (5 phases each)
- 4-stage phishing prevention journey (Legacy → Full Prevention)
- Post-launch metrics tracking guidance
- Password deprecation roadmap
- Anti-patterns list

**Skill infrastructure:**
- agentskills.io specification compliant (frontmatter, progressive disclosure)
- Cross-agent compatible (Claude Code, Copilot, Cursor, Windsurf, Gemini CLI, Codex)
- 8 eval test cases (6 positive + 2 negative) with assertions
- MIT licensed
- Environment variable templates for all frameworks
