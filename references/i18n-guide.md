# Internationalization (i18n) Guide

Load this file during Phase 2 when `i18n_detected = true` was set in Phase 0.

---

## Detection Signals (Phase 0)

The following signals indicate i18n is in use. If any match, all passkey UI
strings must use the project's translation function — never hardcoded English.

**Package signals (package.json `dependencies` or `devDependencies`):**
```
i18next, react-i18next, react-intl, @formatjs/intl
vue-i18n, @nuxtjs/i18n
@angular/localize, @ngx-translate/core
next-intl, next-i18next
svelte-i18n, @inlang/paraglide-js
lingui, @lingui/react
```

**File system signals:**
```
public/locales/
src/i18n/
src/locales/
locales/
messages/
*.messages.ts, *.strings.ts
```

---

## Key Catalog — English Defaults

Add these keys to your English translation file. Use the exact key names shown
so teams can find and update them consistently.

```json
{
  "passkeys": {
    "heroHeadline": "Create a passkey",
    "heroBenefitShort": "Sign in faster using your fingerprint, face, or screen lock — no password needed.",
    "heroBenefitLong": "Passkeys are encrypted digital keys stored securely on your device. You create one using your fingerprint, face, or screen lock. Next time you sign in, just verify with your device — no password to remember or type.",
    "createButton": "Create a passkey",
    "createSubnote": "Your passkey is stored on this device or in your password manager. If you lose your device, you can still sign in with your password.",
    "signInButton": "Sign in with a passkey",
    "signInSubLabel": "Use your fingerprint, face, or screen lock",
    "addAnotherButton": "Add another passkey",

    "handshake": {
      "registerBefore": "We'll ask your device to save a passkey. You may be prompted for your fingerprint, face, or screen lock.",
      "authBefore": "Select your passkey to sign in. Your device will ask you to verify with your fingerprint, face, or screen lock."
    },

    "result": {
      "registerSuccess": "Your passkey was created! Next time, just use your fingerprint or face to sign in — no password needed.",
      "registerCancelled": "Passkey creation was cancelled. You can create one anytime from your account settings.",
      "authSuccess": "Signed in with your passkey.",
      "authCancelled": "Sign-in was cancelled. Use your password to sign in instead."
    },

    "card": {
      "syncedLabel": "Synced across your devices",
      "deviceOnlyLabel": "Saved to this device only",
      "createdOn": "Created {{date}}",
      "lastUsed": "Last used {{date}}",
      "lastUsedNever": "Never used",
      "renameButton": "Rename",
      "renameInputPlaceholder": "e.g. Work MacBook, iPhone 15",
      "renameSave": "Save",
      "renameCancel": "Cancel",
      "deleteButton": "Remove"
    },

    "naming": {
      "postCreationPromptHeadline": "Name this passkey (optional)",
      "postCreationSave": "Save name",
      "postCreationSkip": "Skip"
    },

    "deleteConfirm": {
      "title": "Remove this passkey?",
      "body": "You will no longer be able to sign in with this passkey. You can still sign in with your password or another passkey.",
      "confirm": "Remove",
      "cancel": "Cancel"
    },

    "nudge": {
      "headline": "Sign in faster next time",
      "body": "Create a passkey to sign in with just your fingerprint or face — no password needed.",
      "cta": "Create a passkey",
      "dismiss": "Not now"
    },

    "crossDevice": {
      "headline": "Set up a passkey on this device",
      "body": "You signed in using your phone. Would you like to use this device next time instead? It's faster and works without your phone nearby.",
      "cta": "Create a passkey on this device",
      "dismiss": "Not now"
    },

    "errors": {
      "cancelled": "Cancelled. Try again anytime.",
      "alreadyExists": "A passkey for this device already exists. You can manage your passkeys in Account Settings.",
      "timedOut": "Sign-in timed out. Try again or use your password.",
      "notFound": "We couldn't find that passkey. Try another sign-in method.",
      "generic": "Something went wrong. Please try again or use your password.",
      "setupCancelled": "Passkey setup was cancelled. You can set one up anytime in Account Settings.",
      "setupTimedOut": "Passkey setup timed out. Try again when you're ready.",
      "maxReached": "You've reached the maximum number of passkeys. Remove an existing passkey before adding a new one."
    }
  }
}
```

---

## Per-Framework Implementation Examples

### react-i18next

```typescript
// Install: npm install react-i18next i18next
// Add keys to public/locales/en/translation.json (or your i18next namespace)

import { useTranslation } from 'react-i18next';

export function PasskeyHero() {
  const { t } = useTranslation();
  return (
    <section>
      <h2>{t('passkeys.heroHeadline')}</h2>
      <p>{t('passkeys.heroBenefitShort')}</p>
      <button onClick={handleCreate}>{t('passkeys.createButton')}</button>
    </section>
  );
}

// Error handling:
function getErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') return t('passkeys.errors.cancelled');
    if (error.name === 'InvalidStateError') return t('passkeys.errors.alreadyExists');
    if (error.name === 'AbortError') return t('passkeys.errors.timedOut');
  }
  return t('passkeys.errors.generic');
}
```

### vue-i18n (Vue 3 Composition API)

```typescript
// Install: npm install vue-i18n
// Add keys to src/locales/en.json

import { useI18n } from 'vue-i18n';

// In setup() or <script setup>:
const { t } = useI18n();

// Template:
// <h2>{{ t('passkeys.heroHeadline') }}</h2>
// <button @click="createPasskey">{{ t('passkeys.createButton') }}</button>
// <p v-if="error">{{ t('passkeys.errors.cancelled') }}</p>
```

```json
// src/locales/en.json — add the passkeys object from the key catalog above
```

### next-intl (Next.js App Router)

```typescript
// Install: npm install next-intl
// Add keys to messages/en.json

import { useTranslations } from 'next-intl';

export function PasskeyHero() {
  const t = useTranslations('passkeys');
  return (
    <section>
      <h2>{t('heroHeadline')}</h2>
      <p>{t('heroBenefitShort')}</p>
      <button>{t('createButton')}</button>
    </section>
  );
}

// messages/en.json: use the key catalog above (the `passkeys` object)
```

### next-i18next (Next.js Pages Router)

```typescript
// Install: npm install next-i18next react-i18next
// Add keys to public/locales/en/passkeys.json (separate namespace)

import { useTranslation } from 'next-i18next';

export function PasskeyHero() {
  const { t } = useTranslation('passkeys'); // namespace = 'passkeys'
  return <button>{t('createButton')}</button>;
}

// In getStaticProps or getServerSideProps:
// serverSideTranslations(locale, ['common', 'passkeys'])
```

### Angular i18n (@angular/localize)

```typescript
// The $localize template tag works at compile time.
// Keys must be in the source — no runtime key lookup.

@Component({
  template: `
    <h2 i18n="@@passkeys.heroHeadline">Create a passkey</h2>
    <button i18n="@@passkeys.createButton">Create a passkey</button>
    <p *ngIf="error" i18n="@@passkeys.errors.cancelled">Cancelled. Try again anytime.</p>
  `
})
export class PasskeyHeroComponent {}

// Extract with: ng extract-i18n --output-path src/i18n
// Translate the generated messages.xlf file
```

### ngx-translate (Angular alternative)

```typescript
import { TranslateService } from '@ngx-translate/core';

@Component({
  template: `
    <h2>{{ 'passkeys.heroHeadline' | translate }}</h2>
    <button>{{ 'passkeys.createButton' | translate }}</button>
  `
})
export class PasskeyHeroComponent {}

// assets/i18n/en.json: add the passkeys object from the key catalog
```

### SvelteKit + svelte-i18n

```typescript
// Install: npm install svelte-i18n
// src/lib/i18n.ts — initialize svelte-i18n
// src/lib/locales/en.json — add passkeys keys

import { _ } from 'svelte-i18n';

// In Svelte component:
// <h2>{$_('passkeys.heroHeadline')}</h2>
// <button on:click={createPasskey}>{$_('passkeys.createButton')}</button>
```

### SvelteKit + Paraglide (@inlang/paraglide-js)

```typescript
// Install: npm install @inlang/paraglide-js-adapter-sveltekit
// messages/en.json: add passkeys object

import * as m from '$lib/paraglide/messages.js';

// <h2>{m.passkeys_heroHeadline()}</h2>
// Note: Paraglide uses underscore_separated keys from the dot-notation
// passkeys.heroHeadline → m.passkeys_heroHeadline()
```

---

## Key Naming Rules

1. **Namespace prefix**: Always `passkeys.*` — keeps all passkey strings
   findable together and avoids collisions with app-level keys.
2. **No dynamic text in keys**: Use template variables (`{{date}}`, `{{name}}`)
   for interpolated values, not key concatenation.
3. **One key per distinct string**: Don't reuse a key for visually similar but
   semantically different text (e.g., different cancel buttons in different flows).
4. **Flat vs nested**: Match the project's existing convention. If the app uses
   `auth.login.button`, prefer `passkeys.createButton`. If it uses dot-paths,
   use `passkeys.card.syncedLabel`.

---

## Interpolated Keys

Some strings require dynamic values. Use your framework's interpolation syntax:

| Key | Variable | Example output |
|-----|----------|---------------|
| `passkeys.card.createdOn` | `{{date}}` | "Created Jan 5, 2025" |
| `passkeys.card.lastUsed` | `{{date}}` | "Last used 2 days ago" |

```typescript
// react-i18next:
t('passkeys.card.createdOn', { date: format(passkey.createdAt, 'MMM d, yyyy') })

// vue-i18n:
t('passkeys.card.createdOn', { date: formatDate(passkey.createdAt) })

// next-intl:
t('card.createdOn', { date: new Date(passkey.createdAt) })
// next-intl handles Date objects natively with locale-aware formatting
```
