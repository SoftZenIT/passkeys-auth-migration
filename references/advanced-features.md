# Advanced Passkey Features Reference

Load this file on demand — none of these features are required for a standard
migration. They answer requests like "unlock encryption with a passkey", "share
one passkey across our domains", "embed passkey login in an iframe", or "what
happens if users move their passkeys to another password manager".

Sources:
- W3C WebAuthn Level 3 — Candidate Recommendation, 2026-01-13 (w3.org/TR/webauthn-3/)
- web.dev/articles/webauthn-related-origin-requests
- developers.yubico.com/WebAuthn/Concepts/PRF_Extension/
- FIDO Alliance Credential Exchange specifications (fidoalliance.org)

---

## PRF Extension — Passkey-Derived Keys for End-to-End Encryption

The `prf` extension derives a stable 32-byte secret from a passkey during
authentication. Same credential + same salt = same output, every time — usable
as key material for client-side encryption. The server never sees it.

**Support (as of mid-2026):** Chrome/Edge (Chromium), iOS 18+ / macOS 15+
(iCloud Keychain), Windows Hello (since the February 2026 update), Google
Password Manager (default on Android). Availability is **per credential**, not
per browser — a passkey created before the provider supported PRF may never
return PRF output.

### Step 1 — Enable at registration, record the result

```typescript
// Registration options (add to the publicKey options from your server):
extensions: { prf: {} }

// After navigator.credentials.create() resolves:
const ext = credential.getClientExtensionResults();
const prfEnabled = ext.prf?.enabled === true;
// Store prfEnabled on the passkey row server-side — you need it later to know
// which credentials can unlock the vault and which need the fallback path.
```

### Step 2 — Evaluate during authentication

PRF results are only returned during authentication ceremonies
(`navigator.credentials.get()`) — never rely on getting output at create time.

```typescript
// A fixed, app-specific salt. Not secret — but never reuse it across purposes.
const salt = new TextEncoder().encode('myapp-vault-unlock-v1');

const credential = await navigator.credentials.get({
  publicKey: {
    ...optionsFromServer,
    // Unlocking data is a high-assurance action — override the server's
    // default ('preferred') so a biometric/PIN is actually performed.
    userVerification: 'required',
    extensions: { prf: { eval: { first: salt } } },
  },
});

const prf = credential.getClientExtensionResults().prf;
if (!prf?.results?.first) {
  // This credential cannot do PRF — use the fallback unlock path.
  return unlockWithFallback();
}

// Derive an AES key from the PRF output. HKDF, client-side only.
const keyMaterial = await crypto.subtle.importKey(
  'raw', prf.results.first, 'HKDF', false, ['deriveKey'],
);
const aesKey = await crypto.subtle.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('vault-key') },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt'],
);
```

### Architecture: wrap a master key per credential

PRF output differs per credential — two passkeys on the same account derive two
different keys. Never encrypt data directly with a PRF-derived key:

1. Generate one random **master key** that encrypts the actual data.
2. For each PRF-capable passkey, wrap (encrypt) the master key with that
   credential's PRF-derived key. Store the wrapped blobs server-side.
3. On sign-in, unwrap the master key with whichever passkey the user used.
4. Keep a **fallback unlock path** (recovery code, password-derived key) —
   mandatory, because users can lose every PRF-capable credential.

### Rules

- PRF output is client-side key material. **Never send it to the server.**
- Request `userVerification: 'required'` for ceremonies that unlock data.
- Test PRF per credential (`prf.enabled`, then a real evaluation) — never
  assume support from the browser version alone.
- `largeBlob` and `prf` cannot be requested in the same ceremony on some
  platforms — pick one strategy.

---

## largeBlob Extension — Small Data Stored With the Credential

`largeBlob` stores ~1 KB of opaque data with a discoverable credential
(certificates, a wrapped key). In practice it is **iCloud Keychain only**
(iOS 17+); Google Password Manager does not support it. Prefer PRF for
encryption use cases — it has far broader support and doesn't consume the
authenticator's storage.

```typescript
// At registration:
extensions: { largeBlob: { support: 'preferred' } }

// Write during a later authentication:
extensions: { largeBlob: { write: dataArrayBuffer } }

// Read during authentication:
extensions: { largeBlob: { read: true } }
// -> getClientExtensionResults().largeBlob.blob
```

---

## Credential Exchange (CXP / CXF) — Passkey Portability

FIDO Alliance standards for moving credentials **between password managers**
(e.g. iCloud Keychain → 1Password) without plaintext export files:

- **CXF (Credential Exchange Format)** — a JSON format for passkeys, passwords,
  TOTP secrets. Published as a recommended standard.
- **CXP (Credential Exchange Protocol)** — the HPKE-encrypted transfer protocol
  between providers. Apple shipped CXF-based same-device credential transfer in
  iOS/macOS 26; other providers are rolling support out through 2026.

**Nothing to implement server-side** — the exchange happens entirely between
credential managers. Two RP-side consequences:

1. **Messaging:** "what if I switch password managers?" is no longer a reason
   to avoid passkeys. Use the portability reassurance copy in
   `references/messaging-guidelines.md` §Promotion Copy when users or
   stakeholders raise the lock-in objection.
2. **AAGUID staleness:** your stored `aaguid` (and the provider name derived
   from it at registration time) describes the provider **at registration**.
   After a user migrates the passkey to another manager, the credential still
   works (the key pair is unchanged and the credential ID is stable), but your
   "iCloud Keychain" label may now be wrong. There is no signal to the RP when
   this happens. Mitigation: let users rename passkeys (the skill's rename
   pattern) and treat AAGUID names as a best-effort default, never as a
   security property.

---

## Cross-Origin Iframe Embedding

WebAuthn calls inside a cross-origin `<iframe>` are blocked by default and fail
with `NotAllowedError`. **The parent delegates the permission to the frame** —
both steps below are done by the embedding page (WebAuthn Level 3 defines the
Permissions Policy integration). The embedded site sends no header of its own.

Say `https://shop.example` (parent) embeds `https://auth.partner.example`:

```
# 1. Parent's response headers — allowlist names the EMBEDDED origin:
Permissions-Policy: publickey-credentials-get=(self "https://auth.partner.example"),
                    publickey-credentials-create=(self "https://auth.partner.example")
```

```html
<!-- 2. Parent's markup — the iframe tag must also enable the feature: -->
<iframe
  src="https://auth.partner.example/signin"
  allow="publickey-credentials-get; publickey-credentials-create"
></iframe>
```

Rules:
- **Both steps are required** — the header without the `allow` attribute (or
  vice versa) still leaves the ceremony blocked.
- A frame cannot grant itself the permission; only its embedder can.
- `publickey-credentials-get` gates `navigator.credentials.get()`;
  `publickey-credentials-create` gates `create()`. Grant only what the frame needs.
- The ceremony inside the iframe still requires **transient user activation**
  (a real click) — you cannot auto-launch prompts from an embedded context.
- The `rpId` inside the iframe is the **iframe's** origin domain, not the
  embedder's.
- Safari and Firefox support cross-origin `get()` in iframes; `create()` support
  is narrower — test the exact matrix before committing to an embedded
  registration flow.

**Troubleshooting `NotAllowedError` in an iframe:** check (1) the `allow`
attribute on the iframe tag, (2) the **parent's** `Permissions-Policy` response
header and that its allowlist names the *embedded* origin, (3) user activation,
(4) that both documents are HTTPS. All four must pass.

---

## Related Origin Requests — One Passkey Across Multiple Domains

ROR lets one rpID serve several registrable domains (country TLDs, separate
brand domains). Without it, `example.co.uk` and `example-app.com` need separate
passkeys.

**Support:** Chrome/Edge 128+, Safari 18+, **Firefox 152+ (May 2026 — the last
major browser gap, now closed)**.

### The file

Serve this at the **rpID domain root** with `Content-Type: application/json`:

```
GET https://example.co.uk/.well-known/webauthn
```

```json
{
  "origins": [
    "https://example.co.uk",
    "https://example-app.com"
  ]
}
```

### The client change

On the *other* origins, pass the shared rpID explicitly — the browser fetches
the well-known file to authorize it:

```typescript
// Running on https://example-app.com — uses the example.co.uk passkey:
navigator.credentials.get({
  publicKey: { ...options, rpId: 'example.co.uk' },
});
```

The backend keeps `RP_ID=example.co.uk` and adds every related origin to
`APP_ORIGINS` (the expected-origins list in verification).

### Rules and limits

- Browsers process at most **5 distinct eTLD+1 labels** in the `origins` list
  (`example.co.uk`, `example.de`, `example-app.com` = labels `example`,
  `example`, `example-app` = 2 labels). Plan domain consolidation before you
  hit the cap.
- The well-known file must be reachable unauthenticated, without redirects to
  another host.
- Don't confuse it with `/.well-known/passkey-endpoints` (Google Password
  Manager enroll/manage discovery) — see the SKILL.md gotcha. Both can coexist
  at the same domain root.
- Only add ROR for a genuine multi-domain deployment; a single-domain app
  doesn't need the file.
