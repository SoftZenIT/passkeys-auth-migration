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

| Library                       | Package                                              | Best for                          | Notes                                                                                |
| ----------------------------- | ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| **SimpleWebAuthn**            | `@simplewebauthn/server` + `@simplewebauthn/browser` | NestJS, Express, Fastify, Next.js | Top recommendation. Full-stack TS. Tightly integrated client+server. Excellent docs. |
| **@passwordless-id/webauthn** | `@passwordless-id/webauthn`                          | Lightweight Node.js setups        | Dependency-free, minimalistic, opinionated. Good for Cloudflare Workers.             |

**For NestJS specifically:** Use SimpleWebAuthn server-side + `@simplewebauthn/browser` client-side.

### Python (Backend)

| Library         | Package                | Best for               |
| --------------- | ---------------------- | ---------------------- |
| **py_webauthn** | `pip install webauthn` | Django, FastAPI, Flask |

Maintained by Duo Labs. Supports full registration + authentication verification.

### Java (Backend)

| Library                  | Artifact                          | Best for                  |
| ------------------------ | --------------------------------- | ------------------------- |
| **java-webauthn-server** | `com.yubico:webauthn-server-core` | Spring Boot, Jakarta EE   |
| **WebAuthn4J**           | `com.webauthn4j:webauthn4j-core`  | Spring Boot (alternative) |

Yubico's library is the most widely used and battle-tested for Spring Boot.

### PHP (Backend)

| Library                   | Package                                  | Best for         |
| ------------------------- | ---------------------------------------- | ---------------- |
| **web-auth/webauthn-lib** | `composer require web-auth/webauthn-lib` | Laravel, Symfony |

Most complete PHP WebAuthn library. Laravel-specific wrappers exist.

### Ruby (Backend)

| Library             | Gem                     | Best for       |
| ------------------- | ----------------------- | -------------- |
| **webauthn-ruby**   | `gem 'webauthn'`        | Rails (base)   |
| **devise-passkeys** | `gem 'devise-passkeys'` | Rails + Devise |
| **warden-webauthn** | `gem 'warden-webauthn'` | Rails + Warden |

If using Devise: use `devise-passkeys` directly (wraps `webauthn-ruby`).

### Go (Backend)

| Library                  | Import                            | Best for                          |
| ------------------------ | --------------------------------- | --------------------------------- |
| **go-webauthn/webauthn** | `github.com/go-webauthn/webauthn` | Gin, Echo, Chi, standard net/http |

Fork of Duo Labs' original Go library. Most actively maintained.

### .NET (Backend)

| Library                | Package        | Best for                                |
| ---------------------- | -------------- | --------------------------------------- |
| **FIDO2 .NET Library** | `Fido2NetLib`  | ASP.NET Core                            |
| **WebAuthn.Net**       | `WebAuthn.Net` | ASP.NET Core (alternative, Dodo Brands) |

### Rust (Backend)

| Library         | Crate         | Best for        |
| --------------- | ------------- | --------------- |
| **webauthn-rs** | `webauthn-rs` | Actix-web, Axum |

### Elixir (Backend)

| Library | Package            | Best for |
| ------- | ------------------ | -------- |
| **wax** | `{:wax, "~> 0.6"}` | Phoenix  |

Elixir's `wax` library handles both registration and authentication verification for WebAuthn.

---

## Frontend Libraries

### Any framework (JS/TS)

| Library                                | Package | Notes                                                  |
| -------------------------------------- | ------- | ------------------------------------------------------ |
| **@simplewebauthn/browser**            | npm     | Pairs with SimpleWebAuthn server. Recommended.         |
| **@passwordless-id/webauthn** (client) | npm     | Use `import {client} from '@passwordless-id/webauthn'` |

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

| Backend Stack        | Recommended Server Lib   | Frontend Lib              |
| -------------------- | ------------------------ | ------------------------- |
| NestJS + Prisma      | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Express + Mongoose   | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Fastify + TypeORM    | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Next.js (API routes) | `@simplewebauthn/server` | `@simplewebauthn/browser` |
| Django + Django ORM  | `py_webauthn`            | `@simplewebauthn/browser` |
| FastAPI + SQLAlchemy | `py_webauthn`            | `@simplewebauthn/browser` |
| Spring Boot + JPA    | `java-webauthn-server`   | `@simplewebauthn/browser` |
| Laravel + Eloquent   | `web-auth/webauthn-lib`  | `@simplewebauthn/browser` |
| Rails + Devise       | `devise-passkeys`        | `@simplewebauthn/browser` |
| Go + Gin             | `go-webauthn/webauthn`   | `@simplewebauthn/browser` |
| ASP.NET Core         | `Fido2NetLib`            | `@simplewebauthn/browser` |
| Rust + Actix         | `webauthn-rs`            | `@simplewebauthn/browser` |
| Elixir + Phoenix     | `wax`                    | `@simplewebauthn/browser` |

---

## Version Notes

| Library                                              | Minimum version | Runtime requirement  | Breaking change from                                                                                                                                                                                |
| ---------------------------------------------------- | --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@simplewebauthn/server` + `@simplewebauthn/browser` | **v13** (latest v13.3.x) | Node 20+, ES modules | v9 to v10: `startRegistration({ optionsJSON })` · v10 to v11: `verifyAuthenticationResponse` uses `credential: { id, publicKey }` instead of `authenticator: { credentialID, credentialPublicKey }` · v11 to v13: `@simplewebauthn/types` retired (types now ship inside server/browser), `AuthenticatorDevice` renamed `WebAuthnCredential`; v13 adds `preferredAuthenticatorType` (WebAuthn hints), `useAutoRegister` (conditional create), and `verifyMDSBlob()` for FIDO MDS / AAGUID naming |
| `@passwordless-id/webauthn`                          | **v2**          | Node 19+             | v1 to v2: full API redesign                                                                                                                                                                         |
| `py_webauthn`                                        | **v2**          | Python 3.9+          | v1 to v2: class-based API replaced with functions                                                                                                                                                   |
| `java-webauthn-server`                               | **v2**          | Java 17+             | v1 to v2: credential storage API changed                                                                                                                                                            |
| `go-webauthn/webauthn`                               | **v0.10**       | Go 1.21+             | v0.9 to v0.10: `FinishDiscoverableLogin` signature changed                                                                                                                                          |
| `web-auth/webauthn-lib`                              | **v4**          | PHP 8.1+             | v3 to v4: PSR-20 clock interface required                                                                                                                                                           |

> ⚠️ **Always pin a minimum version when installing.** The reference code in this
> skill uses the minimum versions listed above. Installing an older version will
> cause silent or confusing failures — for example, a project using SimpleWebAuthn
> v10 will break on `verifyAuthenticationResponse` because the `credential` argument
> did not exist until v11; v10 expects `authenticator` with different property names.
> Likewise, v11 lacks `useAutoRegister` and `preferredAuthenticatorType`, so the
> conditional-create and hints patterns in this skill require v13.

All minimum versions align with **WebAuthn Level 3** (W3C Candidate
Recommendation, 2026-01-13) — the umbrella spec for conditional create, the
Signal API, hints, Related Origin Requests, and JSON serialization helpers.
