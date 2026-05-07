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

Or manually — copy the `passkeys-auth-migration/` folder to your skills directory:

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
- "Migrate to passwordless authentication"
- "Implement WebAuthn / FIDO2"
- "Replace password login with passkeys"
- "Add biometric login"
- "How do I support passkeys in [framework]?"

## Compatible agents

Claude Code · GitHub Copilot · Cursor · Gemini CLI · OpenAI Codex

## What you get

For each project, the skill produces:

- A written migration plan (backend + frontend) presented before any implementation
- Database migration (additive — never removes existing auth)
- Registration endpoints (`/auth/passkey/register/challenge` + `/verify`)
- Authentication endpoints (`/auth/passkey/authenticate/challenge` + `/verify`)
- Passkeys management endpoints (list + delete)
- Frontend components: conditional UI sign-in, account settings with passkey
  cards, hero prompt, cross-device interstitial
- Security review
- Rollout guidance (FIDO Gradual or Rapid strategy)

## Sources and standards

Built on:

- [FIDO Alliance Passkey Central](https://passkeycentral.org) — design guidelines, UX principles, rollout guides, phishing prevention journey
- [passkeys.dev](https://passkeys.dev) — library selection, bootstrapping patterns, conditional UI
- [Google Identity Passkeys Guide](https://developers.google.com/identity/passkeys) — server-side registration and authentication patterns, DB schema
- [W3C WebAuthn Specification](https://w3c.github.io/webauthn/) — cryptographic correctness, rpId, challenge, counter validation

## Security model

- **Public keys only** stored server-side — private keys never leave the device
- **Biometric data never transmitted** — device-local verification only
- **Challenge hygiene** — random, single-use, server-generated, deleted on both success and failure
- **Counter tracking** — replay attack prevention on every authentication
- **Phishing-resistant** — rpId bound to exact domain; fake sites cannot steal
- **Backward compatible** — existing password auth preserved throughout migration

## Contributing

Issues and pull requests welcome at the GitHub repository. When contributing:

1. Run the eval suite: `npm run test:evals`
2. Verify new stack support against `references/library-matrix.md`
3. For new frameworks, add schema to `references/db-schema.md`
4. Update the supported stacks table in this README

The local eval runner validates `evals/evals.json`, trigger routing, reference
coverage, and representative fixture scenarios under `evals/fixtures/`.

## License

MIT — see [LICENSE](LICENSE)
