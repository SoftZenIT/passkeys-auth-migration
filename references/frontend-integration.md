# Frontend Integration Reference

## Core Concepts

The frontend is responsible for:
1. Calling the browser's WebAuthn API (`navigator.credentials.create` and `navigator.credentials.get`)
2. Communicating with the backend (challenge -> device -> verify)
3. Providing FIDO-compliant UX (see ux-guidelines.md)
4. Handling errors gracefully and offering fallback

**Library-free alternative:** the examples use `@simplewebauthn/browser`, but
WebAuthn Level 3 ships spec-level JSON helpers in the browser —
`PublicKeyCredential.parseCreationOptionsFromJSON()` /
`parseRequestOptionsFromJSON()` to consume server options, and
`credential.toJSON()` to serialize responses. Teams avoiding a dependency can
use these directly with `navigator.credentials.create()/get()`.

---

## Feature Detection

Always check for WebAuthn support before showing passkey UI:

```typescript
// Is WebAuthn supported at all?
export const isWebAuthnSupported = (): boolean =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential;

// Is a platform authenticator (biometric / PIN) available?
// Call this before showing "Create passkey" UI
export const isPlatformAuthAvailable = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
};

// Shared capability check (Chrome/Edge 133+, Firefox 135+, Safari 17.4+).
// Returns null — not false — when the modern API is unavailable or throws,
// so callers can tell "unsupported" apart from "add a legacy fallback here".
const getClientCapability = async (name: string): Promise<boolean | null> => {
  if (!isWebAuthnSupported()) return false;
  if (typeof PublicKeyCredential.getClientCapabilities !== 'function') return null;
  try {
    const caps = await PublicKeyCredential.getClientCapabilities();
    return caps[name] === true;
  } catch {
    return null;
  }
};

// Is Conditional UI (autofill passkeys) supported? — needed for sign-in page
export const isConditionalUIAvailable = async (): Promise<boolean> => {
  const modern = await getClientCapability('conditionalGet');
  if (modern !== null) return modern;
  // Legacy API (Chrome 108+, Safari 16+, Firefox 119+): isConditionalMediationAvailable()
  return typeof PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
    PublicKeyCredential.isConditionalMediationAvailable();
};

// Can the browser silently upgrade a password sign-in to a passkey?
// (conditional create — Safari 18+, Chrome 136+ desktop / 142+ Android)
export const isConditionalCreateAvailable = async (): Promise<boolean> =>
  (await getClientCapability('conditionalCreate')) === true;

// Can the browser run an immediate-mode get()? (smart sign-in button, Chrome 149+)
export const isImmediateGetAvailable = async (): Promise<boolean> =>
  (await getClientCapability('immediateGet')) === true;
```

Rules:
- `isPlatformAuthAvailable()` -> false: hide "Create passkey" UI silently (no error)
- `isConditionalUIAvailable()` -> false: skip conditional init, show explicit button only

---

## Conditional UI (Form Autofill) — Sign-In Page

This is the **primary recommended sign-in flow** (Google, passkeys.dev, FIDO). Passkeys appear inside the browser's native autofill dropdown when the user clicks the username field — no separate button needed.

### HTML

```html
<!-- CRITICAL: autocomplete="username webauthn" triggers the autofill passkey UI -->
<!-- autofocus triggers the dropdown immediately on page load -->
<input
  type="text"
  name="username"
  id="username"
  autocomplete="username webauthn"
  autofocus
  placeholder="Email or username"
/>
<input
  type="password"
  name="password"
  autocomplete="current-password"
  placeholder="Password"
/>
```

### JavaScript — Initialise on page load

```javascript
// Call once on page load. It's "set and forget" — the promise resolves
// ONLY when the user selects a passkey from the autofill dropdown.
async function initConditionalAuth() {
  if (!(await isConditionalUIAvailable())) return;

  try {
    // 1. Get challenge from server (no username needed — discoverable credential)
    const optionsResp = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' });
    const options = await optionsResp.json();

    // 2. Start conditional (non-modal) — waits silently in background
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const authResp = await startAuthentication({
      optionsJSON: options,
      useBrowserAutofill: true,   // KEY FLAG: enables autofill UI
    });

    // 3. Verify and sign in
    const verifyResp = await fetch('/auth/passkey/authenticate/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authResp),
    });
    const { token } = await verifyResp.json();
    onSignInSuccess(token);

    // Bonus: offer to create local passkey if auth came from another device
    if (authResp.authenticatorAttachment === 'cross-platform') {
      showCrossDeviceUpgradePrompt(); // "Set up a passkey on this device?"
    }
  } catch (err) {
    // User dismissed autofill or selected password -> do NOT show error
    // This is expected, fall through to normal form flow
    console.info('Conditional UI not resolved:', err.name);
  }
}
```

### Key behaviour
- User focuses on username input -> passkeys appear in autofill dropdown alongside saved passwords
- User selects passkey -> device biometric prompt -> automatic sign-in
- User selects password -> conditional promise never resolves -> password form works normally
- **Never interrupt the password form flow** — conditional UI is completely silent

---

## Explicit Sign-In Button (fallback / parallel)

Always provide alongside Conditional UI for browsers/devices without autofill support:

```typescript
const authenticateWithPasskey = async (): Promise<void> => {
  try {
    const optionsResp = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' });
    const options = await optionsResp.json();
    const { startAuthentication } = await import('@simplewebauthn/browser');

    // No useBrowserAutofill -> shows modal passkey picker immediately
    const authResp = await startAuthentication({ optionsJSON: options });

    const verifyResp = await fetch('/auth/passkey/authenticate/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authResp),
    });
    const { token } = await verifyResp.json();
    onSignInSuccess(token);
  } catch (err: any) {
    if (err.name === 'NotAllowedError') showError('Sign-in was cancelled.');
    else showError('Passkey sign-in failed. Try another method.');
  }
};
```

---

## Immediate UI Mode — Smart Sign-In Button (Chrome 149+)

An upgrade of the explicit button above: one adaptive "Sign in" button that
jumps straight to the passkey prompt when a locally-available credential
exists, and falls back silently when none does.

> ⚠️ **Syntax changed at stable launch.** Chrome 149 shipped this as
> `uiMode: 'immediate'` on `navigator.credentials.get()`. The origin-trial
> syntax `mediation: 'immediate'` **no longer triggers immediate mode** — code
> using it silently gets a normal modal ceremony instead.

```typescript
const signInSmart = async (): Promise<void> => {
  // isImmediateGetAvailable() from §Feature Detection (caps.immediateGet)
  if (!(await isImmediateGetAvailable())) {
    return showLoginForm();  // standard flow for every other browser
  }

  // MANDATORY: only one WebAuthn ceremony may be active. If conditional UI
  // (autofill) is already pending, the immediate get() is rejected instantly
  // with NotAllowedError — indistinguishable from "no credential found".
  // SimpleWebAuthn users: WebAuthnAbortService.cancelCeremony().
  conditionalAbortController?.abort();

  try {
    const optionsResp = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' });
    // fetch() does NOT throw on 4xx/5xx — check explicitly, or a server error
    // gets parsed as if it were valid ceremony options.
    if (!optionsResp.ok) throw new Error(`Challenge request failed: ${optionsResp.status}`);
    const optionsJSON = await optionsResp.json();

    const credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(optionsJSON),
      uiMode: 'immediate',
    } as CredentialRequestOptions);

    await verifyOnServer((credential as PublicKeyCredential).toJSON());
  } catch (err: any) {
    // Every failure path re-arms conditional UI (we aborted it above) by
    // revealing the login form — not just the NotAllowedError branch, or a
    // network/server error leaves autofill permanently disarmed until reload.
    if (err.name !== 'NotAllowedError') {
      showError('Passkey sign-in failed. Try another method.');
    }
    // No local passkey → silent, no error shown at all (by design).
    showLoginForm();       // its onMounted/useEffect calls initConditionalAuth()
  }
};
```

### Behaviour and constraints

- **Chrome 149+ only as of mid-2026** — ship as progressive enhancement; every
  other browser takes the explicit-button / conditional UI path above.
- **Silent rejection**: no local credential → instant `NotAllowedError`, no
  browser UI shown. Reveal your fallback; never show an error message.
- **Locally-available credentials only**: immediate mode suppresses the
  cross-device/hybrid (QR code) options — users whose only passkey lives on
  their phone will land in your fallback path.
- **Single-ceremony rule still applies**: abort any pending conditional UI
  request (AbortController) before firing the immediate `get()`, as the code
  above does. Skipping the abort makes the immediate call fail with
  `NotAllowedError` **even when the user has a local passkey** — and that error
  is indistinguishable from "no credential", so the feature silently never
  works. See the SKILL.md AbortController gotcha.

---

## Vue 3 — Full Composable (Recommended)

```typescript
// composables/usePasskey.ts
import { ref, onMounted } from 'vue';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
} from '@simplewebauthn/browser';

export function usePasskey() {
  const isSupported = ref(false);
  const conditionalSupported = ref(false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  onMounted(async () => {
    isSupported.value = browserSupportsWebAuthn();
    conditionalSupported.value = await browserSupportsWebAuthnAutofill();
  });

  // ── Registration (Account Settings) ─────────────────────────────────
  const registerPasskey = async () => {
    isLoading.value = true; error.value = null;
    try {
      const options = await fetch('/auth/passkey/register/challenge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      }).then(r => r.json());

      const reg = await startRegistration({ optionsJSON: options });

      await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(reg),
      });
      return { success: true };
    } catch (e: any) {
      error.value = e.name === 'NotAllowedError'
        ? 'Passkey creation was cancelled. You can try again anytime.'
        : e.name === 'InvalidStateError'
        ? 'A passkey already exists for this account on this device.'
        : 'Unable to create passkey. Please try again.';
      return { success: false };
    } finally { isLoading.value = false; }
  };

  // ── Authentication (Sign-In page — explicit button) ──────────────────
  const authenticateWithPasskey = async () => {
    isLoading.value = true; error.value = null;
    try {
      const options = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' })
        .then(r => r.json());
      const authResp = await startAuthentication({ optionsJSON: options });
      const { token } = await fetch('/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp),
      }).then(r => r.json());
      return { success: true, token, crossDevice: authResp.authenticatorAttachment === 'cross-platform' };
    } catch (e: any) {
      error.value = e.name === 'NotAllowedError' ? 'Sign-in was cancelled.' : 'Sign-in failed. Try another method.';
      return { success: false };
    } finally { isLoading.value = false; }
  };

  // ── Conditional UI (Sign-In page — autofill) ────────────────────────
  const initConditionalAuth = async (onSuccess: (token: string) => void) => {
    if (!conditionalSupported.value) return;
    try {
      const options = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' })
        .then(r => r.json());
      const authResp = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true });
      const { token } = await fetch('/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp),
      }).then(r => r.json());
      onSuccess(token);
    } catch { /* silent — user dismissed autofill */ }
  };

  return {
    isSupported, conditionalSupported, isLoading, error,
    registerPasskey, authenticateWithPasskey, initConditionalAuth,
  };
}
```

---

## React — Hooks Pattern

```typescript
// hooks/usePasskey.ts
import { useState, useEffect, useCallback } from 'react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

export function usePasskey() {
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSupported(browserSupportsWebAuthn()); }, []);

  const register = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const options = await fetch('/auth/passkey/register/challenge', {
        method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
      }).then(r => r.json());
      const reg = await startRegistration({ optionsJSON: options });
      await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(reg),
      });
      return true;
    } catch (e: any) {
      setError(e.name === 'NotAllowedError' ? 'Cancelled.' : 'Registration failed.');
      return false;
    } finally { setLoading(false); }
  }, []);

  const authenticate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const options = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' })
        .then(r => r.json());
      const authResp = await startAuthentication({ optionsJSON: options });
      const { token } = await fetch('/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp),
      }).then(r => r.json());
      return { token, crossDevice: authResp.authenticatorAttachment === 'cross-platform' };
    } catch (e: any) {
      setError(e.name === 'NotAllowedError' ? 'Cancelled.' : 'Sign-in failed.');
      return null;
    } finally { setLoading(false); }
  }, []);

  return { supported, loading, error, register, authenticate };
}
```

---

## Angular — Service Pattern

```typescript
// passkey.service.ts
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  constructor(private http: HttpClient) {}

  async register(): Promise<void> {
    const options = await firstValueFrom(
      this.http.post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkey/register/challenge', {})
    );
    const response = await startRegistration({ optionsJSON: options });
    await firstValueFrom(this.http.post('/auth/passkey/register/verify', response));
  }

  async authenticate(): Promise<{ token: string; crossDevice: boolean }> {
    const options = await firstValueFrom(
      this.http.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkey/authenticate/challenge', {})
    );
    const response = await startAuthentication({ optionsJSON: options });
    const { token } = await firstValueFrom(
      this.http.post<{ token: string }>('/auth/passkey/authenticate/verify', response)
    );
    return { token, crossDevice: response.authenticatorAttachment === 'cross-platform' };
  }
}
```

---

## Svelte / SvelteKit — Store Pattern

```typescript
// lib/stores/passkey.ts
import { writable, get } from 'svelte/store';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

export const passkeySupported = writable(false);
export const passkeyLoading = writable(false);
export const passkeyError = writable<string | null>(null);

// Call in +layout.svelte onMount
export function initPasskeySupport() {
  passkeySupported.set(browserSupportsWebAuthn());
}

export async function registerPasskey(): Promise<boolean> {
  passkeyLoading.set(true); passkeyError.set(null);
  try {
    const options = await fetch('/auth/passkey/register/challenge', {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
    }).then(r => r.json());
    const reg = await startRegistration({ optionsJSON: options });
    await fetch('/auth/passkey/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(reg),
    });
    return true;
  } catch (e: any) {
    passkeyError.set(e.name === 'NotAllowedError' ? 'Cancelled.' : 'Registration failed.');
    return false;
  } finally { passkeyLoading.set(false); }
}

export async function authenticateWithPasskey(): Promise<string | null> {
  passkeyLoading.set(true); passkeyError.set(null);
  try {
    const options = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' })
      .then(r => r.json());
    const authResp = await startAuthentication({ optionsJSON: options });
    const { token } = await fetch('/auth/passkey/authenticate/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authResp),
    }).then(r => r.json());
    return token;
  } catch (e: any) {
    passkeyError.set(e.name === 'NotAllowedError' ? 'Cancelled.' : 'Sign-in failed.');
    return null;
  } finally { passkeyLoading.set(false); }
}
```

```svelte
<!-- +page.svelte -->
<script>
  import { onMount } from 'svelte';
  import { passkeySupported, authenticateWithPasskey, initPasskeySupport } from '$lib/stores/passkey';

  onMount(() => initPasskeySupport());
</script>

<input type="text" name="username" autocomplete="username webauthn" autofocus />
{#if $passkeySupported}
  <button on:click={authenticateWithPasskey}>Sign in with a passkey</button>
{/if}
```

---

## Helper Functions (placeholders)

The code samples above reference helper functions that you must implement per your app:

```typescript
// getToken() — returns the current JWT/session token from your auth state manager
// Examples:
//   Vue (Pinia):  const authStore = useAuthStore(); return authStore.token;
//   React (context): return useAuth().token;
//   Svelte (store): return get(authToken);
//   Angular (service): return this.authService.getToken();

// onSignInSuccess(token) — stores the token and redirects to the dashboard
// showError(message) — displays a user-facing error (toast, inline, etc.)
```

---

## Sign-In Page Component (Vue 3)

> For ready-to-use FIDO-tested copy (button labels, hero text, error messages,
> handshake messages, passkey card labels), see `assets/ux-copy-templates.md`.

```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { usePasskey } from '@/composables/usePasskey';

const { isSupported, initConditionalAuth, authenticateWithPasskey, isLoading, error } = usePasskey();

onMounted(() => {
  // Silent autofill — resolves only if user picks a passkey
  initConditionalAuth((token) => router.push('/dashboard'));
});
</script>

<template>
  <form @submit.prevent="handlePasswordSubmit">
    <!-- autocomplete="username webauthn" is the key that enables passkey autofill -->
    <input
      v-model="email"
      type="email"
      autocomplete="username webauthn"
      autofocus
      placeholder="Email address"
      aria-label="Email address"
    />

    <!-- Explicit passkey button (shown when supported) -->
    <button
      v-if="isSupported"
      type="button"
      @click="handlePasskeySignIn"
      :disabled="isLoading"
      class="btn-passkey-primary"
      aria-label="Sign in with a passkey"
    >
      <PasskeyIcon aria-hidden="true" />
      Sign in with a passkey
    </button>

    <div class="divider" role="separator"><span>or</span></div>

    <input
      v-model="password"
      type="password"
      autocomplete="current-password"
      placeholder="Password"
      aria-label="Password"
    />
    <button type="submit">Sign in with password</button>

    <p v-if="error" role="alert" class="error-msg">{{ error }}</p>
  </form>
</template>
```

---

## Account Settings Page (Vue 3)

```vue
<template>
  <section class="account-section" aria-labelledby="passkeys-heading">
    <!-- FIDO Principle 8: Same heading level as Password, 2FA etc. -->
    <h2 id="passkeys-heading">Passkeys</h2>
    <!-- FIDO Principle 7: Persist this description — never hide behind tooltip -->
    <p>Sign in faster using your fingerprint, face, or screen lock. No password needed.</p>

    <!-- FIDO Principle 9: One card per passkey, meaningful content -->
    <article
      v-for="pk in passkeys"
      :key="pk.id"
      class="passkey-card"
      aria-label="`Passkey: ${pk.name}`"
    >
      <PasskeyIcon aria-hidden="true" />
      <div class="passkey-info">
        <strong>{{ pk.name || 'Passkey' }}</strong>
        <span>Created {{ formatDate(pk.createdAt) }}</span>
        <span v-if="pk.lastUsedAt">Last used {{ formatDate(pk.lastUsedAt) }}</span>
        <!-- Show sync status so users know if passkey survives device loss -->
        <span v-if="pk.backedUp" class="badge badge-synced">Synced across devices</span>
        <span v-else class="badge badge-local">This device only</span>
      </div>
      <button
        @click="confirmDelete(pk.id)"
        class="btn-danger"
        :aria-label="`Remove passkey: ${pk.name}`"
      >
        Remove
      </button>
    </article>

    <!-- FIDO Principle 6: Hero prompt — consistent icon + headline + CTA + explanation -->
    <div class="passkey-hero" role="region" aria-label="Add a passkey">
      <PasskeyIcon class="hero-icon" aria-hidden="true" />
      <h3>{{ passkeys.length > 0 ? 'Add another passkey' : 'Create a passkey' }}</h3>
      <!-- FIDO Principle 2: Associate passkeys with the familiar -->
      <p>Passkeys are encrypted digital keys you create using your fingerprint, face, or screen lock.</p>

      <!-- FIDO Principle 3: Handshake message before OS dialog -->
      <button @click="handleCreatePasskey" :disabled="creating" class="btn-primary">
        {{ creating ? 'Opening your device...' : (passkeys.length > 0 ? 'Add another passkey' : 'Create a passkey') }}
      </button>

      <!-- FIDO Principle 7: Always visible, never in a tooltip -->
      <p class="passkey-hint">
        Your passkey is securely stored on this device or in your password manager.
        <br/>If you lose access to your device, you can still sign in with your password.
      </p>
    </div>

    <!-- Post-creation success (FIDO Principle 3: handshake after OS dialog) -->
    <div v-if="justCreated" role="alert" aria-live="polite" class="success-banner">
      <CheckIcon aria-hidden="true" />
      Your passkey was created! Next time, just use your fingerprint or face to sign in.
    </div>
  </section>
</template>
```

---

## Cross-Device Upgrade Interstitial

After user signs in from another device (`authenticatorAttachment === 'cross-platform'`):

```vue
<template>
  <dialog :open="showCrossDevicePrompt" aria-modal="true" aria-labelledby="cda-title">
    <PasskeyIcon aria-hidden="true" />
    <h2 id="cda-title">Set up a passkey on this device</h2>
    <p>
      You signed in using your phone. Would you like to use this device for sign-in next time?
      It's faster and works without your phone.
    </p>
    <button @click="registerPasskey(); showCrossDevicePrompt = false">
      Create a passkey on this device
    </button>
    <button @click="showCrossDevicePrompt = false" class="btn-link">Not now</button>
  </dialog>
</template>
```

---

## Post-Password-Login Upgrade Prompt (Gradual Rollout)

After successful password login, offer passkey creation once (dismissible):

```vue
<template>
  <dialog v-if="showUpgradePrompt && !dismissedPasskeyPrompt" aria-modal="true">
    <PasskeyIcon aria-hidden="true" />
    <h2>Sign in faster next time</h2>
    <p>Create a passkey to sign in with just your fingerprint or face — no password needed.</p>
    <button @click="createPasskeyAndDismiss">Create a passkey</button>
    <button @click="dismissPasskeyPrompt" class="btn-link">Not now</button>
  </dialog>
</template>
```

---

## Conditional Create — Automatic Passkey Upgrade (Zero Friction)

The automatic sibling of the prompt above: right after a successful password
sign-in, silently create a passkey in the background — no dialog, no user
action, no interruption. This is the highest-leverage adoption pattern
(required for Rapid rollout; the modal prompt above is the fallback for
browsers without support).

```typescript
// Fire-and-forget immediately after password sign-in succeeds.
// NEVER await this before the post-login redirect.
export async function attemptPasskeyUpgrade(
  authToken: string,
  user: { passkeyCount: number; lastAutoUpgradeAt: string | null },
): Promise<void> {
  // isConditionalCreateAvailable() from §Feature Detection (caps.conditionalCreate)
  if (!(await isConditionalCreateAvailable())) return;

  try {
    // Trigger policy: attempt only when it can plausibly succeed.
    if (user.passkeyCount > 0) return;    // already upgraded
    // Explicit null check — never rely on daysSince(null) returning a
    // particular sentinel. The first-ever attempt (no prior timestamp) must
    // never be skipped, so short-circuit before calling it at all.
    if (user.lastAutoUpgradeAt && daysSince(user.lastAutoUpgradeAt) < 7) return; // weekly cooldown
    // lastAutoUpgradeAt is set server-side on every attempt, success or
    // not — so a declined upgrade isn't retried on every single login.

    const options = await fetch('/auth/passkey/register/challenge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(r => r.json());

    // SimpleWebAuthn v13: useAutoRegister sets mediation: 'conditional' on
    // navigator.credentials.create() — the conditional-create ceremony.
    // Raw API equivalent: navigator.credentials.create({ publicKey, mediation: 'conditional' })
    const { startRegistration } = await import('@simplewebauthn/browser');
    const reg = await startRegistration({ optionsJSON: options, useAutoRegister: true });

    // `source` drives the server's requireUserPresence switch AND metrics —
    // it must be declared in the verify DTO (see backend-integration.md).
    const res = await fetch('/auth/passkey/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ ...reg, source: 'conditional-create' }),
    });
    // fetch() does NOT throw on 4xx/5xx — check explicitly, or you announce a
    // passkey the server rejected and the user has nothing to sign in with.
    if (!res.ok) return;

    showToast(t('passkeys.autoCreated'));  // passive notification AFTER success
  } catch {
    // Silent failure is NORMAL: unsupported provider, no saved password, too
    // long since sign-in, provider declined, or a passkey already exists
    // (InvalidStateError). The user never initiated this flow — never show
    // an error state for it.
  }
}
```

### Constraints (why it silently no-ops)

| Constraint | Detail |
|---|---|
| Browser support | Safari 18+ (iOS 18 / macOS 15), Chrome 136+ desktop, Chrome 142+ Android |
| Saved password required | The browser only upgrades when the just-used password is stored in its credential manager |
| Chrome time window | Runs only within ~5 minutes of the password sign-in; **Google Password Manager makes the final creation decision** |
| Third-party managers | Support varies — Apple Passwords and Google Password Manager are reliable; extension-based managers often no-op |
| `excludeCredentials` | Still mandatory in the options — prevents repeated silent upgrades from duplicating passkeys |

UX rules (no interstitial before, passive confirmation after, never block the
redirect): `references/ux-guidelines.md` §Automatic Passkey Upgrade. Backend
notes (same endpoints, metrics tagging): `references/backend-integration.md`
§Conditional create.

---

## Error Handling Reference

| Error | Cause | User-facing message |
|---|---|---|
| `NotAllowedError` | User cancelled or timed out | "Passkey creation was cancelled. You can try again anytime." |
| `InvalidStateError` | Credential already registered on this device | "A passkey for this account already exists on this device." |
| `NotSupportedError` | Browser/device doesn't support WebAuthn | Hide passkey UI silently |
| `SecurityError` | `rpId` mismatch — always a config bug | Internal only — log, never show to user |
| `AbortError` | Another WebAuthn operation in progress | "Please try again." |
| `NotReadableError` | Authenticator error (e.g. security key issue) | "Could not read your passkey. Try again or use a different method." |
| Network/fetch error | Backend unreachable | "Connection error. Check your internet and try again." |

---

## Passkey Icon

Use the official FIDO Alliance passkey icon (free for use on sites with passkeys enabled):
- Download: https://fidoalliance.org/get-the-passkey-icon/
- Style guide: https://fidoalliance.org/wp-content/uploads/2023/12/FIDO-Passkey_Icon_Usage_Guidelines-August2022.pdf
- Always add `aria-label="Passkey"` or `aria-hidden="true"` + visible text label

---

## Accessibility Checklist (FIDO + WCAG 2.1 AA)

- `autocomplete="username webauthn"` on the username input (enables autofill passkeys)
- All buttons have visible text labels — not icon-only
- `aria-live="polite"` region for post-dialog status messages (creation success/failure)
- `role="alert"` for error messages
- Keyboard fully navigable: create, list, rename, delete passkeys
- Focus returns to trigger element after dialog closes
- Color contrast ≥ 4.5:1 for all passkey UI elements
- "Synced" / "This device only" badge uses both icon and text (not color alone)
- Screen reader tested with VoiceOver (iOS/macOS) and TalkBack (Android)
- Reference: https://fidoalliance.org/white-paper-guidance-for-making-fido-deployments-accessible-to-users-with-disabilities/

---

## Nuxt 3 / Next.js (SSR) Notes

WebAuthn is browser-only. Never import `@simplewebauthn/browser` during SSR:

```typescript
// Nuxt 3 — client-only plugin
// plugins/passkey.client.ts
export default defineNuxtPlugin(async () => {
  const { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } =
    await import('@simplewebauthn/browser');
  return { provide: { passkeySupported: browserSupportsWebAuthn() } };
});

// Or in composable: wrap in onMounted / process.client check
onMounted(async () => {
  const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
  isSupported.value = browserSupportsWebAuthn();
});
```

```typescript
// Next.js — dynamic import in useEffect
useEffect(() => {
  import('@simplewebauthn/browser').then(({ browserSupportsWebAuthn }) => {
    setSupported(browserSupportsWebAuthn());
  });
}, []);
```

---

## Design System Adaptation (required before writing any UI)

Passkey UI must not look like a foreign component. Before writing any passkey
component, inspect the existing codebase to identify the design system.

### Detection — what to look for

```bash
# Check package.json for component libraries
grep -E '"(@mui|@chakra-ui|@shadcn|antd|bootstrap|@mantine|primereact|primevue|vuetify|@angular/material|daisyui)"' package.json

# Check for Tailwind
grep -l "tailwind" tailwind.config.* postcss.config.* 2>/dev/null

# Find existing button/card components to understand naming conventions
find src -name "Button.*" -o -name "Card.*" -o -name "Modal.*" | grep -v node_modules | head -10
```

### Adaptation rules

| Detected system | Use for passkey buttons | Use for passkey cards | Use for modals |
|---|---|---|---|
| MUI | `<Button variant="contained">` | `<Card>` + `<CardContent>` | `<Dialog>` |
| shadcn/ui | `<Button>` | `<Card>` + `<CardContent>` | `<Dialog>` |
| Chakra UI | `<Button colorScheme="blue">` | `<Box>` + `<Stack>` | `<Modal>` |
| Ant Design | `<Button type="primary">` | `<Card>` | `<Modal>` |
| Bootstrap | `<button class="btn btn-primary">` | `<div class="card">` | `<div class="modal">` |
| Mantine | `<Button variant="filled">` | `<Card>` | `<Modal>` |
| Tailwind (no lib) | Use existing utility class patterns from sign-in page | Match existing card patterns | Match existing modal patterns |

**When no design system exists** (raw CSS or CSS modules): copy the exact class
names and markup structure from the sign-in page's existing form buttons and inputs.

### What to inspect before coding

1. Open the sign-in page (`/login`, `/signin`, or equivalent)
2. Note the exact component and class used for the primary action button
3. Note how errors are shown (inline red text? toast? banner?)
4. Note how loading states work (spinner inside button? disabled + spinner overlay?)
5. Open Account Settings (or any settings page) and note the card/section layout
6. Use these patterns verbatim for all passkey UI

---

## Framework-Specific Patterns and Anti-Patterns

### React

**Recommended pattern: custom hook**

```typescript
// hooks/usePasskey.ts
export function usePasskey() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optionsRes = await fetch('/auth/passkey/register/challenge', { method: 'POST', ... });
      const options = await optionsRes.json();
      const credential = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!verifyRes.ok) throw new Error('Verification failed');
      await refresh();
    } catch (e) {
      setError(getPasskeyErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => { ... }, []);
  const remove = useCallback(async (id: string) => { ... }, []);
  const refresh = useCallback(async () => { ... }, []);

  return { passkeys, loading, error, register, rename, remove, refresh };
}
```

**Anti-patterns to avoid:**
- Calling `startRegistration()` directly in `onClick` without a loading guard — causes double-fire in React StrictMode
- Storing challenge or credential response in state — challenges are server-side only
- Using `useEffect` with no cleanup for the conditional UI `startAuthentication` call — causes memory leaks on unmount
- Sharing a single `loading` state between background autofill and the explicit button — disables the button while the browser waits indefinitely

**React — Two Loading States (required for sign-in page)**

The conditional UI promise is long-lived — it resolves only when the user picks
a passkey from the autofill dropdown. If one `loading` flag covers both the
background autofill and the explicit button, the button is permanently disabled.

```typescript
// hooks/usePasskeySignIn.ts
export function usePasskeySignIn() {
  const [autofillPending, setAutofillPending] = useState(false); // background — does NOT block button
  const [loading, setLoading] = useState(false);                 // explicit button only
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Start conditional UI on mount — runs silently in background
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      try {
        setAutofillPending(true);
        const { startAuthentication } = await import('@simplewebauthn/browser');
        const optionsRes = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' });
        const options = await optionsRes.json();
        const credential = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true, signal: ac.signal });
        await verifyAndNavigate(credential);
      } catch (err: any) {
        if (err.name !== 'AbortError') console.info('Conditional UI:', err.name);
        // AbortError is expected cleanup — never show to user
      } finally {
        setAutofillPending(false);
      }
    })();
    return () => ac.abort(); // cancel on unmount
  }, []);

  // Explicit button handler — abort conditional UI first, then start modal
  const signInWithPasskey = async () => {
    abortRef.current?.abort(); // REQUIRED: browser allows only one active WebAuthn request
    abortRef.current = null;
    setLoading(true);
    setError(null);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optionsRes = await fetch('/auth/passkey/authenticate/challenge', { method: 'POST' });
      const options = await optionsRes.json();
      const credential = await startAuthentication({ optionsJSON: options }); // no autofill
      await verifyAndNavigate(credential);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setError('Cancelled — you can try again any time.');
      else if (err.name === 'InvalidStateError') setError('A passkey already exists on this device.');
      else setError('Something went wrong. Try again or use your password.');
    } finally {
      setLoading(false);
    }
  };

  // Button: disabled only on explicit loading, NOT on autofillPending
  // <Button disabled={loading} onClick={signInWithPasskey}>Sign in with a passkey</Button>
  return { signInWithPasskey, loading, error };
}
```

**MUI — PasskeyList: fix `<div> cannot be a descendant of <p>`**

MUI `ListItemText` renders its `secondary` slot as `<p>` by default. `<Chip>`
renders as `<div>` — a `<div>` inside a `<p>` is invalid HTML and triggers a
React hydration warning. Fix with `secondaryTypographyProps={{ component: 'div' }}`:

```typescript
<ListItemText
  primary={passkey.name || 'Passkey'}
  secondary={
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
      <Chip size="small" label={passkey.deviceType} />
      <Chip size="small" label={passkey.backedUp ? 'Synced' : 'Device-bound'} />
    </Box>
  }
  primaryTypographyProps={{ fontWeight: 700 }}
  secondaryTypographyProps={{ component: 'div' }}  // prevents <div> inside <p>
/>
```

### Vue 3

**Recommended pattern: composable**

```typescript
// composables/usePasskey.ts
export function usePasskey() {
  const passkeys = ref<Passkey[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const register = async () => { ... };
  const rename = async (id: string, name: string) => { ... };
  const remove = async (id: string) => { ... };

  return { passkeys, loading, error, register, rename, remove };
}
```

**Anti-patterns to avoid:**
- Forgetting `onUnmounted` cleanup for the conditional UI `startAuthentication` abort controller
- Using `options API` (`this.$`) for passkey state when the rest of the app uses Composition API
- Importing `@simplewebauthn/browser` at the top level in a Nuxt app — the package uses browser APIs unavailable during SSR; always use dynamic import inside `onMounted`

**Nuxt / Vue 3 — dynamic import pattern (required for SSR)**

```typescript
// composables/usePasskey.ts
export function usePasskey() {
  const isSupported = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  onMounted(async () => {
    // Dynamic import prevents SSR errors — @simplewebauthn/browser uses window/navigator
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
    isSupported.value = browserSupportsWebAuthn();
  });

  const register = async () => {
    loading.value = true;
    error.value = null;
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const options = await $fetch('/api/v1/auth/passkey/register/challenge/', { method: 'POST' });
      const credential = await startRegistration({ optionsJSON: options });
      await $fetch('/api/v1/auth/passkey/register/verify/', { method: 'POST', body: credential });
    } catch (e: any) {
      error.value = e.name === 'NotAllowedError'
        ? 'Passkey creation was cancelled.'
        : 'Unable to create passkey. Please try again.';
    } finally {
      loading.value = false;
    }
  };

  const authenticate = async () => {
    loading.value = true;
    error.value = null;
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const options = await $fetch('/api/v1/auth/passkey/authenticate/challenge/', { method: 'POST' });
      const credential = await startAuthentication({ optionsJSON: options });
      await $fetch('/api/v1/auth/passkey/authenticate/verify/', { method: 'POST', body: credential });
      await navigateTo('/dashboard');  // always navigate after successful verify
    } catch (e: any) {
      error.value = e.name === 'NotAllowedError'
        ? 'Cancelled — you can try again any time.'
        : 'Sign-in failed. Try another method.';
    } finally {
      loading.value = false;
    }
  };

  return { isSupported, loading, error, register, authenticate };
}
```

### Angular

**Recommended pattern: injectable service**

```typescript
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private passkeys$ = new BehaviorSubject<Passkey[]>([]);
  passkeys = this.passkeys$.asObservable();

  register(): Observable<void> { ... }
  rename(id: string, name: string): Observable<Passkey> { ... }
  remove(id: string): Observable<void> { ... }
  refresh(): Observable<Passkey[]> { ... }
}
```

**Anti-patterns to avoid:**
- Not unsubscribing from passkey observables in `ngOnDestroy` — use `takeUntilDestroyed()` (Angular 16+) or `destroy$` subject
- Importing `@simplewebauthn/browser` at the module level in an SSR-enabled app — use dynamic `import()` inside `isPlatformBrowser()` guard

### Next.js App Router

**Anti-patterns to avoid:**
- Marking the entire settings page `'use client'` to avoid the WebAuthn check — instead, split: keep the page as a Server Component and extract passkey UI into a separate `PasskeySection` client component
- Not handling the hydration mismatch from `isWebAuthnSupported()` returning `false` on the server — use `useState(false)` initialized in `useEffect`

```typescript
// Correct: hydration-safe WebAuthn support check
const [supported, setSupported] = useState(false);
useEffect(() => {
  setSupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
}, []);
```

### SvelteKit

**Anti-patterns to avoid:**
- Importing `@simplewebauthn/browser` at the top level in a `+page.svelte` file — use `onMount` with dynamic import
- Using `$page.data` (server load data) for passkey list without a `invalidate()` call after register/delete
