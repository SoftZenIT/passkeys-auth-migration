# passkeys-auth-migration

An Agent Skill that migrates any existing authentication system to passkeys
(WebAuthn/FIDO2), following FIDO Alliance best practices, UX guidelines, and
security standards.

## What it does

Given any web project, this skill:

1. **Scans the project** — detects framework, ORM, database, and current auth
2. **Generates a written plan** — backend first, then frontend, before any implementation
3. **Implements the migration** — using the correct library for your stack
4. **Applies FIDO UX guidelines** — hero prompts, passkey cards, conditional UI
5. **Enforces security** — challenge hygiene, counter tracking, rpId validation
6. **Guides rollout** — gradual or rapid strategy, phishing prevention stages

## Supported stacks

### Backend

| Framework                               | Library                  |
| --------------------------------------- | ------------------------ |
| NestJS, Express, Fastify, Next.js (API) | `@simplewebauthn/server` |
| Django, FastAPI, Flask                  | `py_webauthn`            |
| Spring Boot, Jakarta EE                 | `java-webauthn-server`   |
| Laravel, Symfony                        | `web-auth/webauthn-lib`  |
| Rails + Devise                          | `devise-passkeys`        |
| Go (Gin, Echo, Chi)                     | `go-webauthn/webauthn`   |
| ASP.NET Core                            | `Fido2NetLib`            |
| Rust (Actix, Axum)                      | `webauthn-rs`            |
| Elixir Phoenix                          | `wax`                    |

### ORM / Database

Prisma · TypeORM · Sequelize · Mongoose · SQLAlchemy · Django ORM ·
Hibernate/JPA · Eloquent · ActiveRecord · GORM · Raw SQL

### Frontend

Vue 3 · React · Angular · Svelte · SvelteKit · Nuxt 3 · Next.js · Remix

## Install

```bash
npx skills add softzenit/passkeys-auth-migration
```

Or manually:

```bash
git clone https://github.com/softzenit/passkeys-auth-migration.git /tmp/passkeys-auth-migration
cp -r /tmp/passkeys-auth-migration/passkeys-auth-migration .agents/skills/
```

The expected layout:

```
your-project/
└── .agents/skills/
    └── passkeys-auth-migration/
        ├── SKILL.md
        └── references/
```

## Trigger phrases

The skill activates on prompts like:

- "Add passkeys to my app"
- "Integrate WebAuthn into my [framework] project"
- "Migrate to passwordless authentication"
- "Implement WebAuthn / FIDO2"
- "Replace password login with passkeys"
- "Add biometric login"
- "How do I support passkeys in [framework]?"
- "My passkey autofill isn't showing up"
- "Rename passkeys in account settings"
- "Add AAGUID-based passkey names"
- "Debug passkey verify endpoint returning 401"
- "Test passkey endpoints without hardware"
- "Get password users onto passkeys automatically" (conditional create)
- "Make our sign-in button smart" (immediate UI mode)
- "Unlock encryption with a passkey" (PRF)

## Compatible agents

Claude Code · GitHub Copilot · Cursor · Gemini CLI · OpenAI Codex

## What you get

For each project, the skill produces:

- A written migration plan (backend + frontend) presented before any implementation
- Database migration (additive — never removes existing auth)
- Registration endpoints (`/auth/passkey/register/challenge` + `/verify`)
- Authentication endpoints (`/auth/passkey/authenticate/challenge` + `/verify`)
- Passkeys management endpoints (list, delete, **rename**)
- AAGUID-based default passkey names resolved at registration time
- Frontend components: conditional UI sign-in, account settings with passkey
  cards, hero prompt, cross-device interstitial, inline rename UI
- i18n support: detects your translation library and generates a key catalog
  (`passkeys.*` namespace) so UI copy is never hardcoded in English
- Design system adaptation: detects Tailwind, MUI, shadcn/ui, or plain CSS
  and generates components that match your existing stack
- Automatic passkey upgrades (conditional create) after password sign-in,
  with a sane trigger policy and passive confirmation UX
- Advanced features on demand: smart sign-in button (immediate UI mode),
  passkey-derived E2E encryption (PRF), multi-domain passkeys (Related
  Origin Requests), iframe embedding, portability messaging (CXP/CXF)
- Security review
- Implementation completeness checklist before handoff
- Rollout guidance (FIDO Gradual or Rapid strategy)

## Sources and standards

Built on:

- [FIDO Alliance Passkey Central](https://passkeycentral.org) — design guidelines, UX principles, rollout guides, phishing prevention journey
- [passkeys.dev](https://passkeys.dev) — library selection, bootstrapping patterns, conditional UI
- [Google Identity Passkeys Guide](https://developers.google.com/identity/passkeys) — server-side registration and authentication patterns, DB schema
- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) (Candidate Recommendation, 2026-01-13) — cryptographic correctness, rpId, challenge, counter validation, conditional create, Signal API, hints, Related Origin Requests

## Security model

- **Public keys only** stored server-side — private keys never leave the device
- **Biometric data never transmitted** — device-local verification only
- **Challenge hygiene** — random, single-use, server-generated, deleted on both success and failure
- **Counter tracking** — replay attack prevention on every authentication
- **Phishing-resistant** — rpId bound to exact domain; fake sites cannot steal
- **Backward compatible** — existing password auth preserved throughout migration

## Contributing

Issues and pull requests welcome. The skill is developed test-first — new
behaviour starts as a failing assertion in `evals/evals.json`, not as prose.

```bash
npm run test:evals   # structural validator, keep green in every commit
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the eval workflow, how to run
the full skill-creator benchmark, the rules for editing the trigger
description, and the content conventions.

## License

MIT — see [LICENSE](LICENSE)
