# UX Guidelines Reference

Sources:
- FIDO Alliance Design Guidelines (passkeycentral.org/design-guidelines) — research by FIDO UX Working Group (128 people, 32 companies via BlinkUX)
- passkeys.dev Bootstrapping guide
- Google Identity Passkeys UX guide

> Ready-to-use copy for all components below is in `assets/ux-copy-templates.md`.
> Load it when writing actual UI text — it contains FIDO-tested wording for
> hero prompts, handshake messages, passkey cards, error messages, and interstitials.

---

## The 10 UX Principles (FIDO Alliance)

### 1. Prompt at account-related moments
Best moments to prompt passkey creation (highest -> lowest success):
- ✅ Account creation (highest conversion)
- ✅ Account recovery / forgot password flow
- ✅ Account Settings (always include — required pattern)
- ✅ Post-login upgrade nudge (one-time, dismissible)
- ⚠️  During sign-in interruption (less effective — feels disruptive)

### 2. Associate passkeys with the familiar
Connect passkeys to things users already know:
> "Sign in using your fingerprint or face"
> "Use your screen lock to sign in"
> "Passkeys are encrypted digital keys you create using your fingerprint, face, or passcode."

### 3. Handshake messages before AND after OS dialogs
**Before triggering OS dialog:**
- Show: passkey icon + headline + short description of what will happen
- Example: "We'll open your device's screen lock to create your passkey"

**After OS dialog:**
- Success: "Your passkey was created! Next time, just use your fingerprint to sign in."
- Cancelled: "Passkey creation was cancelled. You can create one anytime in Account Settings."
- Never go straight button -> OS dialog without a prep screen

### 4. Allow freedom and choice
- Always offer an alternative (password, magic link, etc.)
- "Create passkey" must never block completing the core task
- Provide "Not now" / "Skip" option on all passkey prompts
- Allow creating and deleting passkeys at any time in Account Settings

### 5. Accessibility
Follow WCAG 2.1 AA. Per 2023 FIDO UX research with screen reader users:
- All passkey UI keyboard accessible
- Screen reader support: VoiceOver (iOS/macOS), TalkBack (Android)
- `aria-live` announcements for async passkey results
- Sufficient color contrast (4.5:1 minimum)
- Accessible labels on all buttons (not icon-only)
- Reference: https://fidoalliance.org/white-paper-guidance-for-making-fido-deployments-accessible-to-users-with-disabilities/

### 6. Consistent hero prompt across the journey
Use one reusable "hero" component everywhere:
```
[Passkey icon]
[Headline: "Create a passkey" or "Sign in with a passkey"]
[Benefit sentence]
[Primary CTA button]
[Secondary "Not now" / "Skip" link]
```
Use identical component in: Account Settings, post-login prompt, account recovery.

### 7. Persist helpful information (never hide in tooltips)
Keep passkey info always visible:
- Passkey description stays in Account Settings even after creation
- "If you lose your device, you can still sign in with your password" — always visible
- "Disable passkeys" link must show inline what disabling means — not in a hover tooltip

### 8. Passkeys as primary option in Account Settings
- Give "Passkeys" an H2 heading — same level as "Password" and "Two-Factor Auth"
- Place passkeys section above or at same level as passwords
- Do NOT bury in a "Security" sub-sub-menu

### 9. Passkey cards with meaningful content
Per credential card must show:
- Official passkey icon
- Provider name (from AAGUID: "Google Password Manager", "iCloud Keychain", etc.)
- Date created
- Last used date
- Sync status: "Synced across devices" (backed_up=true) or "This device only" (backed_up=false)
- Delete/Remove button

### 10. Plan UX per your security policy
Guidelines focus on FIDO synced passkeys. Adapt identity proofing and step-up auth requirements to your use case and risk model.

---

## 3 Content Principles

### C1. Pair passkeys with known terms
❌ "Register a FIDO2 authenticator"
✅ "Create a passkey — sign in using your fingerprint or face"

❌ "WebAuthn credential created"
✅ "Your passkey is ready. Next time, just use your fingerprint to sign in."

### C2. Handshake messages (before + after OS dialog)

**Before OS dialog:**
```
[Passkey icon]
Create a passkey
Use your fingerprint, face, or screen lock to sign in — no password needed.
[Create a passkey]  [Not now]
```

**After success:**
```
[✓ Passkey icon]
Your passkey was created!
You can now sign into [App Name] with just your fingerprint or face.
[Done]
```

**After cancellation:**
```
Passkey creation was cancelled.
You can create a passkey anytime from your account settings.
[Try again]  [Skip]
```

### C3. Use passkey messaging throughout the journey
Surface passkeys at these moments:
1. Account creation (post-registration prompt)
2. Forgot password / account recovery
3. Account Settings (always)
4. Post-login upgrade nudge (gradual rollout)
5. After cross-device auth ("Set up a passkey on this device?")

---

## Required Design Patterns (FIDO — Must Implement)

### Pattern 1: Create, View, and Manage Passkeys in Account Settings
Reference: passkeycentral.org/design-guidelines/required-patterns/create-view-and-manage-passkeys-in-account-settings

Must implement:
- Hero section: passkey icon + description + "Create a passkey" CTA
- List of existing passkeys as cards (icon + provider name + date + sync status + remove)
- "Add another passkey" button when ≥1 passkey exists
- Delete with confirmation ("Removing this passkey means you'll need to use your password to sign in from this device")

### Pattern 2: Sign In with a Passkey
Reference: passkeycentral.org/design-guidelines/required-patterns/sign-in-with-a-passkey

Must implement:
- `autocomplete="username webauthn"` on username input (Conditional UI / autofill)
- Explicit "Sign in with a passkey" button (for browsers without autofill support)
- Graceful fallback to password when passkey not available
- Handshake screen before OS dialog on explicit button click

---

## Optional Design Patterns (FIDO — Add Over Time)

### Create Passkey During Account Recovery
When user resets password via forgot-password flow, offer passkey creation instead of/in addition to new password.
- "Instead of setting a new password, create a passkey for faster and more secure sign-in"
- Primary CTA: "Create a passkey"
- Secondary: "Set a password instead"

### Cross-Device Sign-In
Allow sign-in on desktop using a phone that has a passkey (hybrid transport / QR code flow).
- "Use a passkey from another device" option on sign-in page
- After successful cross-device auth: offer "Create a passkey on this device"

### Deprecate SMS OTP
After passkeys are stable, prompt SMS OTP users to replace with passkeys:
- "Switch to passkeys for faster, more secure sign-in (no more SMS codes)"
- Only promote to users who have successfully used passkeys ≥1 time

### New Account Creation with Passkey
At the end of registration flow, offer passkey creation before password:
- "Start with a passkey — no password needed"
- If user declines: collect password as fallback

### Passkey Management UI — Multiple Passkey Types
When user has both synced passkeys and security-key-bound passkeys:
- Group by type: "Synced passkeys" and "Security keys"
- Different icons for device passkeys vs hardware keys

### Remove Passkey
Confirmation dialog must include:
- What the passkey is (provider, date created, device)
- What removal means: "You'll need to sign in with your password from this device"
- "Remove" and "Cancel" options
- Never auto-delete without explicit confirmation

### App ↔ Website Passkey Sharing (Related Origins)
If you have both a website and a native app: configure `/.well-known/assetlinks.json` (Android) and `/.well-known/apple-app-site-association` (iOS) to share passkeys across app and site.

---

## Bootstrapping Interstitials (from passkeys.dev)

### Upgrade prompt (after password login)
Show once — when user hasn't created a passkey yet:
```
[Passkey icon]
Faster, safer sign-in with passkeys
You can now sign into [App Name] using your face, fingerprint, or device PIN!
[Create a passkey]  [Not now]
```

### Cross-device upgrade prompt (after using phone to sign in on desktop)
```
[Passkey icon]
Set up a passkey on this device
Next time you sign in, would you like to use this device instead of your phone?
[Yes, create a passkey]  [Not now]
```

---

## Language Reference

| ❌ Avoid | ✅ Use |
|---|---|
| FIDO2 credential | Passkey |
| Authenticator | Your device / your fingerprint |
| Relying party | (never show to users) |
| WebAuthn ceremony | (never show to users) |
| Register passkey | Create a passkey |
| Delete credential | Remove passkey |
| Synced credential | Passkey (backed up / synced) |
| Device-bound credential | Passkey (this device only) |
| Biometric | Fingerprint, face, or screen lock |
| User verification | (never show to users) |

---

## Rollout-Specific UX

### Gradual Rollout UX (minimal disruption)
- Passkey only in Account Settings
- No promotional banners, no forced prompts during sign-in
- Optional: one-time post-login nudge, permanently dismissible
- Users who find it: self-service

### Rapid Rollout UX (active promotion)
- Hero component on sign-in page, account creation, and recovery
- In-app announcement banner: "Your account now supports passkeys"
- Email/push notification campaign
- Passkey creation step added to onboarding/new user flow
- Progress metrics dashboard (enrollment rate, sign-in success rate)

---

## Troubleshooting UX (from passkeycentral.org/troubleshooting)

Common ecosystem issues to design around:

| Issue | Design mitigation |
|---|---|
| User loses device | Always show: "If you lose this device, sign in with your password or another passkey" |
| Multiple passkeys confusion | Label each card with provider name + date + sync status |
| Browser/OS update breaks WebAuthn | Always maintain password fallback |
| Biometrics misconception | "Your fingerprint never leaves your device. We only store a digital key." |
| Cross-device confusion | Show clear "another device" option; use QR/BT hybrid flow |
| Passkey not available on work device | "Some corporate devices block passkeys. Use your password instead." |
