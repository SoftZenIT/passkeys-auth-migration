# Library Matrix — Passkey / WebAuthn Libraries by Stack

## Selection Criteria (from passkeys.dev)

When choosing a library, check:
- WebAuthn Level 2 or Level 3 support
- Handles both registration AND authentication verification server-side
- Actively maintained (community activity, recent issues)
- Good developer docs
- MIT or Apache license (preferred for commercial projects)

---

## Recommended Libraries by Language / Framework

### TypeScript / Node.js (Backend)

| Library | Package | Best for | Notes |
|---------|---------|---------|-------|
| **SimpleWebAuthn** | `@simplewebauthn/server` + `@simplewebauthn/browser` | NestJS, Express, Fastify, Next.js | ⭐ Top recommendation. Full-stack TS. Tightly integrated client+server. Excellent docs. |
| **@passwordless-id/webauthn** | `@passwordless-id/webauthn` | Lightweight Node.js setups | Dependency-free, minimalistic, opinionated. Good for Cloudflare Workers. |

**For NestJS specifically:** Use SimpleWebAuthn server-side + `@simplewebauthn/browser` client-side.

### Python (Backend)

| Library | Package | Best for |
|---------|---------|---------|
| **py_webauthn** | `pip install webauthn` | Django, FastAPI, Flask |

Maintained by Duo Labs. Supports full registration + authentication verification.

### Java (Backend)

| Library | Artifact | Best for |
|---------|---------|---------|
| **java-webauthn-server** | `com.yubico:webauthn-server-core` | Spring Boot, Jakarta EE |
| **WebAuthn4J** | `com.webauthn4j:webauthn4j-core` | Spring Boot (alternative) |

Yubico's library is the most widely used and battle-tested for Spring Boot.

### PHP (Backend)

| Library | Package | Best for |
|---------|---------|---------|
| **web-auth/webauthn-lib** | `composer require web-auth/webauthn-lib` | Laravel, Symfony |

Most complete PHP WebAuthn library. Laravel-specific wrappers exist.

### Ruby (Backend)

| Library | Gem | Best for |
|---------|---------|---------|
| **webauthn-ruby** | `gem 'webauthn'` | Rails (base) |
| **devise-passkeys** | `gem 'devise-passkeys'` | Rails + Devise |
| **warden-webauthn** | `gem 'warden-webauthn'` | Rails + Warden |

If using Devise: use `devise-passkeys` directly (wraps `webauthn-ruby`).

### Go (Backend)

| Library | Import | Best for |
|---------|---------|---------|
| **go-webauthn/webauthn** | `github.com/go-webauthn/webauthn` | Gin, Echo, Chi, standard net/http |

Fork of Duo Labs' original Go library. Most actively maintained.

### .NET (Backend)

| Library | Package | Best for |
|---------|---------|---------|
| **FIDO2 .NET Library** | `Fido2NetLib` | ASP.NET Core |
| **WebAuthn.Net** | `WebAuthn.Net` | ASP.NET Core (alternative, Dodo Brands) |

### Rust (Backend)

| Library | Crate | Best for |
|---------|---------|---------|
| **webauthn-rs** | `webauthn-rs` | Actix-web, Axum |

### Elixir (Backend)

| Library | Package | Best for |
|---------|---------|---------|
| **wax** | `{:wax, "~> 0.6"}` | Phoenix |

Elixir's `wax` library handles both registration and authentication verification for WebAuthn.

---

## Frontend Libraries

### Any framework (JS/TS)

| Library | Package | Notes |
|---------|---------|-------|
| **@simplewebauthn/browser** | npm | Pairs with SimpleWebAuthn server. Recommended. |
| **@passwordless-id/webauthn** (client) | npm | Use `import {client} from '@passwordless-id/webauthn'` |

### Framework-specific wrappers (community)

- **Vue 3**: No official wrapper — use `@simplewebauthn/browser` directly in composables
- **React**: No official wrapper — use `@simplewebauthn/browser` in hooks
- **Angular**: No official wrapper — use in services
- **Svelte/SvelteKit**: No official wrapper — use `@simplewebauthn/browser` in stores or load functions
- **Nuxt 3**: Use `@simplewebauthn/browser` in client-only plugins or composables
- **Next.js**: Use `@simplewebauthn/browser` in client components (dynamic import with `ssr: false`)

### Native mobile

- **iOS/Swift**: `ASAuthorizationPlatformPublicKeyCredentialProvider` (Apple AuthenticationServices)
- **Android**: Credential Manager API (`androidx.credentials`)

---

## Stack-to-Library Quick Reference

| Backend Stack | Recommended Server Lib | Frontend Lib |
|---|---|---|
| NestJS + Prisma | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Express + Mongoose | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Fastify + TypeORM | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Next.js (API routes) | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Django + Django ORM | `py_webauthn` | `@simplewebauthn/browser` |
| FastAPI + SQLAlchemy | `py_webauthn` | `@simplewebauthn/browser` |
| Spring Boot + JPA | `java-webauthn-server` | `@simplewebauthn/browser` |
| Laravel + Eloquent | `web-auth/webauthn-lib` | `@simplewebauthn/browser` |
| Rails + Devise | `devise-passkeys` | `@simplewebauthn/browser` |
| Go + Gin | `go-webauthn/webauthn` | `@simplewebauthn/browser` |
| ASP.NET Core | `Fido2NetLib` | `@simplewebauthn/browser` |
| Rust + Actix | `webauthn-rs` | `@simplewebauthn/browser` |
| Elixir + Phoenix | `wax` | `@simplewebauthn/browser` |

---

## Version Notes (as of 2025)

- SimpleWebAuthn: v10+ — requires Node 20+, ES modules
- @passwordless-id/webauthn: v2+ — requires Node 19+, breaking changes from v1
- py_webauthn: v2+ — full Python 3.8+ support
- java-webauthn-server: v2+ — Java 17+
