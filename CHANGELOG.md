# Changelog

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
