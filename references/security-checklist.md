# Security Checklist

Sources: FIDO Alliance, W3C WebAuthn spec, OWASP, passkeys.dev, Google Identity Passkeys guide

Apply during Phase 3 (implementation) and review before Phase 4 (rollout).

---

## A. Challenge Management

- [ ] Challenge is **cryptographically random** — minimum 16 bytes (SimpleWebAuthn uses 32 bytes by default)
- [ ] Challenge is **server-generated** — never from the client, never from a user-controlled value
- [ ] Challenge is **single-use** — deleted immediately after verification (success OR failure)
- [ ] Challenge has a **TTL of 5 minutes max** (stored in Redis, session, or DB with expiry)
- [ ] Challenge is **bound to a session or user ID** — cannot be replayed by a different user
- [ ] Challenge is stored **server-side only** — never in cookie, localStorage, URL param, or form field

```typescript
// Correct: use library's challenge generator (32 random bytes)
import { generateRegistrationOptions } from '@simplewebauthn/server';
// challenge is auto-generated and included in options — don't generate manually

// Correct: delete after use, in both success and catch blocks
try {
  const result = await verifyRegistrationResponse({ response, expectedChallenge, ... });
  await redis.del(`challenge:${sessionId}`);  // delete on success
  return result;
} catch (err) {
  await redis.del(`challenge:${sessionId}`);  // CRITICAL: also delete on failure
  throw err;
}
```

---

## B. Relying Party (RP) Configuration

- [ ] `rpID` is the **effective domain only** — no port, no protocol, no path, no subdomain unless intended
  - ✅ `example.com` — works for all subdomains
  - ✅ `app.example.com` — works for this subdomain only
  - ❌ `https://example.com` — will always fail
  - ❌ `example.com:3000` — will always fail
  - ❌ `example.com/api` — will always fail
- [ ] `rpID` is set via **environment variable** — not hardcoded (`localhost` for dev, real domain for prod)
- [ ] `expectedOrigins` includes ALL legitimate origins (main site, staging, localhost for dev only)
- [ ] `expectedOrigins` does **not** use wildcards — exact match only
- [ ] In production, `origin` always starts with `https://`

```env
# Development
RP_ID=localhost
APP_ORIGIN=http://localhost:3000

# Production
RP_ID=example.com
APP_ORIGIN=https://example.com
```

---

## C. Registration Verification Checklist

Server must verify these (your library handles it — verify it's configured correctly):

- [ ] `challenge` matches stored challenge
- [ ] `origin` matches expected origin
- [ ] `rpIdHash` = SHA-256 of your rpID
- [ ] If `requireUserVerification: true`: verify `uv` flag is `true` in authenticatorData
- [ ] `credentialId` is not already registered for any user (prevent duplicate registration)
- [ ] Algorithm used (`alg`) is in your allowed list (libraries default to ES256 + RS256 — sufficient)
- [ ] Store only the **public key** — never store or log raw registration response

```typescript
// pubKeyCredParams: always include both ECDSA P-256 and RSA PKCS#1
// (libraries set this automatically — covers all platforms)
// ES256 = -7 (ECDSA with P-256) -- preferred, used by Apple/Google
// RS256 = -257 (RSA PKCS#1) -- needed for Windows Hello and some YubiKeys
```

---

## D. Authentication Verification Checklist

- [ ] `challenge` matches stored challenge
- [ ] `origin` and `rpIdHash` verified
- [ ] **Signature** verified against stored public key (library handles this — never skip)
- [ ] **Counter verified and updated** (critical for replay attack prevention):

```typescript
// Counter rules (per W3C WebAuthn spec):
// - If storedCounter > 0 AND newCounter <= storedCounter: REJECT (possible cloned authenticator)
// - If storedCounter == 0 AND newCounter == 0: OK (synced passkeys often always return 0)
// - Otherwise: update stored counter to newCounter

// SimpleWebAuthn handles this automatically in verifyAuthenticationResponse
// but you must pass the correct stored counter value

const verification = await verifyAuthenticationResponse({
  ...
  credential: {
    id: passkey.credentialId,
    publicKey: passkey.publicKey,
    counter: Number(passkey.counter),   // -- must be the STORED counter, not 0
    transports: passkey.transports,
  },
});
// Then update: passkey.counter = verification.authenticationInfo.newCounter
```

- [ ] Challenge deleted after use (success AND failure — prevents replay)
- [ ] User identified via `response.userHandle` (discoverable) or credential ID lookup

---

## E. User Lookup for Discoverable Credentials

During authentication, the authenticator sends `userHandle` (= your `user.id` / `passkeyUserId`). Use it:

```typescript
// Option A: Lookup by credential ID (more reliable)
const passkey = await prisma.passkey.findUnique({
  where: { credentialId: Buffer.from(body.rawId, 'base64url') },
  include: { user: true },
});

// Option B: Lookup by userHandle (if credential ID lookup fails)
const userHandle = body.response.userHandle;
if (userHandle) {
  const user = await prisma.user.findFirst({
    where: { passkeyUserId: Buffer.from(userHandle, 'base64url').toString() },
  });
}

// Never trust userHandle alone without verifying the signature matches the stored public key
```

---

## F. Credential Storage Security

- [ ] `credentialId` stored as `BYTEA`/`BLOB` — not as plain string
- [ ] `publicKey` stored as raw COSE bytes — not decoded/re-encoded unless required
- [ ] `passkeyUserId` is PII-free (no email, no username, no personal data)
- [ ] `ON DELETE CASCADE` on user FK — passkeys auto-deleted when user is deleted
- [ ] Users can only read/delete their **own** passkeys — always filter by `userId` server-side
- [ ] AAGUID stored for provider identification (display name in UI)
- [ ] `backed_up` flag stored (useful for future password deprecation eligibility)

### F.2 — AAGUID -> Provider Name Mapping

AAGUID is a UUID that identifies the passkey provider. Use it to display
meaningful labels like "iCloud Keychain" or "Google Password Manager" in
Account Settings passkey cards.

**Option A — FIDO Metadata Service (authoritative, live)**
Fetch from the FIDO Alliance MDS at app startup and cache. The endpoint
returns a JWS (JSON Web Signature) — the payload is the base64url-encoded
second segment and contains the full AAGUID-to-description mapping:

```typescript
// aaguid-mds.ts — call once at startup, cache result in module scope
let mdsCache: Record<string, string> | null = null;

export async function loadMdsNames(): Promise<Record<string, string>> {
  if (mdsCache) return mdsCache;
  const res = await fetch('https://mds3.fidoalliance.org/');
  const jwt = await res.text();
  // MDS is a JWS: header.payload.signature — only payload needed for names
  const payload = jwt.split('.')[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  const map: Record<string, string> = {};
  for (const entry of decoded.entries ?? []) {
    if (entry.aaguid && entry.metadataStatement?.description) {
      map[entry.aaguid.toLowerCase()] = entry.metadataStatement.description;
    }
  }
  mdsCache = map;
  return map;
}

export async function getProviderNameFromMds(aaguid: string): Promise<string> {
  const names = await loadMdsNames();
  return names[aaguid.toLowerCase()] ?? 'Passkey';
}
```

> This skips signature verification of the MDS JWT, which is acceptable for
> display-name enrichment. For regulated environments that require verified
> attestation metadata, implement full JWS signature verification against
> the FIDO Alliance root certificate before trusting any MDS entry.

> Cache `mdsCache` with a 24-hour TTL in production — the MDS updates
> weekly but re-fetching on every request adds ~200ms latency to registration.

**Option B — Common AAGUID lookup table (covers 90% of users)**
```typescript
const AAGUID_NAMES: Record<string, string> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  'b93fd961-f2e6-462f-b122-82002247de78': 'Android Fingerprint',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  'fbefdf68-fe86-0106-213e-4d5fa24cbe2e': 'Dashlane',
  '50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
  // 1Password uses multiple AAGUIDs across versions and platforms.
  // Do NOT use a string key like '1password' — it will never match.
  // Use the FIDO MDS for a complete, up-to-date list (see Option A above).
  // Common 1Password AAGUIDs (may vary by version):
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'a4e9fc6d-4cbe-4758-b8ba-37598bb5bbaa': '1Password',
  // Full community list: https://github.com/nicholasess/passkey-providers
};

function getProviderName(aaguid: string): string {
  return AAGUID_NAMES[aaguid.toLowerCase()] ?? 'Passkey';
}
```

**Fallback label:** Always default to `"Passkey"` if AAGUID is unknown —
never show the raw UUID to users.

**Important:** Store AAGUID in the DB even if you don't use it now. Provider
databases improve over time and you can retroactively enrich labels.

**Keeping the AAGUID map current:**
The hardcoded table above covers common providers but will drift as new
providers appear and existing ones change AAGUIDs across versions.

- **Quarterly review**: compare your table against the community list at
  `https://github.com/nicholasess/passkey-providers` and the FIDO MDS (Option A).
- **Recommended alternative**: pull names from FIDO MDS at app startup (Option A)
  rather than shipping a hardcoded map — avoids stale data entirely and requires
  no code changes when new providers are added.
- **Backfilling existing records**: after updating the map, re-derive `name` from
  the stored `aaguid` for rows where the name is stale or was never resolved:
  ```sql
  -- Run once after updating your AAGUID map
  UPDATE passkeys SET name = NULL WHERE name = 'Passkey' AND aaguid IS NOT NULL;
  -- Then your app code will re-resolve names on next read, or run a migration script
  ```

---

## G. API Endpoint Security

| Endpoint | Access | Notes |
|---|---|---|
| `POST /auth/passkey/register/challenge` | Auth required | User must be logged in |
| `POST /auth/passkey/register/verify` | Auth required | Validates and stores credential |
| `POST /auth/passkey/authenticate/challenge` | Public | No auth required (user not yet identified) |
| `POST /auth/passkey/authenticate/verify` | Public | Issues token on success |
| `GET /auth/passkey/list` | Auth required | Filter by userId always |
| `DELETE /auth/passkey/:id` | Auth required | Verify ownership before delete |
| `PATCH /auth/passkey/:id` | Auth required | Verify ownership before update; validate name |

- [ ] Rate limiting on **all** passkey endpoints (especially challenge generation — prevent DDoS)
- [ ] CSRF protection on state-changing endpoints (register, delete, rename) — **required for session-cookie auth only**; Bearer-token (JWT) APIs are not vulnerable to CSRF because browsers do not auto-attach Authorization headers
- [ ] Validate `Content-Type: application/json` on all passkey routes

### G.2 — Passkey Rename Endpoint Security

```typescript
// PATCH /auth/passkey/:id — ownership check is mandatory
async renamePasskey(userId: string, passkeyId: string, name: string) {
  // 1. Validate name before touching the DB
  const trimmed = name?.trim();
  if (!trimmed || trimmed.length === 0) {
    throw new BadRequestException('Passkey name cannot be empty');
  }
  if (trimmed.length > 100) {
    throw new BadRequestException('Passkey name must be 100 characters or fewer');
  }

  // 2. Filter by BOTH id AND userId — prevents horizontal privilege escalation.
  //    An attacker who knows another user's passkey UUID cannot rename it.
  const passkey = await db.passkey.findFirst({
    where: { id: passkeyId, userId },
  });
  if (!passkey) {
    throw new NotFoundException('Passkey not found');  // same error for not-found and not-owned
  }

  // 3. Update
  return db.passkey.update({
    where: { id: passkeyId },
    data: { name: trimmed },
  });
}
```

- [ ] `PATCH /auth/passkey/:id` filters by **both** `id` AND `userId` before updating
- [ ] Name validated server-side: non-empty after trim, max 100 chars
- [ ] Returns generic 404 (not 403) when passkey not found or not owned — avoids leaking ID existence
- [ ] Rename endpoint is rate-limited at the same level as list/delete
- [ ] ORM parameterization handles SQL injection for the name field — do not interpolate directly into raw SQL

---

## H. `requireUserVerification` Guidance

```typescript
// requireUserVerification: false (recommended for most consumer apps)
// - Accepts biometric OR PIN OR pattern
// - Better UX: works on desktops without biometric sensors
// - Passkey.dev recommends "preferred" — library will request UV but not require it

// requireUserVerification: true (high-security / regulated use cases)
// - Requires biometric or PIN — PIN-only still qualifies
// - On desktops without biometrics: user must enter system password each time
// - Can cause frustration if overused

// userVerification: "preferred" is the correct setting for most apps
// The "uv" flag in authenticatorData shows what actually happened
```

---

## I. Infrastructure / Deployment

- [ ] **HTTPS required in production** — WebAuthn will NOT work on HTTP (browser exception for localhost only)
- [ ] Separate env vars per environment: `localhost`, `staging.example.com`, `example.com`
- [ ] Challenge store (Redis) is NOT publicly accessible
- [ ] Passkey table has appropriate DB-level access controls (not accessible by other services)
- [ ] Audit log: passkey created, deleted, and authentication events (userId + timestamp + IP — no credential data)
- [ ] FIDO server library kept up to date (WebAuthn spec evolves)

---

## J. Account Recovery Security

- [ ] Password login remains active during migration phase
- [ ] "Forgot password" flow still works for users without passkeys
- [ ] If user deletes ALL passkeys, they can still sign in via password
- [ ] After account recovery, prompt user to re-create a passkey
- [ ] Inform users: "If you lose your device, you can still sign in with your password"
- [ ] Account recovery methods must be evaluated for phishing resistance (see rollout-guide.md Part 2)

---

## K. Synced vs Device-Bound Passkeys

| | `backedUp: true` | `backedUp: false` |
|---|---|---|
| Storage | iCloud, Google PM, 1Password… | This device only |
| Survives device loss | ✅ Yes | ❌ No |
| Security level | High (consumer) | Highest (hardware-bound) |
| Use case | General consumer apps | High-security / regulated |

For high-security apps, you can optionally restrict to `backedUp: false` for step-up auth:
```typescript
// After registration verification:
if (requireDeviceBound && registrationInfo.credentialDeviceType !== 'singleDevice') {
  throw new Error('Only device-bound passkeys are accepted for this action');
}
```

---

## L. OWASP Coverage

| OWASP Top 10 | How passkeys address it |
|---|---|
| A07: Identification and Authentication Failures | Phishing-resistant, no credential stuffing possible |
| A02: Cryptographic Failures | Public-key crypto; private key never leaves device |
| A01: Broken Access Control | Always filter credentials by userId server-side |
| A09: Security Logging | Log passkey lifecycle — no sensitive data in logs |
| A03: Injection | credentialId stored as bytes; no SQL string interpolation |
| A04: Insecure Design | Server never stores secrets; only public keys |

---

## L2. WebAuthn Signal API (Credential Hygiene)

Keep passkey providers in sync with your server's credential state:

```typescript
// rpId must come from your env var — never hardcode it here.
// Using the wrong rpId causes every cleanup call to silently fail.
const rpId = process.env.RP_ID!;

// After 404 (credential not found during authentication):
if (response.status === 404 && PublicKeyCredential.signalUnknownCredential) {
  await PublicKeyCredential.signalUnknownCredential({
    rpId,
    credentialId: body.id,  // base64url credential ID from the request
  });
  // Provider will clean up the orphaned passkey
}

// After successful registration, signal current credential set:
if (PublicKeyCredential.signalAllAcceptedCredentials) {
  const allCredentials = await getCredentialsForUser(userId);
  // userId must be base64url-encoded to match the userHandle the authenticator stored.
  // If passkeyUserId is stored as a UTF-8 string in your DB, encode it here:
  const userIdBase64url = btoa(user.passkeyUserId)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  await PublicKeyCredential.signalAllAcceptedCredentials({
    rpId,
    userId: userIdBase64url,
    allAcceptedCredentialIds: allCredentials.map(c => c.credentialId),
  });
}

// After the user changes their username or display name on your server,
// sync the provider's copy on their next visit (browser-side, RP origin):
if (PublicKeyCredential.signalCurrentUserDetails) {
  try {
    // Fire-and-forget: Safari 26 has a known WebKit bug (#298951) where this
    // promise may never resolve — never await-block UI or sign-in flow on it.
    void PublicKeyCredential.signalCurrentUserDetails({
      rpId,
      userId: userIdBase64url,        // same base64url encoding as above
      name: user.username,            // what the passkey picker lists
      displayName: user.displayName,
    });
  } catch { /* hygiene call — non-critical, never surface to the user */ }
}
```

Support: `signalUnknownCredential` / `signalAllAcceptedCredentials` /
`signalCurrentUserDetails` — Chrome 132+, Safari 26+ (see WebKit caveat above);
feature-detect and skip silently elsewhere.

**Do not confuse the two rename concepts:** the passkey *nickname* users edit
via your `PATCH /auth/passkey/:id` endpoint (§G.2) lives in **your** database
only. The `name`/`displayName` shown inside the **passkey picker** comes from
the credential manager and can only be updated with `signalCurrentUserDetails`
after a server-side username/displayName change.

Why this matters: Without signal API calls, deleted server-side credentials
remain in the user's password manager and cause confusing failed sign-in
attempts, and renamed accounts keep stale usernames in the picker. The Signal
API lets you proactively keep provider state in sync.

---

## L3. User Verification (UV) Flag — High-Security Warning

The `uv` flag in authenticatorData indicates the authenticator performed
user verification (biometric or PIN). However, several extension-based
providers set this flag incorrectly:

- 1Password Extension -> sets UV=true without verifying
- Bitwarden Extension -> sets UV=true without verifying
- KeePassXC -> sets UV=true without verifying
- Proton Pass Extension -> sets UV=true without verifying
- Okta Personal Extension -> sets UV=true without verifying

**For most consumer apps:** This is acceptable. Use `userVerification: 'preferred'`
and don't rely on the UV flag for security decisions.

**For high-security apps (payments, admin, step-up auth):**
Do not use `requireUserVerification: true` alone as a security enforcement.
Supplement with AAGUID-based attestation or additional session signals.

---

## M. Security Anti-Patterns (Never Do These)

| Anti-pattern | Risk |
|---|---|
| Storing challenges in DB without TTL | Accumulates forever; old challenges replayable |
| Accepting counter=0 when stored counter > 0 | Allows replay attacks with cloned authenticators |
| Trusting `userHandle` from client without DB lookup | User impersonation |
| `requireUserVerification: false` for sensitive actions | Weaker auth for critical operations |
| No rate limiting on challenge endpoints | DDoS / challenge flooding |
| Not deleting challenge on failed verification | Allows retry attacks with the same challenge |
| Logging raw credential responses | Exposes credential IDs and potential attack surface |
| Using `rpID` as the full URL | Breaks WebAuthn for all users |
| Allowing unlimited passkeys per user (no cap) | Potential DoS via storage exhaustion — enforce a per-user cap (recommended: 10–25) by checking count before `generateRegistrationOptions` and returning HTTP 400 if exceeded |
