# Changelog

## [1.2.0] — 2026-07-12

### Adoption & UX Pack (WebAuthn Level 3)

Aligns the skill with WebAuthn Level 3 (W3C Candidate Recommendation,
2026-01-13) and the 2025–2026 passkey ecosystem. Benchmarked with 6 new evals
(14–19) added test-first; baseline vs v1.1.0 documented in the eval commits.

- **Conditional create (automatic passkey upgrades):** silent passkey creation
  right after password sign-in (`useAutoRegister` / `mediation: 'conditional'`
  on create) — frontend pattern with cooldown trigger policy, backend
  implications, UX rules (no interstitial, passive confirmation), and wiring
  into both Rapid and Gradual rollout strategies
- **Immediate UI mode (smart sign-in button):** `uiMode: 'immediate'`
  (Chrome 149+), including the warning that the origin-trial
  `mediation: 'immediate'` syntax no longer works, and silent
  `NotAllowedError` fallback with conditional UI armed
- **Signal API completed:** `signalCurrentUserDetails` for syncing
  username/displayName changes (Chrome 132+, Safari 26 + WebKit
  fire-and-forget caveat); nickname-rename vs picker-name distinction
- **WebAuthn hints:** `hints: ['security-key'|'client-device'|'hybrid']`
  guidance + SimpleWebAuthn v13 `preferredAuthenticatorType` mapping
- **Related Origin Requests fixed:** Firefox 152 (May 2026) support replaces
  the stale "no timeline" claim; concrete `/.well-known/webauthn`
  `{"origins": [...]}` example added
- **NEW `references/advanced-features.md`:** PRF extension (passkey-derived
  E2E encryption keys), largeBlob, Credential Exchange (CXP/CXF) portability,
  cross-origin iframe embedding (Permissions-Policy), full ROR guide
- **Freshness:** SimpleWebAuthn matrix v11 → v13 (types retired,
  `verifyMDSBlob()`, `useAutoRegister`); `getClientCapabilities` support
  matrix refreshed; spec-level JSON serialization helpers documented
- **Copy:** portability reassurance block (counters the lock-in objection)
  and automatic-upgrade confirmation toast
- **Evals:** 6 new evals + v1.2.0-tagged assertions on evals 1 and 12;
  `run-evals.mjs` gains a v1.2.0 feature-coverage pattern group (127 checks)

### Fixed

From an adversarially-verified review (6 lenses, 2 skeptics per finding —
11 findings, 0 refuted):

- **Passkey sign-in was broken in the flagship NestJS example** (pre-existing,
  since 1.0.0). Registration stored `credentialId: Buffer.from(credential.id)`
  — the UTF-8 bytes of the base64url string — while the authentication lookup
  decodes `Buffer.from(rawId, 'base64url')`. The two never matched, so every
  passkey sign-in returned 401 while registration appeared to succeed. **If you
  built on the NestJS example before 1.2.0, re-check this line**; existing rows
  were stored in the wrong encoding and must be re-registered or migrated.
- **Conditional create rejected every auto-created passkey.** The guidance said
  verification was unchanged; in fact the ceremony has no user gesture, so the
  UP flag is unset and SimpleWebAuthn's `requireUserPresence` (default `true`)
  throws. Now documents `requireUserPresence: false`, scoped to that path only.
- **Immediate UI mode never fired** when conditional UI was armed — the missing
  `AbortController` abort made the ceremony fail with `NotAllowedError`,
  indistinguishable from "no credential available".
- **Cross-origin iframe setup left WebAuthn blocked**: the `Permissions-Policy`
  header was shown on the embedded document naming the embedder; the parent
  must send it naming the embedded origin, alongside the `allow` attribute.
- Conditional create announced success without checking `response.ok`
  (`fetch` does not throw on 4xx/5xx); Go handlers returned `{publicKey: …}`
  wrapped options SimpleWebAuthn cannot parse; Django (session-based) vs the
  Bearer-token frontend examples now carry an explicit pick-one note; PRF
  vault-unlock now sets `userVerification: 'required'`; NestJS
  `DELETE :credentialId` renamed to `:id` to match every other layer.

### Fixed (post-release, benchmark-driven)

The full skill-creator toolchain (19 evals, same-batch v1.2.0 vs v1.1.0,
subagent grading) scored **v1.2.0 at 99.1% (222/225) vs v1.1.0 at 88.8%
(204/225)**, stddev tightening from ±18% to ±3%. It also surfaced one real,
reproducible regression, confirmed at 0/3 across reps before the fix and 5/5
after:

- **Separate-repos projects could get a plan built on an invented backend.**
  The Phase 0 classification table gave `Frontend-only` an explicit
  "stop immediately, do not generate any plan" but gave `Separate repos` only
  "ask for backend context" — no stop language. A request that is genuinely
  both (a frontend repo whose backend runs elsewhere) fell through the weaker
  row: agents rationalized *"I cannot ask you interactively, so I am
  proceeding on assumptions"* and produced a full backend plan, frontend
  plan, and code against a backend they had invented. This ambiguity was
  **pre-existing since 1.0.0** — the classification table was untouched by
  1.2.0's diff — only exposed by broader benchmark coverage. `Separate repos`
  now shares the same stop gate as `Frontend-only`, with the reasoning stated
  and the "can't ask interactively" rationalization explicitly closed.
- **Also corrected while investigating the toolchain's Firefox-currency
  evals:** the skill claimed Conditional UI autofill was "not supported in
  Firefox as of 2026" in three places. This was wrong, not merely stale —
  MDN browser-compat-data confirms Firefox added conditional mediation in
  **119** (broadly shipped in 122, January 2024). Corrected with the real
  caveats (needs Windows 11/macOS underneath; Firefox on Android lagged).
- `CONTRIBUTING.md` split out of the README with the eval-first workflow and
  the toolchain instructions this fix was validated against.
- The "Gotchas" block (loaded on every activation) regrouped into 5 themed
  sections and tightened 149→114 lines / 1435→920 words (−36%); stack-specific
  entries compacted to symptom checklists since full fixes already live in
  the Phase 1 references. SKILL.md ends at 819 lines — below the pre-1.2.0
  baseline of 821, despite everything 1.2.0 added.

## [1.1.0] — 2026-05-10

### Premium Improvements

Two waves of improvements benchmarked at 99.5% (vs 93.4% for v1.0.0, zero
regressions, 25 new discriminating assertions).

**Wave 1 — features:**

- Plan-mode enforcement before any implementation code (Pre-Phase 0)
- i18n detection in Phase 0 + `passkeys.*` key catalog and per-framework
  wiring (NEW `references/i18n-guide.md`)
- Rapid rollout as the recommended default strategy
- Passkey naming: AAGUID-based default names (FIDO MDS) + inline rename UI
  + `PATCH /auth/passkey/:id` endpoint with ownership checks
- Install verification step before the backend checkpoint
- Implementation Completeness Checklist gating Phase 3 → Phase 4
- Design-system detection (Tailwind, MUI, shadcn/ui, Chakra, etc.) and
  component adaptation rules

**Wave 2 — 13 real-world hardening fixes** (from NestJS/React and Django/Nuxt
field testing):

- NestJS DTO whitelist rejecting SimpleWebAuthn v13 response fields
- Prisma `BigInt` counter serialization crashes
- Separate `autofillPending` / `loading` states + AbortController for the
  conditional UI ceremony
- Django: bytes challenge in session, transports enum conversion,
  no-`.verified`-attribute pattern, 3-step `passkey_user_id` migration,
  `sign_count` naming, `@csrf_exempt` on public endpoints
- `userHandle` base64url decoding before DB lookup
- Laravel sodium extension requirement

**Docs & evals:** evals 9–13 added (troubleshooting, testing, i18n, rename,
userHandle debugging); trigger-description tuning for rename/integrate
phrasing; README overhaul.

## [1.0.0] — 2026-04-01

### Initial Release

Comprehensive passkey authentication migration guide for modern web and mobile applications.

### Backend Support (12 Frameworks)

- **NestJS + Prisma:** Full controller, service, and DTO scaffold
- **Django + py_webauthn:** Registration and authentication views
- **Spring Boot + java-webauthn-server:** JPA entity with full implementation
- **Laravel + web-auth/webauthn-lib:** Complete controller, routes, and Sanctum middleware
- **Express, Fastify, Next.js:** API route implementations via SimpleWebAuthn
- **Go + go-webauthn/webauthn:** Configuration and handler setup
- **Rails + devise-passkeys:** Framework integration
- **ASP.NET Core + Fido2NetLib:** .NET implementation
- **Rust + webauthn-rs:** Rust-native support
- **Elixir Phoenix + wax:** Phoenix framework integration

### Database & ORM Support (8 Options)

- Prisma (PostgreSQL + MySQL workaround)
- TypeORM, Sequelize, SQLAlchemy (Alembic-compatible)
- Mongoose (vanilla + NestJS decorator pattern)
- Django ORM, Hibernate/JPA
- Raw SQL (PostgreSQL + MySQL schemas)

### Frontend Support (7 Frameworks)

- **Vue 3:** Full composable with conditional UI, registration, and authentication
- **React:** Custom hooks pattern implementation
- **Angular:** Service-based architecture
- **Svelte/SvelteKit:** Store pattern
- **Nuxt 3:** Client-only plugin
- **Next.js:** Dynamic import strategy

### UX & Compliance

- All 10 FIDO Alliance UX principles implemented
- Conditional UI (form autofill) support
- Cross-device upgrade interstitial and post-login nudge
- 2 required + 7 optional design patterns
- Ready-to-use UX copy templates
- FIDO passkey icon usage guidance

### Security

- 30+ checkpoint security checklist (13 categories)
- Counter replay protection with correct BigInt/Number conversion
- AAGUID-based provider identification and mapping
- PII-free passkeyUserId per W3C spec and Google guidance
- OWASP Top 10 coverage mapping
- 10 documented gotchas and edge cases (rpID mismatch, challenge expiry, etc.)

### Rollout & Adoption

- Gradual and Rapid rollout strategies (5 phases each)
- 4-stage phishing prevention journey (Legacy -> Full Prevention)
- Post-launch metrics tracking guidance
- Password deprecation roadmap
- Anti-patterns and migration risks documented

### Project Infrastructure

- agentskills.io specification compliant
- Cross-agent compatible (Claude Code, GitHub Copilot, Cursor, Windsurf, Gemini CLI, OpenAI Codex)
- 8 evaluation test cases (6 positive + 2 negative)
- MIT licensed
- Environment variable templates for all frameworks
