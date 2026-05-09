# UX Copy Templates

Ready-to-use text for passkey UI components. Adapt to your brand voice.
All copy tested in FIDO Alliance usability research (2022–2024).

---

## Hero section — Account Settings

### Headline
> Create a passkey

### Benefit copy (short)
> Sign in faster using your fingerprint, face, or screen lock — no password
> needed.

### Benefit copy (long)
> Passkeys are encrypted digital keys stored securely on your device. You
> create one using your fingerprint, face, or screen lock. Next time you sign
> in, just verify with your device — no password to remember or type.

### CTA button
> Create a passkey

### Sub-note (always visible, never in tooltip)
> Your passkey is stored on this device or in your password manager. If you
> lose your device, you can still sign in with your password.

---

## Before OS dialog (handshake — shown immediately before browser prompt)

### Registration
> We'll ask your device to save a passkey. You may be prompted for your
> fingerprint, face, or screen lock.

### Authentication
> Select your passkey to sign in. Your device will ask you to verify with
> your fingerprint, face, or screen lock.

---

## After OS dialog (result messages)

### Registration success
> Your passkey was created! Next time, just use your fingerprint or face to
> sign in — no password needed.

### Registration cancelled
> Passkey creation was cancelled. You can create one anytime from your account
> settings.

### Authentication success
> Signed in with your passkey.

### Authentication cancelled
> Sign-in was cancelled. Use your password to sign in instead.

---

## Sign-in page button

> Sign in with a passkey

### Sub-label (optional, shown below button)
> Use your fingerprint, face, or screen lock

---

## Passkey card (one per credential in Account Settings)

### Synced passkey
> **[User-assigned name or AAGUID default, e.g. "iCloud Keychain"]**
> Google Password Manager / iCloud Keychain / 1Password  ← muted subtitle
> Created [date] · Last used [date] · Synced across your devices

### Device-bound passkey
> **[Name]**
> [Provider name]
> Created [date] · Last used [date] · Saved to this device only

### Card actions
> [Rename]  [Remove]

### Delete confirmation
> Remove this passkey?
> You will no longer be able to sign in with this passkey. You can still sign
> in with your password or another passkey.
> [Remove]  [Cancel]

---

## Passkey naming

### Rename button (on passkey card)
> Rename

### Inline rename input placeholder
> e.g. Work MacBook, iPhone 15

### Inline rename actions
> [Save]  [Cancel]

### Post-creation naming prompt (optional — shown after successful passkey creation)

#### Headline
> Name this passkey (optional)

#### Body
> Give it a name so you can tell it apart from your other passkeys.

#### Input (pre-filled with AAGUID-resolved name)
> [iCloud Keychain                              ]

#### Actions
> [Save name]  [Skip]

### Rename success (aria-live announcement, not a visible toast)
> Passkey renamed.

### Rename error (inline, below input)
> Name cannot be empty. Please enter a name or press Cancel.

---

## Post-login upgrade nudge (one-time, dismissible)

### Headline
> Sign in faster next time

### Body
> Create a passkey to sign in with just your fingerprint or face — no password
> needed.

### CTA
> Create a passkey

### Dismiss
> Not now

---

## Cross-device upgrade interstitial

### Headline
> Set up a passkey on this device

### Body
> You signed in using your phone. Would you like to use this device next time
> instead? It's faster and works without your phone nearby.

### CTA
> Create a passkey on this device

### Dismiss
> Not now

---

## Language to avoid / prefer

| Avoid | Use instead |
|-------|-------------|
| FIDO2 credential | Passkey |
| Authenticator | Your device / your fingerprint |
| Relying party | (never show to users) |
| WebAuthn ceremony | (never show to users) |
| Register passkey | Create a passkey |
| Delete credential | Remove passkey |
| Synced credential | Passkey (backed up) |
| Device-bound | Passkey (this device only) |
| Biometric | Fingerprint, face, or screen lock |
| User verification | (never show to users) |

---

## Passkey icon

Official FIDO Alliance passkey icon — free for sites offering passkeys.

Download: https://fidoalliance.org/get-the-passkey-icon/
Style guide: https://fidoalliance.org/wp-content/uploads/2023/12/FIDO-Passkey_Icon_Usage_Guidelines-August2022.pdf

Usage rules:
- Always use alongside visible text label (not icon-only)
- Add `aria-hidden="true"` when paired with visible text
- Add `aria-label="Passkey"` when used alone
- Do not recolor or distort the icon
