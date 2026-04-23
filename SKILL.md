---
name: passkeys-auth-migration
description: >
  Use this skill when the user wants to add passkeys, migrate to passwordless
  authentication, implement WebAuthn or FIDO2, or replace passwords/OTP/magic
  links with biometric or device-based login. Trigger on phrases like "add
  passkeys", "implement passkeys", "migrate to passwordless", "WebAuthn",
  "FIDO2", "biometric login", or "passkey authentication". Works for
  backend-only, frontend-only, or full-stack projects across any framework.
  Do not trigger for general OAuth, SSO, or non-passkey auth questions.
license: MIT
compatibility: >
  Works with any coding agent that supports file reading and terminal commands
  (Claude Code, GitHub Copilot agent mode, Cursor, Windsurf, Gemini CLI,
  OpenAI Codex, and similar). No special tools required beyond the ability to
  read files and run shell commands. Internet access not required during
  execution.
metadata:
  author: sadjad-moh
  version: "1.0.0"
  tags: authentication passkeys webauthn fido2 security passwordless migration
---

# Passkey Migration Skill

Migrates any existing authentication system to passkeys (WebAuthn/FIDO2),
following FIDO Alliance best practices, UX guidelines, and security standards.
Covers backend, frontend, database schema, rollout strategy, and security
hardening. Always presents a written plan for approval before writing code.

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
  Their *native* (non-extension) counterparts are compliant. See
  `references/troubleshooting.md` for details.
- **`/.well-known/passkey-endpoints`** — add this JSON file to your domain so
  Google Password Manager can prompt users to upgrade to passkeys after password
  sign-in. Required for the "promote passkey upgrades" pattern.
- **`excludeCredentials` prevents duplicate passkeys** — always pass existing
  credential IDs when generating registration options. Without this, users can
  register unlimited passkeys for the same device.

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

| Mode               | Condition                   | Action                      |
| ------------------ | --------------------------- | --------------------------- |
| **Backend-only**   | No frontend framework found | Backend plan only           |
| **Frontend-only**  | No backend found            | Stop — ask questions first  |
| **Full-stack**     | Both found in working dir   | Backend plan, then frontend |
| **Separate repos** | User confirms split repos   | Ask for backend context     |

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

- `@nestjs/core` → NestJS | `express` → Express | `fastify` → Fastify
- `Django` in requirements → Django | `fastapi` → FastAPI
- `spring-boot-starter` in pom.xml → Spring Boot
- `laravel/framework` → Laravel | `rails` in Gemfile → Rails
- `go.mod` present → Go | `Cargo.toml` → Rust | `mix.exs` → Elixir/Phoenix

**ORM** from manifests or schema files:

- `*.prisma` file → Prisma | `@prisma/client` → Prisma
- `typeorm` → TypeORM | `sequelize` → Sequelize | `mongoose` → Mongoose
- `SQLAlchemy` → SQLAlchemy | `hibernate` in pom.xml → Hibernate
- `laravel/framework` → Eloquent | `activerecord` → ActiveRecord

**Auth mechanism** from code:

- `@nestjs/jwt`, `jsonwebtoken`, `jjwt` → JWT
- `express-session`, `request.session` → Sessions
- `passport-local`, `bcrypt`, `argon2` → Password-based login
- `laravel/sanctum` → Sanctum tokens
- `spring-boot-starter-security` → Spring Security

**Frontend framework** from package.json:

- `vue` without `nuxt` → Vue 3 | `nuxt` → Nuxt 3
- `react` without `next` → React | `next` → Next.js
- `@angular/core` → Angular
- `svelte` without `@sveltejs/kit` → Svelte | with kit → SvelteKit
- `@remix-run` → Remix

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
Journey stage:  Legacy Authentication → Optional Adoption

STEP 1 — Install
  [exact install command for chosen lib]

STEP 2 — Database (additive — zero existing columns removed)
  Add to users table: passkey_user_id (PII-free UUID, used as WebAuthn user.id)
  New passkeys table: id, user_id (FK), credential_id (BYTES UNIQUE),
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
  POST /auth/passkey/authenticate/verify   (public → issues token/session)
  GET  /auth/passkey/list                  (auth required)
  DELETE /auth/passkey/:id                 (auth required + ownership check)

STEP 5 — Security
  Challenge: random, single-use, 5-min TTL, server-side only
  Delete challenge in both success AND catch/failure paths
  Counter: Number() on read, BigInt() on write (Prisma)
  User lookup: by credentialId first; by userHandle as fallback
  Ownership: always filter passkeys by userId before any operation

STEP 6 — Backward compatibility
  Existing [mechanism] login untouched — both methods coexist

Estimated effort: [X days / X sprints]
```

> **Read `references/security-checklist.md`** during implementation, not before.
> It contains 30+ verification checks to run after code is written.

---

## Phase 2 — Frontend Plan

> **Read `references/frontend-integration.md`** now for framework-specific
> patterns (Vue 3, React, Angular, Svelte, Nuxt, Next.js, SvelteKit).
> **Read `references/ux-guidelines.md`** if designing passkey UI components —
> it contains the 10 FIDO UX principles and all 7 optional patterns.
> **Read `assets/ux-copy-templates.md`** for ready-to-use FIDO-tested copy.

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
  NotAllowedError → "Cancelled. Try again anytime." (user dismissed or timed out)
  InvalidStateError → "A passkey already exists on this device."
  SecurityError → log only (always a config bug — fix rpId, never show to users)
  NotSupportedError → hide passkey UI silently
  404 from server (credential not found) → call signalUnknownCredential() to
    clean up orphaned passkeys in the provider, then show fallback sign-in
  See references/troubleshooting.md for full error diagnosis guide and
  references/messaging-guidelines for FIDO-tested error copy templates

STEP 7 — Accessibility (WCAG 2.1 AA)
  autocomplete="username webauthn" on username input
  All buttons: visible text label + FIDO passkey icon
  aria-live="polite" for post-dialog status; role="alert" for errors
  Keyboard navigable: create, list, delete passkeys
  Focus returns to trigger after dialog closes
  Color contrast ≥ 4.5:1; sync badge uses text + icon, not color alone

STEP 8 — Browser testing
  Chrome (desktop + Android), Safari (macOS + iOS),
  Firefox (desktop), Edge + Windows Hello
```

---

## Phase 3 — Implement

Implement backend first, test endpoints independently, then implement frontend.

**Quick endpoint tests (adapt to your HTTP client):**

```bash
# Registration challenge — requires auth token
curl -X POST http://localhost:3000/auth/passkey/register/challenge \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json"

# Authentication challenge — public
curl -X POST http://localhost:3000/auth/passkey/authenticate/challenge \
  -H "Content-Type: application/json"

# List passkeys — requires auth token
curl http://localhost:3000/auth/passkey/list \
  -H "Authorization: Bearer <token>"
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

| File                                  | Load when                                      |
| ------------------------------------- | ---------------------------------------------- |
| `references/library-matrix.md`        | Phase 1 start — selecting the library          |
| `references/backend-integration.md`   | Phase 1 — generating backend code              |
| `references/db-schema.md`             | Phase 1 — writing ORM migrations               |
| `references/frontend-integration.md`  | Phase 2 — generating frontend code             |
| `references/ux-guidelines.md`         | Phase 2 — designing passkey UI components      |
| `references/security-checklist.md`    | Phase 3 — verifying the implementation         |
| `references/testing-guide.md`         | Phase 3 — writing tests and CI setup           |
| `references/troubleshooting.md`       | Phase 3/4 — debugging integration issues       |
| `references/rollout-guide.md`         | Phase 4 — planning the rollout                 |
| `assets/ux-copy-templates.md`         | Phase 2 — writing passkey UI copy and labels   |
| `assets/env-template.md`              | Phase 1 — configuring RP environment variables |

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
