---
name: passkeys-auth-migration
description: >
  Use this skill when the user wants to add passkeys, migrate to passwordless
  authentication, implement WebAuthn or FIDO2, or replace passwords/OTP/magic
  links with biometric or device-based login. Also use it when the user is
  debugging an existing passkey/WebAuthn flow or asking how to test passkey
  endpoints and CI without hardware authenticators. Trigger on phrases like
  "add passkeys", "implement passkeys", "migrate to passwordless", "WebAuthn",
  "FIDO2", "biometric login", "passkey authentication", "passkey autofill not
  showing", or "test passkey endpoints". Works for backend-only,
  frontend-only, separate-repo, or full-stack projects across any framework.
  Do not trigger for general OAuth, SSO, non-passkey auth questions, general
  passkey security/comparison explainers that do not ask for migration,
  implementation, debugging, or testing, or hardware security key (FIDO U2F /
  WebAuthn second-factor only) questions where the user explicitly wants a
  second-factor flow rather than passwordless passkeys.
license: MIT
metadata:
  author: Sadjad Ousmane
  version: "1.0.0"
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

These are non-obvious mistakes agents make without being told:

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

> **Gradual** — Passkeys appear quietly in Account Settings. Users self-discover
> them. Lowest effort, lowest risk, no marketing needed.
>
> **Rapid** — Actively promote passkeys during sign-in, account creation, and
> recovery. Faster adoption, higher ROI, more work upfront.
>
> Default recommendation: **Gradual** for developer/internal projects.

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

STEP 4 — Endpoints
  POST /auth/passkey/register/challenge    (auth required)
  POST /auth/passkey/register/verify       (auth required)
  POST /auth/passkey/authenticate/challenge (public)
  POST /auth/passkey/authenticate/verify   (public, issues token/session on success)
  GET  /auth/passkey/list                  (auth required)
  DELETE /auth/passkey/:id                 (auth required + ownership check)

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
> patterns (Vue 3, React, Angular, Svelte, Nuxt, Next.js, SvelteKit).
> **Read `references/ux-guidelines.md`** if designing passkey UI components —
> it contains the 10 FIDO UX principles and all 7 optional patterns.
> **Read `assets/ux-copy-templates.md`** for ready-to-use FIDO-tested copy.
> **Read `references/messaging-guidelines.md`** for FIDO-tested error messages
> and promotion copy to use in Step 6 and Step 3.

Present this plan **before writing any code**. Wait for approval.

```
FRONTEND PASSKEY MIGRATION PLAN
=================================
Stack:     [framework] + [UI lib]
Endpoints: [from Phase 1 above]
Rollout:   [Gradual / Rapid]

STEP 1 — Install: [exact install command]

STEP 2 — Sign-in page
  Add autocomplete="username webauthn" + autofocus to email/username input
  On page load: call startAuthentication({useBrowserAutofill: true}) silently
  Explicit "Sign in with a passkey" button (shown when WebAuthn supported)
  Password form fallback untouched

STEP 3 — Account Settings (required FIDO pattern)
  Passkey hero: FIDO icon + "Create a passkey" headline + benefit copy + CTA
  Passkey cards: provider name (from aaguid), date created, sync status badge
  "Add another passkey" when ≥1 exists; delete with confirmation

STEP 4 — Cross-device handling
  After auth: check authenticatorAttachment === 'cross-platform'
  If true: show "Set up a passkey on this device?" interstitial

STEP 5 — Post-login upgrade nudge (Gradual rollout)
  One-time, dismissible prompt after password login

STEP 5b — Google Password Manager upgrade signal (optional but recommended)
  Create /.well-known/passkey-endpoints at your RP domain root:
  { "enroll": "https://yourdomain.com/account/passkeys/create",
    "manage": "https://yourdomain.com/account/passkeys" }
  This enables Google Password Manager to suggest passkey upgrades to users
  automatically after password sign-in. Host at RP_ID domain, not a subdomain.

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
  Keyboard navigable: create, list, delete passkeys
  Focus returns to trigger after dialog closes
  Color contrast ≥ 4.5:1; sync badge uses text + icon, not color alone

STEP 8 — Browser testing
  Chrome (desktop + Android), Safari (macOS + iOS), Edge + Windows Hello — full support
  Firefox (desktop) — passkey registration and auth work; Conditional UI autofill
    is NOT supported in Firefox as of 2026; ensure password fallback is reachable
```

---

## Phase 3 — Implement

Implement backend first. **Do not start frontend implementation until the
backend checkpoint below passes.** Existing auth (passwords, sessions, tokens)
is untouched — if passkey endpoints fail at any point, disabling them restores
the prior login path without any rollback needed.

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
```

After both backend and frontend are complete, run through the security
checklist in `references/security-checklist.md`.

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

| File                                 | Load when                                      |
| ------------------------------------ | ---------------------------------------------- |
| `references/library-matrix.md`       | Phase 1 start — selecting the library          |
| `references/backend-integration.md`  | Phase 1 — generating backend code              |
| `references/db-schema.md`            | Phase 1 — writing ORM migrations               |
| `references/frontend-integration.md` | Phase 2 — generating frontend code             |
| `references/ux-guidelines.md`        | Phase 2 — designing passkey UI components      |
| `references/security-checklist.md`   | Phase 3 — verifying the implementation         |
| `references/testing-guide.md`        | Phase 3 — writing tests and CI setup           |
| `references/troubleshooting.md`      | Phase 3/4 — debugging integration issues       |
| `references/messaging-guidelines.md` | Phase 2 — error copy and promotion copy        |
| `references/rollout-guide.md`        | Phase 4 — planning the rollout                 |
| `assets/ux-copy-templates.md`        | Phase 2 — writing passkey UI copy and labels   |
| `assets/env-template.md`             | Phase 1 — configuring RP environment variables |

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
