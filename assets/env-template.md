# Environment Variable Template

Copy these to your `.env` (or `.env.local` for dev). Required for all
backend frameworks. Adjust values per environment.

```env
# ── WebAuthn / Passkey configuration ─────────────────────────────────────

# The effective domain of your app — NO port, NO protocol, NO path
# Dev:     localhost
# Staging: staging.example.com
# Prod:    example.com  (or app.example.com for subdomain-scoped passkeys)
RP_ID=localhost

# The full origin of your app — WITH protocol, WITH port if non-standard
# Dev:     http://localhost:3000
# Staging: https://staging.example.com
# Prod:    https://example.com
APP_ORIGIN=http://localhost:3000

# Shown in the device's passkey creation dialog (e.g. "Save passkey for MyApp")
APP_NAME=MyApp

# How long a challenge remains valid (seconds). Max recommended: 300 (5 min).
# Increase to 600 for users likely to use cross-device (hybrid) flow.
PASSKEY_CHALLENGE_TTL=300
```

## Per-framework notes

### NestJS / Express / Fastify
```typescript
// passkey.config.ts
export const rpConfig = {
  rpName:          process.env.APP_NAME    ?? 'MyApp',
  rpID:            process.env.RP_ID       ?? 'localhost',
  expectedOrigins: [process.env.APP_ORIGIN ?? 'http://localhost:3000'],
};
```

### Django
```python
# settings.py
RP_ID      = os.environ['RP_ID']        # e.g. 'localhost'
APP_ORIGIN = os.environ['APP_ORIGIN']   # e.g. 'http://localhost:8000'
APP_NAME   = os.environ.get('APP_NAME', 'MyApp')
```

### Spring Boot
```yaml
# application.yml
passkeys:
  rp-id:   ${RP_ID:localhost}
  origin:  ${APP_ORIGIN:http://localhost:8080}
  rp-name: ${APP_NAME:MyApp}
```

### Laravel
```php
// config/passkeys.php
return [
    'rp_id'  => env('RP_ID', 'localhost'),
    'origin' => env('APP_ORIGIN', 'http://localhost:8000'),
    'rp_name'=> env('APP_NAME', config('app.name')),
];
```

### Go
```go
// config/passkey.go
type PasskeyConfig struct {
    RPID    string // os.Getenv("RP_ID")
    Origin  string // os.Getenv("APP_ORIGIN")
    RPName  string // os.Getenv("APP_NAME")
}
```

## Common misconfiguration errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| Ceremony always fails with no clear error | rpID contains protocol or port | Remove `https://` and `:3000` from RP_ID |
| "Registration failed" on verify | Origin mismatch | APP_ORIGIN must exactly match the browser's origin header |
| Works in dev, fails in staging | http vs https | Use `https://` in APP_ORIGIN for all non-localhost environments |
| Works on `example.com`, fails on `sub.example.com` | rpID too narrow | Set RP_ID=example.com to cover all subdomains |
