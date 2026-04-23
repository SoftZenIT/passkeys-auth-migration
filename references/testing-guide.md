# Testing Guide

Sources:
- Google Codelabs: Passkeys with Form Autofill
- Chrome DevTools WebAuthn Emulation documentation
- passkeys.dev reference documentation
- SimpleWebAuthn testing documentation

---

## Why passkey testing requires special attention

`navigator.credentials.create()` and `navigator.credentials.get()` are
hardware-bound browser APIs. They require:
- HTTPS (or localhost)
- A real or emulated authenticator
- User interaction (gesture-required — can't be auto-clicked in headless mode)

This means standard mocking approaches won't work without deliberate setup.

---

## Level 1 — Unit Tests (server-side logic)

Test your WebAuthn service functions in isolation by mocking the library.
No browser or authenticator needed.

### Mocking challenge generation
```typescript
// Jest / Vitest — mock @simplewebauthn/server
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({
    challenge: 'dGVzdC1jaGFsbGVuZ2U',
    rp: { name: 'Test App', id: 'localhost' },
    user: { id: 'dXNlci1pZA', name: 'test@example.com', displayName: 'Test User' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60000,
    excludeCredentials: [],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  }),
  verifyRegistrationResponse: jest.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: Buffer.from('credential-id'),
        publicKey: Buffer.from('public-key-bytes'),
        counter: 0,
      },
      aaguid: '08987058-cadc-4b81-b6e1-30de50dcbe96',
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  }),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({
    challenge: 'YXV0aC1jaGFsbGVuZ2U',
    rpId: 'localhost',
    allowCredentials: [],
    userVerification: 'preferred',
    timeout: 300000,
  }),
  verifyAuthenticationResponse: jest.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));
```

### Testing challenge hygiene (most critical unit test)
```typescript
it('deletes challenge after successful verification', async () => {
  const deleteSpy = jest.spyOn(challengeStore, 'delete');
  await passkeyService.verifyAuthentication(mockBody, mockSessionId);
  expect(deleteSpy).toHaveBeenCalledWith(mockSessionId);
});

it('deletes challenge even when verification fails', async () => {
  const deleteSpy = jest.spyOn(challengeStore, 'delete');
  verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
  await expect(
    passkeyService.verifyAuthentication(mockBody, mockSessionId)
  ).rejects.toThrow();
  expect(deleteSpy).toHaveBeenCalledWith(mockSessionId); // must still be called
});
```

### Testing counter validation
```typescript
it('rejects authentication when counter is not advancing', async () => {
  // Simulate a cloned authenticator: new counter equals stored counter
  verifyAuthenticationResponse.mockRejectedValueOnce(
    new Error('Counter did not increase')
  );
  await expect(
    passkeyService.verifyAuthentication(mockBody, mockSessionId)
  ).rejects.toThrow();
});
```

### Python (pytest) example
```python
from unittest.mock import patch, MagicMock

@patch('webauthn.verify_registration_response')
def test_challenge_deleted_on_failure(mock_verify, client, django_user):
    mock_verify.side_effect = Exception('Verification failed')
    session = client.session
    session['passkey_challenge'] = b'test-challenge'
    session.save()

    response = client.post('/auth/passkey/register/verify/', data={...})
    # Even on failure, challenge must be gone
    assert 'passkey_challenge' not in client.session
```

---

## Level 2 — Integration Tests (endpoint testing)

Test your API endpoints with real HTTP calls and a mock WebAuthn response.
Use your language's HTTP testing library with pre-computed WebAuthn fixtures.

### Generate test fixtures once
Run this once to generate a real WebAuthn credential response for testing:
```bash
# Using SimpleWebAuthn's built-in test tools
npx ts-node -e "
  const { isoBase64URL } = require('@simplewebauthn/server/helpers');
  // Generate a deterministic test credential ID for integration tests
  console.log(isoBase64URL.fromBuffer(Buffer.from('test-credential-id-12345')));
"
```

### NestJS / Express integration test skeleton
```typescript
import * as request from 'supertest';
import { app } from '../src/app';

// A pre-computed valid registration response for testing
const MOCK_REGISTRATION_BODY = {
  id: 'dGVzdC1jcmVkZW50aWFsLWlk',
  rawId: 'dGVzdC1jcmVkZW50aWFsLWlk',
  type: 'public-key',
  response: {
    clientDataJSON: '...',     // base64url
    attestationObject: '...',  // base64url
    transports: ['internal'],
  },
};

describe('Passkey registration', () => {
  it('POST /auth/passkey/register/challenge returns options', async () => {
    const token = await getTestUserToken();
    const res = await request(app)
      .post('/auth/passkey/register/challenge')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(res.body).toHaveProperty('rp.id');
    expect(res.body.excludeCredentials).toBeDefined();
  });

  it('DELETE /auth/passkey/:id requires ownership check', async () => {
    const otherUserToken = await getTestUserToken({ userId: 'other-user' });
    const res = await request(app)
      .delete('/auth/passkey/some-credential-id')
      .set('Authorization', `Bearer ${otherUserToken}`);
    // Must reject — cannot delete another user's passkey
    expect(res.status).toBe(404);
  });
});
```

---

## Level 3 — E2E Tests with Virtual Authenticator

Chrome's DevTools Protocol (CDP) exposes a virtual authenticator that can
simulate passkey ceremonies without hardware. Works in Playwright and Puppeteer.

### Playwright — Virtual Authenticator Setup
```typescript
import { test, expect, chromium } from '@playwright/test';

test.describe('Passkey registration flow', () => {
  test('user can register a passkey', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Enable virtual authenticator via CDP
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,   // simulates biometric success
      },
    });

    await page.goto('https://localhost:3000/login');
    await page.click('#create-passkey-button');

    // Virtual authenticator automatically handles the dialog
    await expect(page.locator('#passkey-success-message')).toBeVisible();

    // Verify passkey appears in account settings
    await page.goto('https://localhost:3000/account/security');
    await expect(page.locator('.passkey-card')).toHaveCount(1);

    await browser.close();
  });

  test('passkey conditional UI appears on username field', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const client = await context.newCDPSession(page);

    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    // First register a credential
    await page.goto('https://localhost:3000/account/security');
    await page.click('#add-passkey');
    await expect(page.locator('#passkey-card-0')).toBeVisible();

    // Now test conditional UI on login page
    await page.goto('https://localhost:3000/login');
    await page.focus('#username-input');
    // Browser autofill suggestions appear — virtual authenticator auto-selects
    await expect(page).toHaveURL('https://localhost:3000/dashboard');

    await browser.close();
  });
});
```

### Puppeteer equivalent
```javascript
const puppeteer = require('puppeteer');

async function setupVirtualAuthenticator(page) {
  const client = await page.createCDPSession();
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return { client, authenticatorId };
}
```

---

## Level 4 — CI/CD Configuration

### GitHub Actions — HTTPS in CI for WebAuthn
WebAuthn requires HTTPS. Use a self-signed certificate for CI:

```yaml
# .github/workflows/passkey-tests.yml
name: Passkey E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate self-signed certificate for localhost
        run: |
          openssl req -x509 -nodes -newkey rsa:4096 \
            -keyout localhost.key \
            -out localhost.crt \
            -days 1 \
            -subj "/CN=localhost" \
            -addext "subjectAltName=DNS:localhost"

      - name: Start app with HTTPS
        run: |
          SSL_CERT=./localhost.crt SSL_KEY=./localhost.key npm start &
          npx wait-on https://localhost:3000 --timeout 30000
        env:
          RP_ID: localhost
          APP_ORIGIN: https://localhost:3000
          NODE_TLS_REJECT_UNAUTHORIZED: '0'  # allow self-signed in tests only

      - name: Run Playwright tests
        run: npx playwright test
        env:
          PLAYWRIGHT_BASE_URL: https://localhost:3000
```

### Environment variables for tests

```bash
# .env.test
RP_ID=localhost
APP_ORIGIN=http://localhost:3000     # Use HTTP for unit/integration (no TLS needed)
PASSKEY_CHALLENGE_TTL=60            # Shorter TTL in tests for faster cleanup
NODE_ENV=test

# For E2E tests with HTTPS:
APP_ORIGIN=https://localhost:3000
```

### Django CI example
```yaml
- name: Run Django passkey tests
  run: |
    python manage.py test passkeys.tests --verbosity=2
  env:
    RP_ID: localhost
    APP_ORIGIN: http://localhost:8000
    DJANGO_SETTINGS_MODULE: myapp.settings.test
```

### Jest configuration for passkey unit tests
```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterFramework: ['./tests/setup/mock-webauthn.js'],
  // Do NOT use jsdom for passkey server tests — jsdom lacks WebCrypto
};
```

---

## Checklist before going to production

- [ ] Unit tests cover challenge deletion in both success and failure paths
- [ ] Unit tests cover counter validation (replay rejection)
- [ ] Integration tests verify ownership checks on DELETE endpoint
- [ ] Integration tests verify unauthenticated access is rejected on protected endpoints
- [ ] E2E test covers registration → authentication → passkey card displayed
- [ ] E2E test covers conditional UI appearing on login page
- [ ] E2E test covers passkey delete flow
- [ ] CI runs on HTTPS (required for WebAuthn in headful browser tests)
- [ ] Tests use short challenge TTL (60 seconds) to avoid timing issues
- [ ] Cross-browser tested manually: Chrome, Safari, Firefox, Edge
- [ ] Mobile tested: iOS Safari, Chrome for Android
