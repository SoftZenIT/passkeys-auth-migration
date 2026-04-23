# Frontend Integration Reference

## Core Concepts

The frontend is responsible for:
1. Calling the browser's WebAuthn API (`navigator.credentials.create` and `navigator.credentials.get`)
2. Communicating with the backend (challenge → device → verify)
3. Providing FIDO-compliant UX (see ux-guidelines.md)
4. Handling errors gracefully and offering fallback

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

// Is Conditional UI (autofill passkeys) supported? — needed for sign-in page
export const isConditionalUIAvailable = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;
  return typeof PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
    PublicKeyCredential.isConditionalMediationAvailable();
};
```

Rules:
- `isPlatformAuthAvailable()` → false: hide "Create passkey" UI silently (no error)
- `isConditionalUIAvailable()` → false: skip conditional init, show explicit button only

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
    // User dismissed autofill or selected password → do NOT show error
    // This is expected, fall through to normal form flow
    console.info('Conditional UI not resolved:', err.name);
  }
}
```

### Key behaviour
- User focuses on username input → passkeys appear in autofill dropdown alongside saved passwords
- User selects passkey → device biometric prompt → automatic sign-in
- User selects password → conditional promise never resolves → password form works normally
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

    // No useBrowserAutofill → shows modal passkey picker immediately
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
