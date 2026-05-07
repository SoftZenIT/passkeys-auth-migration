# Passkey Messaging Guidelines

Sources:
- Passkey Central Messaging Guidelines (passkeycentral.org/resources-and-tools/messaging-guidelines-for-passkey-failure-states)
- FIDO Alliance UX Guidelines
- passkeys.dev/docs/reference/known-issues

---

## Failure State Copy Templates

Use these FIDO-tested messages verbatim or adapt them to your tone. Never expose
technical error names (e.g. `NotAllowedError`) to end users.

### Registration errors

| Error | User-facing message |
|-------|-------------------|
| `NotAllowedError` | "Passkey setup was cancelled. You can set one up anytime in Account Settings." |
| `InvalidStateError` | "A passkey for this device already exists. You can manage your passkeys in Account Settings." |
| `NotSupportedError` | *(hide passkey UI silently — browser does not support WebAuthn)* |
| `SecurityError` | *(log only — always a config bug, never show to users)* |
| `AbortError` | "Passkey setup timed out. Try again when you're ready." |
| Network / server error | "Something went wrong. Please try again or use your password." |

### Authentication errors

| Error | User-facing message |
|-------|-------------------|
| `NotAllowedError` | "Cancelled. Try again anytime." |
| `NotSupportedError` | *(fall back to password silently)* |
| `SecurityError` | *(log only — fix rpId, never show to users)* |
| `AbortError` | "Sign-in timed out. Try again or use your password." |
| 404 from server (credential not found) | "We couldn't find that passkey. Try another sign-in method." *(also call `signalUnknownCredential()` to clean up the orphaned entry)* |
| Network / server error | "Something went wrong. Please try again or use your password." |

---

## Promotion Copy Templates

### Account Settings hero (required FIDO pattern)

```
[Passkey icon]  Sign in faster with a passkey
Your fingerprint, face, or screen lock — no password needed.
[Create a passkey]
```

### Post-login upgrade nudge (Gradual rollout)

```
[Passkey icon]  Want to skip the password next time?
Set up a passkey to sign in with your fingerprint or face.
[Set up passkey]  [Not now]
```

### Cross-device interstitial (after cross-platform authenticator)

```
You signed in with another device.
Want to set up a passkey here so you can sign in faster next time?
[Yes, set up a passkey]  [Skip for now]
```

### Passkey card label (Account Settings list)

```
[Provider icon]  [Provider name]  ·  Added [date]
[Synced across devices / This device only]
[Delete]
```

---

## Tone Rules

1. **Never say "your passkey failed"** — say "we couldn't sign you in" (removes blame from the user).
2. **Never use jargon** — "passkey" is acceptable; "WebAuthn", "FIDO2", "credential", "attestation" are not.
3. **Always offer an escape hatch** — every error message should have a fallback path.
4. **One-time nudges only** — if a user dismisses a passkey promotion, do not show it again in the same session.
5. **Sync badge uses text + icon** — never color alone (WCAG 1.4.1).

---

## DO / DON'T Quick Reference

| DO | DON'T |
|----|-------|
| "Sign in with a passkey" | "Use WebAuthn" |
| "Set up a passkey" | "Register a credential" |
| "Your passkey from iCloud Keychain" | "Your FIDO2 credential" |
| "Synced across your Apple devices" | "Multi-device credential (backed up)" |
| "This device only" | "Single-device, non-discoverable credential" |
