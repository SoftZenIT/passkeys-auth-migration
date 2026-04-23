# Troubleshooting Reference

Sources:
- Passkey Central Troubleshooting (passkeycentral.org/troubleshooting)
- Passkey Central Messaging Guidelines (passkeycentral.org/resources-and-tools/messaging-guidelines-for-passkey-failure-states)
- passkeys.dev/docs/reference/known-issues
- Google Identity Passkeys Guide
- W3C WebAuthn specification

---

## Six entities interact in every passkey flow

Unexpected failures almost always come from a mismatch between:
1. **Relying Party (your app)** — rpID, origin, challenge
2. **Operating System** — iOS, Android, Windows, macOS, ChromeOS
3. **Browser** — Chrome, Safari, Firefox, Edge
4. **Credential manager** — iCloud Keychain, Google Password Manager, 1Password, Bitwarden
5. **Hardware** — biometric sensor, security key, NFC/Bluetooth
6. **End user** — understanding, consent, device state

When diagnosing a failure, walk through these six in order.

---

## Problem 1: rpID Mismatch (most common silent failure)

**Symptom:** The WebAuthn ceremony appears to complete (no JS error), but the
server rejects the response with `"Invalid rpId hash"` or similar. Or:
`navigator.credentials.create()` or `.get()` throws `SecurityError`.

**Cause:** Your `rpID` does not match the page's origin domain.

**Rules:**
- `rpID` must be an *effective domain* — no protocol, no port, no path
- It must be a registrable domain suffix of the page origin
- `https://app.example.com` can use `rpID = "app.example.com"` OR `rpID = "example.com"`
- `https://app.example.com` CANNOT use `rpID = "other.example.com"` or `rpID = "example.com:3000"`

**Common wrong values and symptoms:**

| Wrong rpID | Error |
|---|---|
| `https://example.com` | `SecurityError` on `.create()` / `.get()` |
| `example.com:3000` | `SecurityError` on `.create()` / `.get()` |
| `example.com/api` | `SecurityError` on `.create()` / `.get()` |
| `staging.example.com` used in prod | `InvalidStateError` or server reject |
| `localhost` in staging | Server rejects: rpIdHash mismatch |

**Fix:** Set `rpID` to the bare domain only, via environment variable:
```
# Dev
RP_ID=localhost

# Staging
RP_ID=staging.example.com

# Prod
RP_ID=example.com
```

---

## Problem 2: Conditional UI (passkey autofill) not appearing

**Symptom:** Passkeys were registered but never appear in the browser's autofill
dropdown when the user clicks/focuses on the username field.

**Checklist — all of these must be true:**

- [ ] Input has `autocomplete="username webauthn"` (not `autocomplete="email webauthn"`)
- [ ] The page is served over HTTPS (or `localhost`)
- [ ] `startAuthentication({ useBrowserAutofill: true })` is called on page load, not on button click
- [ ] The `mediation: 'conditional'` flag is set in `navigator.credentials.get()`
- [ ] `allowCredentials: []` (empty array) — non-empty blocks discoverable credentials
- [ ] An `AbortController` signal is passed and NOT already aborted when the call is made
- [ ] The browser supports conditional mediation (check table below)
- [ ] Passkeys were created with `residentKey: 'preferred'` or `'required'`

**Browser support for Conditional UI:**

| Browser | Minimum version | Notes |
|---|---|---|
| Chrome | 108 | Full support including Android |
| Edge | 108 | Full support |
| Safari | 16 (iOS/macOS) | Requires iOS 16 / macOS Ventura |
| Firefox | 119 | Desktop only; no Android support |
| Samsung Internet | 21 | Android only |

**Detection before invoking:**
```javascript
if (window.PublicKeyCredential && PublicKeyCredential.getClientCapabilities) {
  const caps = await PublicKeyCredential.getClientCapabilities();
  if (caps.conditionalGet === true) {
    // Safe to start conditional UI
  }
}
// Older fallback (pre-Chrome 133):
if (await PublicKeyCredential.isConditionalMediationAvailable?.()) { ... }
```

**Private browsing / incognito:** Conditional UI may not show previously registered
passkeys in private mode on some browsers. This is a known ecosystem limitation —
always keep the explicit "Sign in with a passkey" button as a fallback.

---

## Problem 3: Challenge expiry before user submits

**Symptom:** User is slow (cross-device flow, biometric retry, distracted) and
gets a server error like `"Challenge expired"` or `"Challenge not found"`.

**Cause:** Default TTL of 5 minutes is too short for hybrid (cross-device) flows.

**Fix:**
- Use a 5-minute TTL for registration (user is already logged in, fast flow)
- Use a 10-minute TTL for authentication (may include cross-device BLE setup)
- For Redis: `EX 600` (10 minutes)
- Implement client-side retry: catch the error → fetch a new challenge → retry
  the ceremony automatically (transparent to user)

```javascript
// Client-side auto-retry on challenge expiry
async function authenticateWithRetry(maxRetries = 1) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const options = await fetchChallenge(); // fresh challenge each time
      return await startAuthentication(options);
    } catch (err) {
      if (err.name === 'NotAllowedError' || i === maxRetries) throw err;
      // Challenge may have expired — loop for a fresh one
    }
  }
}
```

---

## Problem 4: Origin mismatch

**Symptom:** Server returns `"Origin mismatch"` or `"Unexpected origin"` during
verification.

**Cause:** The `origin` in `clientDataJSON` does not match `expectedOrigin`.

**Common sources:**
- `localhost` vs `127.0.0.1` — these are different origins
- `http://localhost:3000` vs `http://localhost:8080` — different ports = different origins
- `https://example.com` vs `https://www.example.com` — subdomains are different origins
- Mobile apps using `android:apk-key-hash:...` or `ios:bundle-id:...` origins

**Fix:** Always configure `expectedOrigins` as an array including every legitimate
origin for each environment:
```typescript
// Server config
const expectedOrigins = process.env.APP_ORIGINS
  ? process.env.APP_ORIGINS.split(',')   // comma-separated list
  : ['http://localhost:3000'];

// Production example
APP_ORIGINS=https://example.com,https://www.example.com
```

---

## Problem 5: `NotAllowedError` — causes and meaning

`NotAllowedError` is thrown by the browser when the ceremony is denied. It does
NOT reveal the specific reason (by design — to prevent fingerprinting).

**Possible causes:**
1. User explicitly clicked "Cancel" or "Not now" in the OS dialog
2. The OS dialog timed out (usually 60 seconds of inactivity)
3. `allowCredentials` lists credentials the user doesn't have (too restrictive)
4. Another `navigator.credentials.get()` call is already pending (AbortController issue)
5. The page lost focus during the ceremony (some browsers cancel on blur)
6. rpID mismatch detected browser-side before server is even called

**Handling:** Always treat `NotAllowedError` as non-fatal. Show:
> "Sign in cancelled. You can try again anytime."

Never log `NotAllowedError` as an error — it's user-initiated cancellation.

---

## Problem 6: Cross-browser / platform incompatibilities

### Firefox
- No Conditional UI on Android (no autofill passkey suggestions)
- `getTransports()` not available (returns undefined) — always guard with `if (credential.response.getTransports)`
- No support for `credProps` extension on older versions

### Safari (iOS/macOS)
- `userVerification: 'required'` and `'preferred'` behave identically (both
  request biometric/passcode) — cannot force PIN-only on iOS
- `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` always
  returns `true` even if no biometric is enrolled (it counts passcode)
- WKWebView: passkeys only work for the linked app domain (no federated IdP flows)
- Legacy WebAuthn credentials from iOS 15 and earlier are NOT auto-migrated to
  passkeys — user must re-register with the same user handle

### Windows
- Windows Hello requires a PIN to be set up (even if only using fingerprint)
- Chrome 120+: if biometrics are unavailable, falls back to PIN for both
  `required` and `preferred` userVerification
- Cross-device auth (phone as authenticator) requires persistent Bluetooth
  pairing on Android; iOS requires QR code scan each time

### Android
- WebAuthn in embedded WebViews (EWV) only works for the app's linked domain
- Use Custom Tabs (Chrome) or `ASWebAuthenticationSession` equivalent for
  federated identity flows
- Google Password Manager requires Android 9+; third-party providers need Android 14+
- Cross-device persistent linking: only supported with Windows 11 23H2+

### ChromeOS
- Cannot CREATE passkeys locally (no platform authenticator)
- Can authenticate via cross-device auth (phone or security key)

---

## Problem 7: User Verification (UV) flag non-compliance

**Symptom:** High-security app sets `requireUserVerification: true` but users
can still sign in via extensions without performing actual biometric/PIN.

**Cause:** Several browser extension-based passkey providers set the `uv` flag
to `true` in the authenticator data without actually performing user verification:

| Provider | Form | UV Compliant? |
|---|---|---|
| 1Password | Extension | ❌ Sets UV=true without verifying |
| 1Password | Native app | ✅ Compliant |
| Bitwarden | Extension | ❌ Sets UV=true without verifying |
| KeePassXC | Extension | ❌ Sets UV=true without verifying |
| Okta Personal | Extension | ❌ Sets UV=true without verifying |
| Okta Personal | Native | ✅ Compliant |
| Proton Pass | Extension | ❌ Sets UV=true without verifying |
| Strongbox | Native | ❌ Sets UV=true without verifying |
| iCloud Keychain | Native | ✅ Compliant |
| Google PM | Native | ✅ Compliant |
| Windows Hello | Native | ✅ Compliant |

**Impact:** For most consumer apps using `userVerification: 'preferred'`, this
is acceptable — the UV flag is informational, not a security boundary.

For **high-security use cases** (payments, admin, step-up auth): do not use
`requireUserVerification: true` alone as a security control. Combine with:
- AAGUID-based attestation (check against FIDO MDS for certified authenticators)
- `backedUp: false` requirement (device-bound only)
- Server-side session risk signals (IP change, device change)

---

## Problem 8: Orphaned passkeys (credential in provider but not on server)

**Symptom:** User sees a passkey in their password manager but gets an error
when trying to use it (credential not found on server).

**Cause:** The credential was deleted from the server (or the user account was
recreated) but the passkey provider still has the private key.

**Fix:** Use the WebAuthn Signal API when a 404 is returned:
```javascript
// After authentication attempt returns 404 (credential not found):
if (response.status === 404 && PublicKeyCredential.signalUnknownCredential) {
  await PublicKeyCredential.signalUnknownCredential({
    rpId: 'example.com',
    credentialId: body.id,  // base64url credential ID from the failed attempt
  });
  // The passkey provider will mark this credential for deletion
}
```

---

## Problem 9: Multiple passkeys confusing users

**Symptom:** Users have multiple passkeys (one per device, one in iCloud, one in
Google PM) and don't know which one to use or why they have so many.

**UX guidance:**
- Display AAGUID-derived provider names in passkey cards: "iCloud Keychain",
  "Google Password Manager", "1Password"
- Show sync status (`backedUp: true` → display "Synced" badge)
- Allow users to rename passkeys to meaningful labels: "My iPhone", "Work laptop"
- Provide a "last used" date on each card
- Recommend users keep at least 2 passkeys (one synced + one security key or
  another device) for recovery resilience

---

## Problem 10: WebAuthn ceremony failures — generic debugging

When a ceremony fails and the error is unclear:

1. Open browser DevTools → Application tab → check for WebAuthn errors
2. Check `clientDataJSON` in the response — decode from base64url:
   ```javascript
   JSON.parse(atob(credential.response.clientDataJSON.replace(/-/g,'+').replace(/_/g,'/')))
   // Look at: type, origin, challenge
   ```
3. Verify the `challenge` matches exactly what the server stored (base64url encoding is exact)
4. Use the WebAuthn Response Decoder at https://debugger.simplewebauthn.dev/ to
   inspect the full authenticatorData flags
5. Check the rpIdHash: it must equal `SHA-256(rpID)` — if wrong, rpID is wrong
6. Enable verbose logging in your WebAuthn library (e.g., SimpleWebAuthn's `debug` flag)

---

## FIDO-tested Error Message Templates

Based on Passkey Central messaging guidelines. Use these in your UI:

### Passkey creation failed
**Title:** "We couldn't create your passkey"  
**Body:** "This may be a temporary issue. If the problem continues, you can skip
this step and add a passkey later from your account settings."  
**Actions:** [Try again] [Continue without passkey]

### Sign-in failed (generic)
**Title:** "We couldn't sign you in"  
**Body:** "This might be because your biometric sensor timed out, your connection
was interrupted, or the sign-in was cancelled. Please try again."  
**Actions:** [Try again] [Try another sign-in method]

### Passkey no longer valid (orphaned credential)
**Title:** "This passkey is no longer valid"  
**Body:** "It may have been removed from your account or the device it was
created on was reset. Try another sign-in method or create a new passkey."  
**Actions:** [Try another sign-in method] [Create a new passkey]

### Cross-device Bluetooth failure
**Title:** "We couldn't connect to your other device"  
**Body:** "Make sure Bluetooth is turned on and both devices are close together,
then try again."  
**Actions:** [Try again] [Try another sign-in method]

### Principles for all error messages
1. State what happened in plain language — not "Error code 0x80090016"
2. Specify who acts and when — avoid "We'll try again later"
3. Blame the system, not the user — "This may be a temporary issue"
4. Always give at least one fallback path — never leave user stuck
5. Consistent structure: Title → Brief explanation → Next step → Actions → Support link
