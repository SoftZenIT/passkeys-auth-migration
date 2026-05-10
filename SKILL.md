---
name: passkeys-auth-migration
description: >
  Use this skill when the user wants to add, implement, or integrate passkeys,
  migrate to passwordless authentication, implement WebAuthn or FIDO2, or
  replace passwords/OTP/magic links with biometric or device-based login. Also
  use it for passkey management (renaming passkeys, listing credentials, adding
  AAGUID-based names), debugging an existing passkey/WebAuthn flow, or asking
  how to test passkey endpoints and CI without hardware authenticators. Trigger
  on phrases like "add passkeys", "implement passkeys", "integrate WebAuthn",
  "migrate to passwordless", "WebAuthn", "FIDO2", "biometric login", "passkey
  authentication", "passkey autofill not showing", "rename passkey",
  "passkey management", or "test passkey endpoints". Works for backend-only,
  frontend-only, separate-repo, or full-stack projects across any framework.
  Do not trigger for general OAuth, SSO, non-passkey auth questions, general
  passkey security/comparison explainers that do not ask for migration,
  implementation, debugging, or testing, or hardware security key (FIDO U2F /
  WebAuthn second-factor only) questions where the user explicitly wants a
  second-factor flow rather than passwordless passkeys.
license: MIT
metadata:
  author: Sadjad Ousmane
  version: "1.1.0"
  tags: authentication passkeys webauthn fido2 security passwordless migration
compatibility: >
  Works with any coding agent that supports file reading and terminal commands
  (Claude Code, GitHub Copilot, Cursor, Gemini CLI, OpenAI Codex, and similar).
---

# Passkey Migration Skill

Migrates any existing authentication system to passkeys (WebAuthn/FIDO2),
following FIDO Alliance best practices, UX guidelines, and security standards.
Covers backend, frontend, database schema, rollout strategy, and security
hardening. Always presents a written plan for approval before writing code.

---

## Request routing

Classify the user's request before Phase 0:

- **Migration or implementation** — follow Phase 0 through Phase 4.
- **Partial implementation (passkey code already exists)** — run Phase 0 to
  scan what is already present. For each phase, check concrete signals before
  skipping: Phase 1 done if a passkeys DB migration file exists and challenge
  endpoints return HTTP 200; Phase 2 done if `startAuthentication` or
  `startRegistration` is imported in frontend code. Resume from the first phase
  whose signals are absent. Do not regenerate plans or code for phases that pass
  their signal checks.
- **Frontend-only integration** — follow Phase 0, then stop and collect the
  backend context template before generating any frontend plan.
- **Troubleshooting an existing passkey flow** — load
  `references/troubleshooting.md` first and answer with a targeted diagnosis.
  For Conditional UI/autofill failures, check `autocomplete="username webauthn"`,
  HTTPS or `localhost`, `startAuthentication({ useBrowserAutofill: true })`,
  `mediation: 'conditional'`, `allowCredentials: []`, browser support, and
  private browsing limitations before suggesting code changes.
- **Testing or CI for passkey flows** — load `references/testing-guide.md` first
  and provide a strategy that covers unit tests with WebAuthn library mocks,
  integration tests for endpoint auth and ownership, E2E tests with Chrome CDP
  virtual authenticators in Playwright or Puppeteer, and HTTPS test
  configuration with `RP_ID=localhost` and `APP_ORIGIN`.
- **General information only** — do not activate this skill for broad passkey
  security comparisons, OAuth, SSO, or unrelated authentication questions.
  This includes general passkey security/comparison explainers that do not ask
  for migration, implementation, debugging, or testing.

Advice-only troubleshooting and testing requests do not need a migration plan.
The "plan before code" rule applies when you will write implementation code.

---

## Gotchas — Read before anything else

Watch out for these non-obvious pitfalls before writing any code:

- **rpID must be domain only** — no protocol, no port, no path. `example.com`
  works. `https://example.com`, `example.com:3000`, `example.com/app` all fail
  silently — the WebAuthn ceremony completes but verification always rejects.
- **Challenge must be deleted in the `catch` block too**, not only on success.
  Leaving a failed challenge in the store allows replay attacks.
- **BigInt ↔ Number conversion with Prisma** — Prisma stores `counter` as
  `BigInt`. SimpleWebAuthn returns `Number`. Always convert:
  `Number(passkey.counter)` when reading, `BigInt(newCounter)` when writing.
- **`residentKey: 'preferred'` is what creates a passkey** — without it the
  browser creates a non-discoverable credential (no passkey selector shown).
- **`autocomplete="username webauthn"`** must be on the _username/email_ input,
  not the password input. This is what activates the browser's passkey autofill.
- **`useBrowserAutofill: true`** must be set in `startAuthentication()` for the
  autofill (conditional UI) flow. Without it, no passkey appears in autofill.
- **Django `options_to_json()`** returns a string — wrap with `json.loads()`
  before returning as `JsonResponse`.
- **`passkeyUserId` must be PII-free** — never use email or username as
  `user.id` in WebAuthn options. The authenticator returns it as `userHandle`.
- **Never store or log the raw credential response** — it contains attestation
  data not needed after verification. Store only `credentialId`, `publicKey`,
  `counter`, `deviceType`, `backedUp`, and `transports`.
- **HTTPS is required in production** — WebAuthn refuses to run on HTTP except
  on `localhost`. Configure TLS before testing in staging or production.
- **Signal orphaned credentials** — when authentication fails with a 404 (credential
  not found), call `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`
  so the passkey provider removes the stale entry. Without this, users see phantom
  passkeys that always fail.
- **UV flag non-compliance in some providers** — 1Password Extension, Bitwarden
  Extension, KeepassXC, Proton Pass Extension, and Okta Personal Extension all
  set the `uv` flag to `true` without actually performing user verification. Never
  rely on the `uv` flag alone for high-assurance operations (step-up auth, payments).
  Their _native_ (non-extension) counterparts are compliant. **Mitigation:** for
  any step-up or high-assurance action, require a separate explicit re-authentication
  ceremony (e.g. a fresh `navigator.credentials.get()` with `userVerification: "required"`
  scoped to that action) rather than checking the `uv` flag on the session-level
  credential. Do not strip `uv` checks entirely — they still block non-UV authenticators
  in standard flows. See `references/troubleshooting.md` for details.
- **`/.well-known/passkey-endpoints`** — add this JSON file to your domain so
  Google Password Manager can prompt users to upgrade to passkeys after password
  sign-in. Required for the "promote passkey upgrades" pattern.
- **`excludeCredentials` prevents duplicate passkeys** — always pass existing
  credential IDs when generating registration options. Without this, users can
  register unlimited passkeys for the same device.
- **Two separate `.well-known/` files serve different purposes** —
  `/.well-known/passkey-endpoints` (JSON) tells Google Password Manager where
  your enroll/manage pages are, enabling upgrade prompts after password sign-in.
  `/.well-known/webauthn` (JSON, `Content-Type: application/json`) is the
  WebAuthn Level 3 Related Origin Requests file — it lets one passkey work across
  up to five domains (e.g. `example.com` and `app.example.com`). Both files live
  at the rpID domain root. Most apps only need `passkey-endpoints`; add `webauthn`
  only if you have a genuine multi-domain deployment. Chrome 128+, Safari 18
  support ROR. Firefox has no implementation timeline as of 2026.
- **NestJS `register/verify` DTO must allow SWA v13+ fields** — SimpleWebAuthn
  browser v13+ sends `publicKeyAlgorithm`, `publicKey`, and `authenticatorData`
  in the registration response (valid W3C Level 3 fields). A `ValidationPipe`
  with `forbidNonWhitelisted: true` rejects these with 400 before
  `verifyRegistrationResponse()` runs. The frontend shows a misleading "cancelled"
  message because the browser ceremony already succeeded. Fix: add these fields
  as `@IsOptional()` in the DTO, or apply `forbidNonWhitelisted: false` on that
  endpoint only. See `references/backend-integration.md` §NestJS Common Pitfalls.
- **Never return raw Prisma/ORM rows from passkey endpoints** — Prisma maps
  `counter` to native JS `bigint`. `JSON.stringify` (used by Express/Nest)
  cannot serialize `bigint`, so any endpoint returning the raw DB row throws
  `TypeError: Do not know how to serialize a BigInt` after the write succeeds.
  Always return a response DTO; exclude `counter` entirely (clients never need it).
- **Separate loading states for autofill vs. explicit button** — The conditional
  UI call `startAuthentication({ useBrowserAutofill: true })` is a long-lived
  pending promise. A single `loading` flag shared with the explicit button leaves
  the "Sign in with a passkey" button disabled indefinitely. Use `autofillPending`
  (does NOT disable the button) separately from `loading` (only for the button).
- **AbortController must be called before starting a modal passkey request** —
  Only one WebAuthn request can be active at a time. If conditional UI is already
  pending and the user clicks the explicit button, the modal request is instantly
  rejected with `NotAllowedError` unless you first call `abortController.abort()`.
  Use `WebAuthnAbortService.cancelCeremony()` (SimpleWebAuthn) or your own ref.
- **Django: split `passkey_user_id` migration into three steps** — A single-step
  `AddField` with `default=uuid.uuid4, unique=True` fails on tables with existing
  rows because Django evaluates the default once, giving every row the same UUID.
  Always use: (1) add as nullable, (2) `RunSQL` with `gen_random_uuid()`,
  (3) `AlterField` to add `NOT NULL UNIQUE`. See `references/db-schema.md`.
- **Django: `options.challenge` is `bytes` — base64-encode before session storage** —
  py_webauthn returns `options.challenge` as `bytes`. Django sessions use a JSON
  serializer that cannot handle `bytes`, causing `TypeError: Object of type bytes
  is not JSON serializable` on challenge endpoints. Always encode:
  `request.session['key'] = base64.b64encode(options.challenge).decode()` and
  decode on retrieval: `base64.b64decode(request.session.pop('key'))`.
- **Django: `transports` stored as strings must be converted to enum on read** —
  `PublicKeyCredentialDescriptor` requires `AuthenticatorTransport` enum values.
  The `JSONField` stores them as plain strings. Always convert when building
  `excludeCredentials`: `transports=[AuthenticatorTransport(t) for t in (pk.transports or [])]`.
  Without this, `options_to_json()` throws `AttributeError: 'str' has no attribute 'value'`
  when any existing passkey's `transports` field is accessed.
- **Django: `verify_authentication_response()` raises on failure — no `.verified` field** —
  py_webauthn v2 raises an exception when verification fails. It does NOT return
  an object with a `.verified` attribute. Wrap the call in `try/except` and treat
  "reached the next line" as success. Never write `if not verification.verified`.
- **Django: use `sign_count` everywhere — never rename to `counter`** — py_webauthn
  returns `verification.new_sign_count`. The model field, serializer, and all view
  references must use the same name (`sign_count`). Mixing `counter` in queries
  with `sign_count` in the model causes `UndefinedColumn` errors at runtime.
- **Django: public passkey endpoints require `@csrf_exempt`** — The auth challenge
  and auth verify endpoints are called before the user has a CSRF cookie. Without
  `@csrf_exempt`, DRF/Django returns 403. Registration endpoints (called while
  logged in) do NOT need `@csrf_exempt` but the frontend must send `X-CSRFToken`.
- **Spring Boot / Go: in-memory storage is not production-safe** — The default
  Spring Security passkey config and many go-webauthn examples use in-memory
  stores. These lose all registered credentials on restart. Always implement
  a database-backed repository before deploying.
- **Laravel: install `sodium` or `paragonie/sodium-compat`** — Without the PHP
  sodium extension, EdDSA 25519 passkeys silently fail validation at login.
  Verify: `php -m | grep sodium`. See `references/backend-integration.md` §Laravel.
- **`@simplewebauthn/types` is retired in v13** — Types are now bundled in
  `@simplewebauthn/browser` and `@simplewebauthn/server`. Remove any
  `@simplewebauthn/types` dependency. `AuthenticatorDevice` is renamed to
  `WebAuthnCredential` in v13 — consult the SimpleWebAuthn CHANGELOG before upgrading.
- **`NotAllowedError` is almost always the user dismissing the prompt** — Over
  95% of `NotAllowedError` events are expected behavior (user cancelled). Do not
  show a red error state. Use neutral copy: "Cancelled — you can try again anytime."
  `AbortError` (conditional UI cleanup) and `InvalidStateError` (during conditional
  create) should also be caught silently or shown as neutral notices.
- **`userHandle` from auth response is base64url-encoded** — `body.response.userHandle`
  is a base64url string. Decoding before DB lookup is required. Node.js:
  `Buffer.from(userHandle, 'base64url').toString()`. Python:
  `base64.urlsafe_b64decode(userHandle + '==').decode()`. The raw string lookup
  always fails to find the user.

---

## Pre-Phase 0 — Activate Plan Mode (required)

Before scanning the project or generating any plan, activate your platform's
plan mode. Do NOT write implementation code without this step.

| Platform | How to activate plan mode |
|---|---|
| Claude Code | Call `EnterPlanMode` tool, or the user runs `/plan` |
| GitHub Copilot | Output a `## Plan` block and explicitly request approval |
| OpenAI Codex | Wrap plan in `<plan>...</plan>` tags; await approval |
| Cursor / Windsurf | Use the built-in plan/diff preview; await approval |
| All others | Output the complete plan as a titled section; write "Waiting for your approval to proceed." and stop |

Once the user approves the plan, call `ExitPlanMode` (Claude Code) or proceed
per your platform's convention. Only then begin implementation.

---

## Phase 0 — Project Scan (always run first)

Before generating any plan, understand what is in the project. Use whatever
file-reading and search capabilities are available to find:

**Dependency manifests** — look for any of:
`package.json`, `requirements.txt`, `Pipfile`, `pom.xml`, `build.gradle`,
`build.gradle.kts`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`,
`mix.exs`, `*.csproj`

**ORM and model files** — look for any of:
`*.prisma`, `*.entity.ts`, `*.model.py`, `*.entity.java`, `*.ex`, files
named `models.py`, `schema.rb`, or similar

**Auth-related files** — look for files containing:
`login`, `auth`, `session`, `jwt`, `token`, `passport`, `devise`,
`spring-security`, `sanctum`, `argon2`, `bcrypt`

**i18n libraries** — look for any of:
`i18next`, `react-i18next`, `react-intl`, `@formatjs/intl`, `vue-i18n`,
`@nuxtjs/i18n`, `@angular/localize`, `@ngx-translate/core`, `next-intl`,
`next-i18next`, `svelte-i18n`, `@inlang/paraglide-js`, `lingui`

**i18n translation files** — look for any of:
`public/locales/`, `src/i18n/`, `src/locales/`, `locales/`, `messages/`

If any i18n signal found: set flag `i18n_detected = true`

**Design system / component library** — look for any of:
`@mui/material`, `@chakra-ui/react`, `antd`, `@mantine/core`, `bootstrap`,
`react-bootstrap`, `primereact`, `primevue`, `vuetify`, `@angular/material`,
`daisyui`; or check for `tailwind.config.*`, `src/components/ui/`, shadcn
patterns (`cn()` helper, `components/ui/button.tsx`)

Record `design_system` = the detected name (e.g. "MUI", "Tailwind + shadcn/ui",
"Chakra UI", "Ant Design", "Bootstrap", "none"). Used in Phase 2 Step 0.

For agents with terminal access, these commands cover all of the above:

```bash
find . -name "package.json" -maxdepth 3 | grep -v node_modules
find . \( -name "pom.xml" -o -name "build.gradle" -o -name "build.gradle.kts" \
  -o -name "requirements.txt" -o -name "Pipfile" -o -name "Gemfile" \
  -o -name "go.mod" -o -name "Cargo.toml" -o -name "mix.exs" \
  -o -name "composer.json" -o -name "*.csproj" \) | grep -v node_modules | head -20
find . \( -name "*.prisma" -o -name "*.entity.ts" -o -name "*.model.py" \
  -o -name "*.entity.java" -o -name "*.ex" \) | head -20
```

### Classify the project mode

| Mode               | Condition                                             | Action                                                                                                                                                 |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Backend-only**   | No frontend framework found                           | Backend plan only                                                                                                                                      |
| **Frontend-only**  | No backend found                                      | Stop — ask questions first                                                                                                                             |
| **Full-stack**     | Both found in same working dir                        | Backend plan, then frontend                                                                                                                            |
| **Monorepo**       | Multiple `package.json` in `apps/*/` or `packages/*/` | Identify each sub-app; treat each as its own Backend-only or Frontend-only project; ask the user which sub-app(s) to target before generating any plan |
| **Separate repos** | User confirms split repos                             | Ask for backend context                                                                                                                                |

**If frontend-only: stop immediately.** Do not generate any plan. Ask the user
to fill in this backend context template:

```
BACKEND CONTEXT (required for frontend-only passkey integration)
================================================================
Backend framework:   [ e.g. NestJS, Django, Spring Boot, Laravel, Go, FastAPI ]
Database:            [ e.g. PostgreSQL, MySQL, MongoDB, SQLite ]
ORM:                 [ e.g. Prisma, TypeORM, SQLAlchemy, Hibernate, Eloquent, none ]
Current auth:        [ e.g. JWT in Authorization header, sessions, OAuth2, Sanctum ]
API base URL:        [ e.g. https://api.myapp.com or http://localhost:3000 ]
Passkey endpoints already implemented?   [ yes / no ]
  If yes, list them:
    Registration challenge:   [ POST /... ]
    Registration verify:      [ POST /... ]
    Auth challenge:           [ POST /... ]
    Auth verify:              [ POST /... ]
    List passkeys:            [ GET  /... ]
    Delete passkey:           [ DELETE /... ]
Backend plan document (if already generated): [ path or "not yet" ]
```

Once the user provides this, proceed with the Frontend Plan in Phase 2 only.
For separate-repo projects, save the filled template to a file (e.g.,
`passkey-backend-context.md`) in the frontend repo for future reference.

### Identify from what you find

**Backend framework** from manifests:

- `@nestjs/core`: NestJS | `express`: Express | `fastify`: Fastify
- `Django` in requirements: Django | `fastapi`: FastAPI
- `spring-boot-starter` in pom.xml: Spring Boot
- `laravel/framework`: Laravel | `rails` in Gemfile: Rails
- `go.mod` present: Go | `Cargo.toml`: Rust | `mix.exs`: Elixir/Phoenix

**ORM** from manifests or schema files:

- `*.prisma` file: Prisma | `@prisma/client`: Prisma
- `typeorm`: TypeORM | `sequelize`: Sequelize | `mongoose`: Mongoose
- `SQLAlchemy`: SQLAlchemy | `hibernate` in pom.xml: Hibernate
- `laravel/framework`: Eloquent | `activerecord`: ActiveRecord

**Auth mechanism** from code:

- `@nestjs/jwt`, `jsonwebtoken`, `jjwt`: JWT
- `express-session`, `request.session`: Sessions
- `passport-local`, `bcrypt`, `argon2`: Password-based login
- `laravel/sanctum`: Sanctum tokens
- `spring-boot-starter-security`: Spring Security

**Frontend framework** from package.json:

- `vue` without `nuxt`: Vue 3 | `nuxt`: Nuxt 3
- `react` without `next`: React | `next`: Next.js
- `@angular/core`: Angular
- `svelte` without `@sveltejs/kit`: Svelte | with kit: SvelteKit
- `@remix-run`: Remix

### Rollout strategy

After classification, present both options and ask which fits:

> **Rapid** (recommended for consumer apps) — Actively promote passkeys during
> sign-in, account creation, and recovery. Faster adoption, higher ROI. FIDO
> Alliance research shows Gradual without promotion yields single-digit enrollment.
>
> **Gradual** (for developer tools / internal / small-team projects) — Passkeys
> appear quietly in Account Settings. Users self-discover. Lowest effort, lowest risk.
>
> Recommendation based on project type:
> - Public-facing app with sign-up flow or active users → **Rapid**
> - Developer tool, internal app, or small team → **Gradual**
> - When in doubt → **Rapid**

---

## Phase 1 — Backend Plan

> **Read `references/library-matrix.md`** now to confirm the right library for
> the detected stack. Read `references/db-schema.md` for the correct ORM
> schema. Read `references/backend-integration.md` for implementation patterns.
> Read `assets/env-template.md` for RP environment variable configuration.

Present this plan in full **before writing any code**. Wait for approval.

```
BACKEND PASSKEY MIGRATION PLAN
================================
Stack:          [framework] + [ORM] + [DB]
Auth today:     [mechanism]
Library:        [chosen lib + rationale]
Rollout:        [Gradual / Rapid]
Journey stage:  Legacy Authentication to Optional Adoption

STEP 1 — Install
  [exact install command for chosen lib]

STEP 2 — Database (additive — zero existing columns removed)
  Add to users table: passkey_user_id (PII-free UUID, used as WebAuthn user.id)
  New passkeys table: id, passkey_user_id (FK -> users.passkey_user_id), credential_id (BYTES UNIQUE),
    public_key (BYTES), counter (BIGINT), device_type, backed_up,
    transports, aaguid, name, created_at, last_used_at
  [ORM-specific migration command]

STEP 3 — RP configuration
  rpId:   [domain only — no port, no protocol]
  rpName: [app name shown in device prompts]
  origin: [full origin — HTTPS in prod, HTTP only on localhost]
  Challenges: [Redis TTL-5min / session / DB — which and why]
  Passkey name: resolve from AAGUID via FIDO MDS at registration time
    (see security-checklist.md §F.2); default to "Passkey" if unrecognized

STEP 4 — Endpoints
  POST /auth/passkey/register/challenge    (auth required)
  POST /auth/passkey/register/verify       (auth required)
  POST /auth/passkey/authenticate/challenge (public)
  POST /auth/passkey/authenticate/verify   (public, issues token/session on success)
  GET  /auth/passkey/list                  (auth required)
  DELETE /auth/passkey/:id                 (auth required + ownership check)
  PATCH /auth/passkey/:id                  (auth required + ownership check — update name)

STEP 5 — Security
  Challenge: random, single-use, 5-min TTL, server-side only
  Delete challenge in both success AND catch/failure paths
  Counter: Number() on read, BigInt() on write (Prisma)
  User lookup: by credentialId first; by userHandle as fallback
  Ownership: always filter passkeys by userId before any operation
  Rate limiting: apply to all passkey endpoints; challenge endpoints
    especially — an unprotected challenge endpoint can be flooded to
    exhaust storage or probe the system (see security-checklist.md §G)

STEP 6 — Backward compatibility
  Existing [mechanism] login untouched — both methods coexist
```

> **Read `references/security-checklist.md`** before writing implementation code.
> It defines what correct code looks like — reading it upfront shapes your
> design decisions (challenge deletion, rate limiting, counter handling). Use it
> again after code is written as a verification pass.

---

## Phase 2 — Frontend Plan

> **Read `references/frontend-integration.md`** now for framework-specific
> patterns (Vue 3, React, Angular, Svelte, Nuxt, Next.js, SvelteKit) and
> design system adaptation guidance.
> **Read `references/ux-guidelines.md`** if designing passkey UI components —
> it contains the 10 FIDO UX principles and all 7 optional patterns.
> **Read `assets/ux-copy-templates.md`** for ready-to-use FIDO-tested copy.
> **Read `references/messaging-guidelines.md`** for FIDO-tested error messages
> and promotion copy to use in Step 6 and Step 3.
> **Read `references/i18n-guide.md`** if `i18n_detected = true` from Phase 0.

Present this plan **before writing any code**. Wait for approval.

```
FRONTEND PASSKEY MIGRATION PLAN
=================================
Stack:          [framework] + [UI lib]
Design system:  [detected from Phase 0, e.g. "MUI", "Tailwind + shadcn/ui", "none"]
i18n:           [detected from Phase 0: yes / no]
Endpoints:      [from Phase 1 above]
Rollout:        [Gradual / Rapid]

STEP 0 — Design System Adaptation (do this before writing any UI code)
  Inspect existing auth pages (login, signup, account settings) to identify:
    - Component library in use (MUI, shadcn/ui, Chakra, Ant Design, Bootstrap, etc.)
    - Class/prop pattern for primary buttons, inputs, modals, cards, badges
    - How error states are rendered (inline, toast, banner)
    - How loading/async states are shown (spinner, skeleton, disabled button)
  All passkey UI MUST use the same components and classes as the rest of the app.
  Never use raw <button> if the app has a <Button> component.
  Reference: references/frontend-integration.md §Design System Adaptation

STEP 1 — Install: [exact install command]

STEP 1b — Framework idiomatic structure
  React: extract all passkey logic into a usePasskey() hook
  Vue 3: use a usePasskey() composable with onUnmounted abort cleanup
  Angular: PasskeyService (injectable) with RxJS or Signals
  SvelteKit: $lib/passkey.ts store; dynamic import in onMount
  Next.js App Router: split Server Component page + 'use client' PasskeySection
  See references/frontend-integration.md §Framework-Specific Patterns

STEP 2 — Sign-in page
  Add autocomplete="username webauthn" + autofocus to email/username input
  On page load: call startAuthentication({useBrowserAutofill: true}) with
    AbortController so it cancels cleanly on component unmount
  Explicit "Sign in with a passkey" button (shown when WebAuthn supported)
  Password form fallback untouched

STEP 3 — Account Settings (required FIDO pattern)
  Passkey hero: FIDO icon + "Create a passkey" headline + benefit copy + CTA
  Passkey cards: user-assigned name (or AAGUID default), provider subtitle,
    date created, sync status badge, [Rename] button, [Remove] button
  Rename UI: inline edit — pencil icon → text input (pre-filled) → Save / Cancel
  Post-creation: optional "Name this passkey" prompt with AAGUID name pre-filled
  "Add another passkey" when ≥1 exists; delete with confirmation dialog
  See assets/ux-copy-templates.md for rename copy and card copy

STEP 4 — Cross-device handling
  After auth: check authenticatorAttachment === 'cross-platform'
  If true: show "Set up a passkey on this device?" interstitial

STEP 5 — Post-login upgrade nudge
  One-time, dismissible prompt after password login (required for Rapid;
  optional for Gradual). Persist dismissal server-side — never re-shown.

STEP 5b — Google Password Manager upgrade signal (recommended for Rapid)
  Create /.well-known/passkey-endpoints at your RP domain root:
  { "enroll": "https://yourdomain.com/account/passkeys/create",
    "manage": "https://yourdomain.com/account/passkeys" }
  Host at RP_ID domain, not a subdomain.

STEP 6 — Error handling
  NotAllowedError: "Cancelled. Try again anytime." (user dismissed or timed out)
  InvalidStateError: "A passkey already exists on this device."
  SecurityError: log only (always a config bug — fix rpId, never show to users)
  NotSupportedError: hide passkey UI silently
  404 from server (credential not found): call signalUnknownCredential() to
    clean up orphaned passkeys in the provider, then show fallback sign-in
  See references/troubleshooting.md for full error diagnosis guide and
  references/messaging-guidelines.md for FIDO-tested error copy templates

STEP 7 — Accessibility (WCAG 2.1 AA)
  autocomplete="username webauthn" on username input
  All buttons: visible text label + FIDO passkey icon
  aria-live="polite" for post-dialog status; role="alert" for errors
  Keyboard navigable: create, list, rename, delete passkeys
  Focus returns to trigger after dialog closes
  Color contrast ≥ 4.5:1; sync badge uses text + icon, not color alone

STEP 8 — Browser testing
  Chrome (desktop + Android), Safari (macOS + iOS), Edge + Windows Hello — full support
  Firefox (desktop) — passkey registration and auth work; Conditional UI autofill
    is NOT supported in Firefox as of 2026; ensure password fallback is reachable

STEP 9 — Internationalization (only if i18n_detected = true from Phase 0)
  Do NOT hardcode any user-visible passkey string.
  Wrap all text in your i18n function: t(), $t(), formatMessage(), $localize, etc.
  Key prefix: "passkeys.*"
  Load references/i18n-guide.md for the full key catalog and per-framework examples.
  Required keys: passkeys.createButton, passkeys.signInButton, passkeys.heroHeadline,
    passkeys.heroBenefitShort, passkeys.card.syncedLabel, passkeys.card.deviceOnlyLabel,
    passkeys.card.renameButton, passkeys.deleteConfirm.*, passkeys.errors.*
```

---

## Phase 3 — Implement

Implement backend first. **Do not start frontend implementation until the
backend checkpoint below passes.** Existing auth (passwords, sessions, tokens)
is untouched — if passkey endpoints fail at any point, disabling them restores
the prior login path without any rollback needed.

### Install Verification (run immediately after writing package installs)

Before testing any endpoint, confirm packages are actually installed:

```bash
# Backend
cd <backend-directory>
npm install    # or: yarn install / pip install -r requirements.txt / bundle install
# Expected: zero errors; passkey library name appears in install output

# Frontend
cd <frontend-directory>
npm install    # or: yarn install
# Expected: zero errors

# Confirm passkey library is in dependencies (not devDependencies)
grep -A 30 '"dependencies"' package.json | grep -E 'simplewebauthn|webauthn|passkey'
```

If install fails or the library is missing from `dependencies`: re-run with
`--save` or add manually to `package.json`. Do not proceed until install is clean.

### Backend checkpoint (required before frontend)

Run these three commands and confirm all return expected responses before
writing any frontend code:

```bash
# 1. Registration challenge — must return HTTP 200 with challenge + options JSON
curl -X POST http://localhost:3000/auth/passkey/register/challenge \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json"

# 2. Authentication challenge — must return HTTP 200 with challenge JSON
curl -X POST http://localhost:3000/auth/passkey/authenticate/challenge \
  -H "Content-Type: application/json"

# 3. List passkeys — must return HTTP 200 with empty array initially
curl http://localhost:3000/auth/passkey/list \
  -H "Authorization: Bearer <token>"
```

If any of these fail, debug the backend (rpId, origin, challenge storage,
env vars) before proceeding. Do not layer frontend complexity on top of a
broken backend.

### Verify endpoint failure — debug checklist

When `/register/verify` or `/auth/verify` returns HTTP 400 or 401 and the
client-side ceremony completed without error, work through these causes in order:

```
1. rpID mismatch
   Check: does RP_ID env var match the exact domain the browser used?
   Common mistake: RP_ID=app.example.com but request came from example.com,
   or RP_ID=localhost but request came from 127.0.0.1.
   Fix: align RP_ID with the effective domain shown in browser DevTools -> Application -> Passkeys.

2. Origin mismatch
   Check: does APP_ORIGIN match the exact origin (scheme + host + port) of the page?
   Common mistake: APP_ORIGIN=https://example.com but app runs on http://localhost:3000,
   or port is omitted when it should be present (e.g. :8080).
   Fix: set APP_ORIGIN to the exact value of window.location.origin in the browser.

3. Challenge not found or already consumed
   Check: is the challenge store (Redis/session) reachable? Did the challenge TTL expire?
   Did a previous failed attempt already delete the challenge?
   Fix: log the stored challenge immediately before the verify call.
   Expected: a 32-byte base64url string. Missing or null means storage is broken.

4. Multi-instance challenge miss (distributed deployments only)
   Check: is challenge storage in-memory or local to one process?
   Symptom: verify works sometimes but not consistently under load or after deploy.
   Fix: switch to Redis (see Challenge Storage decision tree above).

5. Request body serialization
   Check: is the body being JSON.stringify'd twice, or missing Content-Type: application/json?
   Symptom: library throws "unexpected token" or "cannot read property of undefined".
   Fix: send the raw object from startRegistration/startAuthentication directly
   without re-encoding. Set Content-Type: application/json on the fetch call.

6. passkeyUserId buffer encoding (registration only)
   Check: is user.passkeyUserId a valid UUID string (36 chars) passed through Buffer.from()?
   Symptom: "user.id must be a BufferSource" or credential creation fails silently.
   Fix: Buffer.from(user.passkeyUserId ?? crypto.randomUUID()) — never pass null or undefined.

7. userHandle decoding (authentication only)
   Check: is body.response.userHandle being decoded from base64url before DB lookup?
   Symptom: "user not found" or 404 even though the passkey exists in the DB.
   Fix (Node.js): Buffer.from(userHandle, 'base64url').toString()
   Fix (Python):  base64.urlsafe_b64decode(userHandle + '==').decode()
   The raw base64url string never matches any DB record directly.
```

After both backend and frontend are complete, run through the security
checklist in `references/security-checklist.md`.

### Implementation Completeness Checklist (required before Phase 4)

Work through every applicable item. Do not declare Phase 3 complete until all
boxes can be checked. Items marked with a rollout type only apply when that
rollout was selected.

**Backend**
- [ ] `passkey_user_id` column added to users table (PII-free UUID, unique)
- [ ] `passkeys` table created with all columns: `name`, `aaguid`, `last_used_at` included
- [ ] `POST /auth/passkey/register/challenge` — returns HTTP 200 + options JSON
- [ ] `POST /auth/passkey/register/verify` — returns HTTP 201 on success
- [ ] `POST /auth/passkey/authenticate/challenge` — returns HTTP 200 + challenge JSON
- [ ] `POST /auth/passkey/authenticate/verify` — returns HTTP 200 + session/token on success
- [ ] `GET  /auth/passkey/list` — returns HTTP 200 + array (empty array OK initially)
- [ ] `DELETE /auth/passkey/:id` — returns HTTP 204; ownership check confirmed
- [ ] `PATCH /auth/passkey/:id` — returns HTTP 200; ownership check + name validation confirmed
- [ ] Challenge deleted in **both** success AND catch/failure paths
- [ ] `excludeCredentials` populated from existing passkeys during registration
- [ ] `BigInt`/`Number` conversion in place for `counter` field (Prisma/TypeORM)
- [ ] Rate limiting applied to all passkey endpoints (especially challenge endpoints)
- [ ] `RP_ID`, `APP_ORIGIN`, `APP_NAME` env vars set and loaded correctly
- [ ] Passkey `name` auto-set from AAGUID resolver at registration time
- [ ] `userHandle` from auth response decoded from base64url before DB lookup

**NestJS-specific**
- [ ] `register/verify` DTO uses `forbidNonWhitelisted: false` OR includes `publicKeyAlgorithm`, `publicKey`, `authenticatorData` as `@IsOptional()` (SWA v13+ fields)
- [ ] All passkey endpoints return response DTOs — never raw Prisma rows; `counter` excluded or converted with `Number()`

**Django-specific**
- [ ] `passkey_user_id` migration uses 3-step approach (nullable → `RunSQL gen_random_uuid()` → `NOT NULL UNIQUE`)
- [ ] `options.challenge` base64-encoded before session storage in all challenge views
- [ ] `transports` converted to `AuthenticatorTransport` enum when building `excludeCredentials`
- [ ] No `.verified` attribute check — `verify_authentication_response()` raises on failure in py_webauthn v2
- [ ] Field name is `sign_count` throughout (model, serializer, views) — never `counter`
- [ ] Public endpoints (`authenticate/challenge`, `authenticate/verify`) decorated with `@csrf_exempt`

**Spring Boot / Go**
- [ ] Persistence backend implemented (JDBC/DB-backed repositories) — NOT in-memory storage

**Laravel**
- [ ] `extension_loaded('sodium')` confirmed true in deployment environment

**Frontend**
- [ ] Passkey library in `dependencies` (not `devDependencies`) — confirmed by grep
- [ ] `autocomplete="username webauthn"` on the username/email input
- [ ] Conditional UI: `startAuthentication({ useBrowserAutofill: true })` runs on page load with `AbortController` cleanup
- [ ] Explicit "Sign in with a passkey" button present and functional
- [ ] Passkey logic extracted into hook / composable / service (not inline in component)
- [ ] Account Settings passkey hero section (icon + headline + benefit + CTA)
- [ ] Passkey cards: name, provider subtitle, dates, sync status badge, Rename, Remove
- [ ] Inline rename UI: edit trigger → text input → Save / Cancel
- [ ] Post-creation name prompt (optional) or default name displayed after success
- [ ] Delete confirmation dialog with explanation of consequences
- [ ] All passkey UI uses the project's existing component library (no raw HTML if a design system exists)
- [ ] Error states use the same styling as other errors in the app
- [ ] Loading states use the same pattern as other async operations in the app
- [ ] `NotAllowedError` → user-friendly message (not raw JS error name)
- [ ] `InvalidStateError` → passkey already exists message
- [ ] `SecurityError` → caught and logged only, never shown to users
- [ ] 404 from server → `signalUnknownCredential()` called before showing fallback
- [ ] FIDO passkey icon used in all passkey UI
- [ ] `aria-live="polite"` on result messages; `role="alert"` on errors
- [ ] All passkey buttons have visible text labels
- [ ] If `i18n_detected`: all passkey strings use translation keys, not hardcoded text

**Gradual rollout only**
- [ ] Account Settings passkey section fully functional end-to-end
- [ ] Sign-in page Conditional UI working in Chrome/Edge/Safari
- [ ] Password login coexists with no regressions

**Rapid rollout only**
- [ ] Post-login upgrade nudge: one-time, dismissible, dismissal persisted server-side
- [ ] Account creation flow includes passkey creation prompt
- [ ] Password reset / account recovery flow offers passkey creation
- [ ] `/.well-known/passkey-endpoints` JSON file at rpID domain root
- [ ] Metrics instrumentation: enrollment, sign-in success, fallback rate events

### End-to-End Passkey Flow Verification (required for all rollout types)

Open the running app in Chrome or Safari. Walk through each flow manually:

**Registration**
1. Sign in with password → go to Account Settings → Passkey section
2. Click "Create a passkey" → verify handshake screen appears before browser prompt
3. Approve → verify success message and passkey card appear
4. Verify card shows: name, provider subtitle, sync status badge
5. Click Rename → enter a new name → Save → verify name updates in UI
6. Click Remove → verify confirmation dialog → confirm → card disappears

**Authentication**
1. Sign out → click "Sign in with a passkey" → browser picker appears → authenticate
2. Verify: user is signed in without entering a password

**Conditional UI** (Chrome / Edge / Safari only)
1. Sign out → click the username field → verify passkey appears in autocomplete

**Error handling**
1. Click "Create a passkey" → cancel the browser prompt → verify friendly message shown
2. Verify password login still works correctly (no regressions)

**Design system check**
1. Compare passkey UI visually against the existing sign-in page
2. Verify: fonts, spacing, button styles, and color scheme match exactly
3. Verify: error states and loading states match the app's existing patterns

### Rapid Rollout Verification (Rapid only — run before Phase 4)

Walk through each promotion path end-to-end:

1. **Account creation**: register a new user → passkey prompt appears → create → user lands in app with passkey registered
2. **Post-login nudge**: sign in with password → nudge appears → create passkey → sign out → sign in again → nudge does **not** appear
3. **Password reset**: start forgot-password flow → after verification, passkey creation is offered → can create OR skip
4. **Metrics**: trigger one registration + one sign-in → confirm events appear in your analytics/logging system

If any path fails: fix before going live. A broken promotion path erodes trust more than no promotion at all.

---

## Phase 4 — Rollout

> **Read `references/rollout-guide.md`** now. It contains the full 5-phase
> rollout plan for both Gradual and Rapid strategies, the 4-stage phishing
> prevention journey, post-launch metrics, and anti-patterns.

Current project starts at **Stage 1: Legacy Authentication**.
This migration moves it to **Stage 2: Optional Adoption**.
Guide the user toward Stage 3 (Partial Prevention) as the next milestone.

---

## Reference Files

| File                                 | Load when                                                      |
| ------------------------------------ | -------------------------------------------------------------- |
| `references/library-matrix.md`       | Phase 1 start — selecting the library                          |
| `references/backend-integration.md`  | Phase 1 — generating backend code                              |
| `references/db-schema.md`            | Phase 1 — writing ORM migrations                               |
| `references/frontend-integration.md` | Phase 2 — generating frontend code and framework patterns      |
| `references/ux-guidelines.md`        | Phase 2 — designing passkey UI components                      |
| `references/i18n-guide.md`           | Phase 2 — only if `i18n_detected = true` from Phase 0          |
| `references/security-checklist.md`   | Phase 3 — verifying the implementation                         |
| `references/testing-guide.md`        | Phase 3 — writing tests and CI setup                           |
| `references/troubleshooting.md`      | Phase 3/4 — debugging integration issues                       |
| `references/messaging-guidelines.md` | Phase 2 — error copy and promotion copy                        |
| `references/rollout-guide.md`        | Phase 4 — planning the rollout                                 |
| `assets/ux-copy-templates.md`        | Phase 2 — writing passkey UI copy and labels                   |
| `assets/env-template.md`             | Phase 1 — configuring RP environment variables                 |

Do not load all reference files at once. Load each file at the phase indicated.

---

## Non-negotiable rules

1. **Plan before code.** Never write implementation code before presenting and
   getting approval for the written plan.
2. **Backend before frontend.** Frontend plan references backend endpoints.
3. **Additive only.** Never remove or modify existing auth. Passkeys coexist
   with passwords until the user deliberately deprecates them.
4. **Server-side validation always.** The client cannot be trusted for challenge
   verification. All cryptographic checks happen on the server.
5. **Store only public keys.** Never store private keys, raw biometric data, or
   the full credential response.
6. **Challenge hygiene.** Random, single-use, server-generated, deleted
   immediately after use — whether verification succeeded or failed.
7. **rpId is domain only.** One wrong character breaks every ceremony silently.
8. **FIDO passkey icon.** Use the official icon in all passkey UI. Download from
   fidoalliance.org/get-the-passkey-icon/ — free for sites offering passkeys.
9. **Accessible UI.** Labeled buttons, aria-live, keyboard nav, WCAG 2.1 AA.
10. **Frontend-only projects wait.** Get backend context before writing any plan.
11. **`excludeCredentials` is mandatory.** Always pass existing credential IDs
    when generating registration options. Omitting this allows users to register
    unlimited duplicate passkeys for the same device, cluttering their passkey list
    and causing confusing UI states.
12. **Plan mode before code.** Activate plan mode before presenting Phase 1 or
    Phase 2 plans. Never write implementation code in the same response as a plan.
    See Pre-Phase 0 for per-platform instructions.
13. **Design system compliance.** All passkey UI must use the project's existing
    component library. Inspect the sign-in page and account settings before writing
    any component. Never introduce raw HTML elements where a design system component
    exists. Never introduce a new visual pattern for errors or loading states.
14. **Both rollout paths are complete-or-nothing.** If Rapid is selected, every
    Rapid feature must be implemented before Phase 4. If Gradual is selected, all
    required FIDO patterns (Account Settings + sign-in page) must be fully working.
    Partial rollout implementations confuse users and break trust.
