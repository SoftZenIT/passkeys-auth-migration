# Backend Integration Reference

## Google-Recommended Database Schema (from Google Identity Passkeys Guide)

Google's official guidance recommends splitting user identity to keep passkeys PII-free:

```
Users table:
  user_id          UUID  PK   -- main user identity (may become de-facto PII)
  username         TEXT       -- editable, may change
  passkey_user_id  UUID  UQ   -- PII-free, stable, used as user.id in WebAuthn
                                 Never set as PK (PKs tend to leak as PII)

Passkeys table:
  id               UUID  PK
  passkey_user_id  UUID  FK -- users.passkey_user_id   ON DELETE CASCADE
  credential_id    BYTES UQ  -- use as PK in credential lookups
  public_key       BYTES
  counter          BIGINT    -- CRITICAL: replay attack protection
  device_type      VARCHAR   -- "singleDevice" | "multiDevice"
  backed_up        BOOL      -- synced across devices? (BE flag)
  transports       ARRAY     -- ["internal","hybrid","usb","nfc","ble"]
  aaguid           VARCHAR   -- passkey provider ID (Google PM, iCloud, etc.)
  name             VARCHAR   -- display name, can be derived from aaguid
  created_at       TIMESTAMPTZ
  last_used_at     TIMESTAMPTZ
```

**Why `passkey_user_id` separate from `user_id`?**

- `user.id` in WebAuthn must be free of PII (per W3C spec)
- The authenticator returns it as `userHandle` in auth responses
- Use it to look up the user during discoverable credential auth (no username provided)

**Why store `aaguid`?**

- Identifies the passkey provider: Google Password Manager, iCloud Keychain, 1Password, Dashlane…
- Use the [FIDO MDS AAGUID list](https://mds3.fidoalliance.org/) to display the provider name in Account Settings UI
- Gives users meaningful passkey card labels ("Google Password Manager · iPhone 14")

---

## Core WebAuthn Concepts for the Backend

The backend (Relying Party server) is responsible for:

1. Generating challenges (random, unpredictable, single-use)
2. Verifying registration responses (storing credential public key)
3. Verifying authentication responses (validating signature with stored public key)
4. Managing credential lifecycle (list, delete)

### Two ceremonies

**Registration (create passkey)**

1. Client calls `/auth/passkey/register/challenge` -> server returns challenge + options
2. Client calls `navigator.credentials.create()` -> device creates key pair, returns credential
3. Client calls `/auth/passkey/register/verify` -> server verifies & stores public key

**Authentication (sign in with passkey)**

1. Client calls `/auth/passkey/authenticate/challenge` -> server returns challenge + allowed credentials
2. Client calls `navigator.credentials.get()` -> device signs challenge with private key
3. Client calls `/auth/passkey/authenticate/verify` -> server verifies signature -> issues session/token

---

## NestJS + Prisma + PostgreSQL (Full Example)

### Install

```bash
npm install @simplewebauthn/server@^11   # v11+ required — verifyAuthenticationResponse API changed in v11
# @simplewebauthn/browser is for the frontend — install it there, not here
# npm install @simplewebauthn/browser@^11
```

### Prisma Schema (additive — do not touch existing User model columns)

```prisma
model Passkey {
  id             String   @id @default(cuid())
  userId         String
  credentialId   Bytes    @unique        // WebAuthn credential ID (raw bytes)
  publicKey      Bytes                   // COSE-encoded public key
  counter        BigInt   @default(0)   // Signature counter (replay protection)
  deviceType     String                  // "singleDevice" | "multiDevice"
  backedUp       Boolean  @default(false)
  transports     String[] @default([])  // ["internal","hybrid","usb",...]
  aaguid         String?                 // Passkey provider AAGUID (for display name)
  name           String?                 // Derived from aaguid or user-assigned
  createdAt      DateTime @default(now())
  lastUsedAt     DateTime?
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// Add to existing User model — two lines only:
// passkeys       Passkey[]
// passkeyUserId  String?  @unique  // PII-free UUID for WebAuthn user.id
```

### NestJS Module Structure

```
auth/
  passkey/
    passkey.module.ts
    passkey.service.ts
    passkey.controller.ts
    passkey.guard.ts       (optional: protect passkey-required routes)
    dto/
      register-challenge.dto.ts
      register-verify.dto.ts
      authenticate-challenge.dto.ts
      authenticate-verify.dto.ts
```

### RP Configuration (environment-aware)

```typescript
// passkey.config.ts
export const rpConfig = {
  rpName: process.env.APP_NAME ?? "My App",
  rpID: process.env.RP_ID ?? "localhost", // domain only, no port, no protocol
  origin: process.env.APP_ORIGIN ?? "http://localhost:3000", // full origin
  expectedOrigins: process.env.APP_ORIGIN
    ? [process.env.APP_ORIGIN]
    : ["http://localhost:3000"],
};
```

> ⚠️ rpID MUST match the effective domain. For `https://app.example.com`, rpID = `app.example.com` or `example.com` (broader). Wrong rpID = ceremony always fails.

> For framework-specific environment variable configuration (Django, Spring Boot,
> Laravel, Go), see `assets/env-template.md`. It includes a copy-paste `.env`
> template and a common misconfiguration troubleshooting table.

### Challenge Storage — Decision Tree

| Deployment                                  | Use                    | Reason                                                                                                                       |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Multiple servers / containers               | **Redis** (required)   | In-memory and sessions are node-local — a challenge stored on server A will not be found on server B, silently breaking auth |
| Single server + sessions already configured | **Session store**      | No new infrastructure; sessions already handle TTL                                                                           |
| Single server + stateless JWT (no sessions) | **DB with TTL column** | Add `challenge` + `challenge_expires_at` columns to a temp table; clean up with a cron job or DB TTL extension               |
| Development / single process                | In-memory map          | Fast setup only — never use in production; fails on process restart                                                          |

> ⚠️ The most silent failure in WebAuthn is using in-memory storage with more
> than one process or container. The challenge is stored on instance A; the
> verify request hits instance B; the challenge is not found; authentication
> always fails. No error message points here.

```typescript
// Using Redis (recommended for distributed deployments)
await redis.set(`passkey:challenge:${userId}`, challenge, "EX", 300);
const storedChallenge = await redis.get(`passkey:challenge:${userId}`);
await redis.del(`passkey:challenge:${userId}`); // delete after use!
```

### Controller Endpoints

```typescript
@Controller("auth/passkey")
export class PasskeyController {
  @Post("register/challenge")
  @UseGuards(JwtAuthGuard) // user must be logged in to register a passkey
  async getRegisterChallenge(@Request() req) {}

  @Post("register/verify")
  @UseGuards(JwtAuthGuard)
  async verifyRegistration(@Request() req, @Body() body) {}

  @Post("authenticate/challenge")
  async getAuthChallenge(@Body() body: { username?: string }) {}

  @Post("authenticate/verify")
  async verifyAuthentication(@Body() body) {}

  @Get("list")
  @UseGuards(JwtAuthGuard)
  async listPasskeys(@Request() req) {}

  @Delete(":credentialId")
  @UseGuards(JwtAuthGuard)
  async deletePasskey(
    @Request() req,
    @Param("credentialId") credentialId: string,
  ) {}
}
```

### Registration Service Logic

```typescript
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

// 1. Generate challenge
const existingPasskeys = await this.prisma.passkey.findMany({
  where: { userId },
});

// Guard: enforce a per-user passkey cap to prevent storage exhaustion (DoS)
if (existingPasskeys.length >= 25) {
  throw new BadRequestException("Maximum number of passkeys reached");
}

const options = await generateRegistrationOptions({
  rpName: rpConfig.rpName,
  rpID: rpConfig.rpID,
  // user.id must be PII-free: use passkeyUserId (stable UUID, not email or username).
  // passkeyUserId is nullable if the user was created before this migration — generate
  // it now if missing rather than crashing with a confusing Buffer error.
  userID: Buffer.from(user.passkeyUserId ?? crypto.randomUUID()),
  userName: user.email, // shown in credential selector
  userDisplayName: user.name ?? user.email,
  attestationType: "none", // 'none' is fine for most consumer apps
  excludeCredentials: existingPasskeys.map((pk) => ({
    id: pk.credentialId,
    transports: pk.transports as AuthenticatorTransport[],
  })),
  authenticatorSelection: {
    residentKey: "preferred", // enables passkey (discoverable credential)
    userVerification: "preferred", // biometric or PIN
  },
});
await this.storeChallenge(userId, options.challenge);
return options;

// 2. Verify registration
// Use finally to guarantee challenge deletion on both success and failure.
// If verifyRegistrationResponse throws (wrong origin, bad challenge, etc.)
// without this pattern the challenge is never deleted, enabling retry attacks.
try {
  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: await this.getChallenge(userId),
    expectedOrigin: rpConfig.expectedOrigins,
    expectedRPID: rpConfig.rpID,
    requireUserVerification: false, // true for high-security apps
  });
  if (!verification.verified)
    throw new UnauthorizedException("Registration failed");

  const { credential, aaguid, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo!;

  // Derive name from AAGUID (optional — maintain a local AAGUID->name map or use fido-mds)
  const providerName =
    this.getProviderName(aaguid) ?? body.response.transports?.[0] ?? "Passkey";

  await this.prisma.passkey.create({
    data: {
      userId,
      credentialId: Buffer.from(credential.id),
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter), // Number -> BigInt for Prisma
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: body.response.transports ?? [],
      aaguid: aaguid ?? null,
      name: providerName,
    },
  });
} finally {
  // Always delete — whether verification succeeded, failed, or threw
  await this.deleteChallenge(userId);
}
```

> **Attestation choice — deliberate default:**
> `attestationType: 'none'` is the correct default for consumer apps.
> The authenticator does not include a certificate chain and the server skips
> device provenance verification entirely. This is what passkeys.dev recommends:
> lower user friction, no MDS verification logic, no brittle certificate lookups.
>
> **When to change this:**
>
> - `'direct'` — the authenticator provides a full attestation statement.
>   Your server must then verify it against the FIDO MDS
>   (`https://mds3.fidoalliance.org/`). Use for regulated environments
>   (healthcare, financial services, enterprise hardware security requirements).
> - `'indirect'` — the authenticator provides an anonymized statement.
>   Intermediate privacy-preserving attestation; rarely needed.
>
> Changing from `'none'` to `'direct'` requires additional server-side
> attestation verification logic beyond what is shown in this reference.
> Existing passkeys registered with `'none'` are unaffected — attestation
> type is only checked at registration time, not authentication time.

### Authentication Service Logic

```typescript
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

// 1. Generate challenge (discoverable — allowCredentials empty -> passkey picker shown)
const options = await generateAuthenticationOptions({
  rpID: rpConfig.rpID,
  userVerification: "preferred",
  allowCredentials: [], // empty = discoverable credential flow (passkey selector)
  timeout: 300000, // 5 minutes recommended (increase to 10min for hybrid/cross-device)
});
// Store challenge against session ID (user not yet known)
await this.storeChallenge(sessionId, options.challenge);
return options;

// 2. Verify authentication
// For discoverable credentials, identify user via credential ID or userHandle:

// Option A: Find via credential ID (most reliable)
const credentialId = Buffer.from(body.rawId, "base64url");
const passkey = await this.prisma.passkey.findUnique({
  where: { credentialId },
  include: { user: true },
});

// Option B: Find via userHandle (if provided by authenticator)
// const userHandle = body.response.userHandle;
// const user = await this.prisma.user.findUnique({ where: { passkeyUserId: userHandle } });

if (!passkey) throw new UnauthorizedException("Passkey not found");

// Use finally to guarantee challenge deletion on both success and failure.
try {
  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: await this.getChallenge(sessionId),
    expectedOrigin: rpConfig.expectedOrigins,
    expectedRPID: rpConfig.rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: Number(passkey.counter), // BigInt -> Number (SimpleWebAuthn expects Number)
      transports: passkey.transports as AuthenticatorTransport[],
    },
    requireUserVerification: false, // true for high-security use cases
  });
  if (!verification.verified)
    throw new UnauthorizedException("Authentication failed");

  // CRITICAL: Update counter immediately (prevents replay attacks)
  await this.prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter), // Number -> BigInt for Prisma
      lastUsedAt: new Date(),
    },
  });

  // Issue JWT / session for passkey.user
  return this.authService.generateToken(passkey.user);
} finally {
  // Always delete — whether verification succeeded, failed, or threw
  await this.deleteChallenge(sessionId);
}
```

---

## NestJS — Common Pitfalls

### DTO fix: SimpleWebAuthn browser v13+ extra fields

SimpleWebAuthn browser v13+ sends `publicKeyAlgorithm`, `publicKey`, and
`authenticatorData` in the registration response (valid W3C Level 3 fields).
A NestJS `ValidationPipe` with `forbidNonWhitelisted: true` will reject these
fields before `verifyRegistrationResponse()` even runs, causing a 400 with a
misleading "cancelled" message on the frontend.

```typescript
// dto/register-verify.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class RegisterVerifyDto {
  @IsString() id: string;
  @IsString() rawId: string;
  @IsString() type: string;

  response: {
    attestationObject: string;
    clientDataJSON: string;
    @IsOptional() transports?: string[];
    // SWA browser v13+ (Chrome 120+, Safari 17.4+, Edge 120+):
    @IsOptional() publicKeyAlgorithm?: number;
    @IsOptional() publicKey?: string;
    @IsOptional() authenticatorData?: string;
  };

  @IsOptional() clientExtensionResults?: Record<string, unknown>;
  @IsOptional() authenticatorAttachment?: string;
}

// In passkey.controller.ts — override the global pipe for this endpoint only:
@Post('register/verify')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }))
async verifyRegistration(@Request() req, @Body() body: RegisterVerifyDto) { ... }
```

### BigInt serialization: never return raw Prisma rows

Prisma maps `counter` to native JS `bigint`. `JSON.stringify` (used by
Express/Nest to serialize responses) cannot serialize `bigint`, so any endpoint
returning the raw Prisma row throws `TypeError: Do not know how to serialize a
BigInt` after the DB write has already succeeded.

Always return a response DTO from all passkey endpoints:

```typescript
// In finishRegistration() — after prisma.passkey.create(), return a safe DTO:
const saved = await this.prisma.passkey.create({ data: { ... } });
return {
  id: saved.id,
  name: saved.name,
  deviceType: saved.deviceType,
  backedUp: saved.backedUp,
  transports: saved.transports,
  aaguid: saved.aaguid,
  createdAt: saved.createdAt,
  lastUsedAt: saved.lastUsedAt,
  // counter intentionally omitted — clients never need it; it cannot be JSON-serialized
};

// For the list endpoint, exclude counter from the Prisma select:
const passkeys = await this.prisma.passkey.findMany({
  where: { userId: req.user.id },
  select: {
    id: true, name: true, deviceType: true, backedUp: true,
    transports: true, aaguid: true, createdAt: true, lastUsedAt: true,
    // counter excluded — BigInt cannot be JSON-serialized by JSON.stringify
  },
  orderBy: { createdAt: 'desc' },
});
```

### Separate loading states: explicit button vs. conditional UI

The conditional UI call `startAuthentication({ useBrowserAutofill: true })` is
a long-lived pending promise — it waits for the user to pick from the autofill
dropdown. If the component exposes a single `loading` flag for both this
background call and the explicit button, the "Sign in with a passkey" button
becomes unclickable while the browser waits (which can be indefinitely).

Use two separate states and see the two-loading-states pattern in
`references/frontend-integration.md` under **React — Two Loading States**.

---

## Django + py_webauthn

### Install

```bash
pip install "webauthn>=2.0"   # v2+ required — v1 used a class-based API
```

### DB Model (additive)

```python
from django.db import models
import uuid

class Passkey(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='passkeys')
    credential_id = models.BinaryField(unique=True)
    public_key = models.BinaryField()
    sign_count = models.BigIntegerField(default=0)
    device_type = models.CharField(max_length=32, default='singleDevice')
    backed_up = models.BooleanField(default=False)
    transports = models.JSONField(default=list)
    aaguid = models.CharField(max_length=36, blank=True, null=True)
    name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'passkeys'

# Add to your User model (one line):
# passkey_user_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
```

### Registration View

```python
import base64
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
    PublicKeyCredentialDescriptor,
    AuthenticatorTransport,
)

# Registration challenge — user IS logged in; CSRF enforced (do NOT add @csrf_exempt)
def passkey_register_challenge(request):
    user = request.user
    existing = Passkey.objects.filter(user=user)
    options = generate_registration_options(
        rp_id=settings.RP_ID,
        rp_name=settings.APP_NAME,
        user_id=str(user.passkey_user_id).encode(),  # PII-free UUID
        user_name=user.email,
        user_display_name=user.get_full_name() or user.email,
        exclude_credentials=[
            PublicKeyCredentialDescriptor(
                id=bytes(pk.credential_id),
                # CRITICAL: convert strings → enum; plain strings cause AttributeError in options_to_json
                # when the user already has a registered passkey
                transports=[AuthenticatorTransport(t) for t in (pk.transports or [])],
            )
            for pk in existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    # MUST base64-encode: options.challenge is bytes; Django sessions use JSON serializer
    # which cannot handle bytes objects — storing raw bytes causes TypeError on session save
    request.session['passkey_challenge'] = base64.b64encode(options.challenge).decode()
    return JsonResponse(json.loads(options_to_json(options)))

def passkey_register_verify(request):
    body = json.loads(request.body)
    raw = request.session.pop('passkey_challenge', None)
    if raw is None:
        return JsonResponse({'error': 'Session expired or challenge not found'}, status=400)
    # Decode back to bytes — py_webauthn expects bytes for expected_challenge
    expected_challenge = base64.b64decode(raw)
    try:
        verification = verify_registration_response(
            credential=body,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.RP_ID,
            expected_origin=settings.APP_ORIGIN,
            require_user_verification=False,
        )
        # py_webauthn v2: raises an exception on failure — there is NO .verified attribute.
        # Reaching this line means verification succeeded.
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)
    Passkey.objects.create(
        user=request.user,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,   # field is sign_count — do NOT rename to counter
        device_type=verification.credential_device_type.value
            if hasattr(verification.credential_device_type, 'value')
            else str(verification.credential_device_type),
        backed_up=verification.credential_backed_up,
        transports=body.get('response', {}).get('transports', []),
        aaguid=str(verification.aaguid) if verification.aaguid else None,
    )
    return JsonResponse({'verified': True})
```

### Authentication Views

```python
import base64
from base64 import urlsafe_b64decode
from django.contrib.auth import login
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

def _base64url_decode(val: str) -> bytes:
    """Decode base64url string to bytes (with padding fix)."""
    val += '=' * (4 - len(val) % 4)
    return urlsafe_b64decode(val)

# Public endpoint — user has no session or CSRF cookie yet; @csrf_exempt is required
@csrf_exempt
def passkey_auth_challenge(request):
    options = generate_authentication_options(
        rp_id=settings.RP_ID,
        user_verification=UserVerificationRequirement.PREFERRED,
        allow_credentials=[],  # empty = discoverable credential flow
        # 10 min timeout — hybrid/cross-device flows can take longer than 5 min
        timeout=600000,
    )
    # MUST base64-encode: options.challenge is bytes; Django JSON session serializer cannot handle bytes
    request.session['passkey_auth_challenge'] = base64.b64encode(options.challenge).decode()
    return JsonResponse(json.loads(options_to_json(options)))

# Public endpoint — user authenticating, no prior session; @csrf_exempt is required
@csrf_exempt
def passkey_auth_verify(request):
    body = json.loads(request.body)
    # Pop challenge before any early return so it is always consumed — prevents replay
    raw = request.session.pop('passkey_auth_challenge', None)
    if raw is None:
        return JsonResponse({'error': 'Session expired or challenge not found'}, status=400)
    expected_challenge = base64.b64decode(raw)  # decode back to bytes for py_webauthn
    credential_id = _base64url_decode(body['rawId'])
    try:
        passkey = Passkey.objects.select_related('user').get(credential_id=credential_id)
    except Passkey.DoesNotExist:
        return JsonResponse({'error': 'Passkey not found'}, status=404)
    try:
        verification = verify_authentication_response(
            credential=body,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.RP_ID,
            expected_origin=settings.APP_ORIGIN,
            credential_public_key=bytes(passkey.public_key),
            credential_current_sign_count=passkey.sign_count,  # sign_count, not counter
            require_user_verification=False,
        )
        # py_webauthn v2: raises an exception on failure — there is NO .verified attribute.
        # Do NOT write: if not verification.verified — that attribute does not exist.
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)
    passkey.sign_count = verification.new_sign_count  # new_sign_count, not newCounter
    passkey.last_used_at = timezone.now()
    passkey.save()
    login(request, passkey.user)
    return JsonResponse({'verified': True})
```

---

## Spring Boot + java-webauthn-server (Full Example)

> ⚠️ **PRODUCTION REQUIREMENT — persistence**: Spring Security's default
> passkey configuration and many Spring Boot examples use in-memory repositories
> (`PublicKeyCredentialUserEntityRepository`, `UserCredentialRepository`). These
> lose ALL registered credentials and passkey user entities on application restart.
> Always implement database-backed repositories (JPA/JDBC) before deploying.
> Never ship in-memory passkey storage to production.

### Maven dependency

```xml
<dependency>
  <groupId>com.yubico</groupId>
  <artifactId>webauthn-server-core</artifactId>
  <version>2.8.1</version>
</dependency>
```

### JPA Entity (additive)

```java
// passkeys/PasskeyCredential.java
@Entity
@Table(name = "passkeys", indexes = @Index(columnList = "user_id"))
public class PasskeyCredential {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
    @Column(name = "credential_id", unique = true, columnDefinition = "BYTEA", nullable = false)
    private byte[] credentialId;
    @Column(name = "public_key_cose", columnDefinition = "BYTEA", nullable = false)
    private byte[] publicKeyCose;
    @Column(name = "signature_count", nullable = false)
    private long signatureCount = 0L;
    @Column(name = "device_type", length = 32)
    private String deviceType = "singleDevice";
    @Column(name = "backed_up")
    private boolean backedUp = false;
    @Column(name = "transports", columnDefinition = "TEXT")
    private String transports = "[]"; // JSON array stored as text
    @Column(name = "aaguid", length = 36)
    private String aaguid;
    @Column(length = 100)
    private String name;
    @Column(name = "created_at", nullable = false, updatable = false)
    @CreationTimestamp
    private Instant createdAt;
    @Column(name = "last_used_at")
    private Instant lastUsedAt;
    // getters, setters...
}
// In User entity: add @Column(name = "passkey_user_id", unique = true)
//                     private UUID passkeyUserId = UUID.randomUUID();
```

### RP Configuration (application.yml)

```yaml
passkey:
  rp-id: ${RP_ID:localhost}
  rp-name: ${APP_NAME:My App}
  origin: ${APP_ORIGIN:http://localhost:8080}
```

### RelyingParty Bean (PasskeyConfig.java)

```java
@Configuration
public class PasskeyConfig {

    @Value("${passkey.rp-id}")
    private String rpId;

    @Value("${passkey.rp-name}")
    private String rpName;

    @Value("${passkey.origin}")
    private String origin;

    @Bean
    public RelyingParty relyingParty(CredentialRepository credentialRepository) {
        RelyingPartyIdentity rpIdentity = RelyingPartyIdentity.builder()
            .id(rpId)
            .name(rpName)
            .build();

        return RelyingParty.builder()
            .identity(rpIdentity)
            .credentialRepository(credentialRepository)
            .origins(Set.of(origin))
            .allowOriginPort(false)       // -- never allow ports in rpID
            .allowOriginSubdomain(false)
            .build();
    }
}
```

### CredentialRepository Implementation

```java
@Service
@RequiredArgsConstructor
public class PasskeyCredentialRepository implements CredentialRepository {

    private final PasskeyRepository passkeyRepository;

    @Override
    public Set<PublicKeyCredentialDescriptor> getCredentialIdsForUsername(String username) {
        return passkeyRepository.findByUser_Email(username).stream()
            .map(pk -> PublicKeyCredentialDescriptor.builder()
                .id(ByteArray.fromBase64Url(Base64.getEncoder()
                    .encodeToString(pk.getCredentialId())))
                .build())
            .collect(Collectors.toSet());
    }

    @Override
    public Optional<ByteArray> getUserHandleForUsername(String username) {
        return passkeyRepository.findUserByEmail(username)
            .map(u -> ByteArray.fromBase64(
                Base64.getEncoder().encodeToString(
                    u.getPasskeyUserId().toString().getBytes())));
    }

    @Override
    public Optional<String> getUsernameForUserHandle(ByteArray userHandle) {
        String passkeyUserId = new String(userHandle.getBytes());
        return passkeyRepository.findUserByPasskeyUserId(passkeyUserId)
            .map(User::getEmail);
    }

    @Override
    public Optional<RegisteredCredential> lookup(ByteArray credentialId, ByteArray userHandle) {
        return passkeyRepository.findByCredentialId(credentialId.getBytes())
            .map(pk -> RegisteredCredential.builder()
                // ByteArray.fromBytes() wraps raw bytes directly — no Base64 encode/decode needed
                .credentialId(new ByteArray(pk.getCredentialId()))
                .userHandle(userHandle)
                .publicKeyCose(new ByteArray(pk.getPublicKeyCose()))
                .signatureCount(pk.getSignatureCount())
                .backupEligible(pk.isBackedUp())
                .backupState(pk.isBackedUp())
                .build());
    }

    @Override
    public Set<RegisteredCredential> lookupAll(ByteArray credentialId) {
        return lookup(credentialId, ByteArray.empty())
            .map(Set::of).orElse(Collections.emptySet());
    }
}
```

### PasskeyController (6 endpoints)

```java
@RestController
@RequestMapping("/auth/passkey")
@RequiredArgsConstructor
public class PasskeyController {

    private final RelyingParty relyingParty;
    private final PasskeyService passkeyService;
    private final HttpSession httpSession;

    // POST /auth/passkey/register/challenge  (authenticated)
    @PostMapping("/register/challenge")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<?> registerChallenge(Authentication auth) throws JsonProcessingException {
        User user = (User) auth.getPrincipal();
        List<PasskeyCredential> existing = passkeyService.getPasskeysForUser(user.getId());

        PublicKeyCredentialCreationOptions options = relyingParty.startRegistration(
            StartRegistrationOptions.builder()
                .user(UserIdentity.builder()
                    .name(user.getEmail())
                    .displayName(user.getName())
                    .id(new ByteArray(user.getPasskeyUserId().toString().getBytes()))
                    .build())
                .authenticatorSelection(AuthenticatorSelectionCriteria.builder()
                    .residentKey(ResidentKeyRequirement.PREFERRED)
                    .userVerification(UserVerificationRequirement.PREFERRED)
                    .build())
                .build());

        httpSession.setAttribute("passkey_reg_challenge", options.toJson());
        return ResponseEntity.ok(options.toJson());
    }

    // POST /auth/passkey/register/verify  (authenticated)
    @PostMapping("/register/verify")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<?> registerVerify(@RequestBody String responseBody, Authentication auth)
            throws Exception {
        String optionsJson = (String) httpSession.getAttribute("passkey_reg_challenge");
        httpSession.removeAttribute("passkey_reg_challenge"); // delete challenge always

        PublicKeyCredentialCreationOptions options =
            PublicKeyCredentialCreationOptions.fromJson(optionsJson);

        try {
            RegistrationResult result = relyingParty.finishRegistration(
                FinishRegistrationOptions.builder()
                    .request(options)
                    .response(PublicKeyCredential.parseRegistrationResponseJson(responseBody))
                    .build());

            User user = (User) auth.getPrincipal();
            passkeyService.saveCredential(user, result);
            return ResponseEntity.ok(Map.of("verified", true));
        } catch (RegistrationFailedException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    // POST /auth/passkey/authenticate/challenge  (public)
    @PostMapping("/authenticate/challenge")
    public ResponseEntity<?> authChallenge() throws JsonProcessingException {
        AssertionRequest request = relyingParty.startAssertion(
            StartAssertionOptions.builder()
                .userVerification(UserVerificationRequirement.PREFERRED)
                .build());

        httpSession.setAttribute("passkey_auth_challenge", request.toJson());
        return ResponseEntity.ok(request.getPublicKeyCredentialRequestOptions().toJson());
    }

    // POST /auth/passkey/authenticate/verify  (public)
    @PostMapping("/authenticate/verify")
    public ResponseEntity<?> authVerify(@RequestBody String responseBody) throws Exception {
        String requestJson = (String) httpSession.getAttribute("passkey_auth_challenge");
        httpSession.removeAttribute("passkey_auth_challenge"); // delete challenge always

        AssertionRequest request = AssertionRequest.fromJson(requestJson);

        try {
            AssertionResult result = relyingParty.finishAssertion(
                FinishAssertionOptions.builder()
                    .request(request)
                    .response(PublicKeyCredential.parseAssertionResponseJson(responseBody))
                    .build());

            if (result.isSuccess()) {
                passkeyService.updateCounter(result);
                String token = passkeyService.issueToken(result.getUsername());
                return ResponseEntity.ok(Map.of("token", token));
            }
        } catch (AssertionFailedException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication failed");
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication failed");
    }

    // GET /auth/passkey/list  (authenticated)
    @GetMapping("/list")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<?> listPasskeys(Authentication auth) {
        User user = (User) auth.getPrincipal();
        return ResponseEntity.ok(passkeyService.getPasskeysForUser(user.getId())
            .stream().map(pk -> Map.of(
                "id", pk.getId(),
                "name", pk.getName(),
                "aaguid", pk.getAaguid(),
                "deviceType", pk.getDeviceType(),
                "backedUp", pk.isBackedUp(),
                "createdAt", pk.getCreatedAt(),
                "lastUsedAt", pk.getLastUsedAt()
            )).toList());
    }

    // DELETE /auth/passkey/{id}  (authenticated)
    @DeleteMapping("/{id}")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<?> deletePasskey(@PathVariable UUID id, Authentication auth) {
        User user = (User) auth.getPrincipal();
        passkeyService.deletePasskeyByIdAndUserId(id, user.getId()); // ownership check inside
        return ResponseEntity.ok(Map.of("deleted", true));
    }
}
```

---

## Go + Gin + go-webauthn/webauthn (Full Example)

> ⚠️ **PRODUCTION REQUIREMENT — persistence**: The `ChallengeStore` in these
> examples must be backed by Redis or a database with TTL support. In-memory
> maps are lost on process restart and do not work across multiple containers.
> Also note: go-webauthn is currently `v0` — the API has breaking changes
> between minor versions. Consult the CHANGELOG before upgrading.

### Install

```bash
go get github.com/go-webauthn/webauthn
go get github.com/gin-gonic/gin
```

### Struct and DB Model

```go
// models/passkey.go
package models

import (
    "time"
    "github.com/google/uuid"
)

type Passkey struct {
    ID           uuid.UUID  `db:"id" json:"id"`
    UserID       uuid.UUID  `db:"user_id" json:"-"`
    CredentialID []byte     `db:"credential_id" json:"-"`
    PublicKey    []byte     `db:"public_key" json:"-"`
    Counter      int64      `db:"counter" json:"-"`
    DeviceType   string     `db:"device_type" json:"deviceType"`
    BackedUp     bool       `db:"backed_up" json:"backedUp"`
    Transports   string     `db:"transports" json:"-"` // JSON array as text
    AAGUID       string     `db:"aaguid" json:"aaguid"`
    Name         string     `db:"name" json:"name"`
    CreatedAt    time.Time  `db:"created_at" json:"createdAt"`
    LastUsedAt   *time.Time `db:"last_used_at" json:"lastUsedAt"`
}
```

### WebAuthn User Interface Implementation

```go
// The go-webauthn library requires a User interface implementation
// models/webauthn_user.go
package models

import (
    "github.com/go-webauthn/webauthn/webauthn"
)

type WebAuthnUser struct {
    ID           []byte
    Name         string
    DisplayName  string
    Passkeys     []Passkey
}

func (u WebAuthnUser) WebAuthnID() []byte { return u.ID }
func (u WebAuthnUser) WebAuthnName() string { return u.Name }
func (u WebAuthnUser) WebAuthnDisplayName() string { return u.DisplayName }
func (u WebAuthnUser) WebAuthnCredentials() []webauthn.Credential {
    creds := make([]webauthn.Credential, len(u.Passkeys))
    for i, pk := range u.Passkeys {
        creds[i] = webauthn.Credential{
            ID:              pk.CredentialID,
            PublicKey:       pk.PublicKey,
            AttestationType: "none",
            Transport:       nil, // parsed from JSON in service layer
            Flags: webauthn.CredentialFlags{
                // Do NOT hardcode UserVerified: true here.
                // These flags reflect what was observed at registration time.
                // The library re-checks UV from the live auth response during
                // FinishDiscoverableLogin — hardcoding true here misrepresents
                // credentials where UV was not performed and can hide real failures.
                BackupEligible: pk.BackedUp,
                BackupState:    pk.BackedUp,
            },
            Authenticator: webauthn.Authenticator{
                SignCount: uint32(pk.Counter),
            },
        }
    }
    return creds
}
```

### Handler Setup and RP Config

```go
// handlers/passkey.go
package handlers

import (
    "encoding/json"
    "net/http"
    "os"

    "github.com/gin-gonic/gin"
    "github.com/go-webauthn/webauthn/webauthn"
    "github.com/go-webauthn/webauthn/protocol"
)

type PasskeyHandler struct {
    wauthn       *webauthn.WebAuthn
    store        ChallengeStore  // Redis or session store
    passkeyRepo  PasskeyRepository
}

func NewPasskeyHandler(store ChallengeStore, repo PasskeyRepository) (*PasskeyHandler, error) {
    rpID := os.Getenv("RP_ID")
    if rpID == "" { rpID = "localhost" }
    origin := os.Getenv("APP_ORIGIN")
    if origin == "" { origin = "http://localhost:8080" }

    wauthn, err := webauthn.New(&webauthn.Config{
        RPDisplayName: os.Getenv("APP_NAME"),
        RPID:          rpID,          // domain only — no port, no protocol
        RPOrigins:     []string{origin},
        AuthenticatorSelection: protocol.AuthenticatorSelection{
            ResidentKey:      protocol.ResidentKeyRequirementPreferred,
            UserVerification: protocol.VerificationPreferred,
        },
        AttestationPreference: protocol.PreferNoAttestation,
        Timeout: 300000,
    })
    if err != nil {
        return nil, err
    }
    return &PasskeyHandler{wauthn: wauthn, store: store, passkeyRepo: repo}, nil
}

// POST /auth/passkey/register/challenge  (requires auth middleware)
func (h *PasskeyHandler) RegisterChallenge(c *gin.Context) {
    userID := c.GetString("user_id") // set by auth middleware
    user, _ := h.passkeyRepo.GetWebAuthnUser(userID)

    creation, sessionData, err := h.wauthn.BeginRegistration(user)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    // Store session data (challenge) server-side
    sessionJSON, _ := json.Marshal(sessionData)
    h.store.Set("reg:"+userID, sessionJSON, 300) // 5 min TTL

    c.JSON(http.StatusOK, creation)
}

// POST /auth/passkey/register/verify  (requires auth middleware)
func (h *PasskeyHandler) RegisterVerify(c *gin.Context) {
    userID := c.GetString("user_id")
    user, _ := h.passkeyRepo.GetWebAuthnUser(userID)

    // Retrieve and immediately delete challenge.
    // Delete before checking the error: ensures the challenge is always removed
    // even if the store returns a partial result or the handler returns early.
    sessionJSON, getErr := h.store.Get("reg:" + userID)
    h.store.Del("reg:" + userID)
    if getErr != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "session store unavailable"})
        return
    }

    var sessionData webauthn.SessionData
    if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "session not found or expired"})
        return
    }

    credential, err := h.wauthn.FinishRegistration(user, sessionData, c.Request)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "registration failed"})
        return
    }

    // Store the credential
    if err := h.passkeyRepo.CreatePasskey(userID, credential); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "storage failed"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"verified": true})
}

// POST /auth/passkey/authenticate/challenge  (public)
func (h *PasskeyHandler) AuthChallenge(c *gin.Context) {
    sessionID := c.GetString("session_id") // anonymous session ID

    // empty allowedUsers = discoverable credential / passkey picker
    assertion, sessionData, err := h.wauthn.BeginDiscoverableLogin()
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    sessionJSON, _ := json.Marshal(sessionData)
    h.store.Set("auth:"+sessionID, sessionJSON, 600) // 10 min TTL for cross-device

    c.JSON(http.StatusOK, assertion)
}

// POST /auth/passkey/authenticate/verify  (public)
func (h *PasskeyHandler) AuthVerify(c *gin.Context) {
    sessionID := c.GetString("session_id")

    sessionJSON, getErr := h.store.Get("auth:" + sessionID)
    h.store.Del("auth:" + sessionID)
    if getErr != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "session store unavailable"})
        return
    }

    var sessionData webauthn.SessionData
    if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "session not found or expired"})
        return
    }

    // Discoverable login: find user by credential ID from the request
    credential, err := h.wauthn.FinishDiscoverableLogin(
        func(rawID, userHandle []byte) (webauthn.User, error) {
            return h.passkeyRepo.GetWebAuthnUserByCredentialID(rawID)
        },
        sessionData, c.Request,
    )
    if err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication failed"})
        return
    }

    // Update counter (CRITICAL for replay protection)
    if err := h.passkeyRepo.UpdateCounter(credential.ID, int64(credential.Authenticator.SignCount)); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "counter update failed"})
        return
    }

    token := issueJWT(credential) // your JWT/session logic
    c.JSON(http.StatusOK, gin.H{"token": token})
}

// GET /auth/passkey/list  (requires auth middleware)
func (h *PasskeyHandler) ListPasskeys(c *gin.Context) {
    userID := c.GetString("user_id")
    passkeys, _ := h.passkeyRepo.ListByUserID(userID)
    c.JSON(http.StatusOK, passkeys)
}

// DELETE /auth/passkey/:id  (requires auth middleware)
func (h *PasskeyHandler) DeletePasskey(c *gin.Context) {
    userID := c.GetString("user_id")
    passkeyID := c.Param("id")
    // Ownership check: only delete if passkey belongs to this user
    if err := h.passkeyRepo.DeleteByIDAndUserID(passkeyID, userID); err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"deleted": true})
}
```

### Route Registration

```go
// main.go or routes.go
func SetupRoutes(r *gin.Engine, h *PasskeyHandler, authMiddleware gin.HandlerFunc) {
    passkey := r.Group("/auth/passkey")
    {
        // Public endpoints (user not yet identified)
        passkey.POST("/authenticate/challenge", h.AuthChallenge)
        passkey.POST("/authenticate/verify", h.AuthVerify)

        // Authenticated endpoints (existing session required)
        authed := passkey.Group("", authMiddleware)
        {
            authed.POST("/register/challenge", h.RegisterChallenge)
            authed.POST("/register/verify", h.RegisterVerify)
            authed.GET("/list", h.ListPasskeys)
            authed.DELETE("/:id", h.DeletePasskey)
        }
    }
}
```

---

## Laravel + web-auth/webauthn-lib (PHP)

> ⚠️ **PREREQUISITE — sodium extension**: Without the PHP `sodium` extension (or
> `paragonie/sodium-compat` as a pure-PHP fallback), EdDSA Curve 25519 passkeys
> registered during enrollment silently fail signature validation at login time.
> The user sees "passkey failed" with no useful error.
> Verify: `php -m | grep sodium`
> Fix: `apt-get install php-sodium` or `composer require paragonie/sodium-compat`

### Install

```bash
composer require "web-auth/webauthn-lib:^4"   # v4+ required — PHP 8.1+, PSR-20 clock
```

### Migration (additive)

```php
// database/migrations/xxxx_add_passkeys.php
public function up(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->uuid('passkey_user_id')->unique()->nullable()->after('id');
    });

    Schema::create('passkeys', function (Blueprint $table) {
        $table->uuid('id')->primary();
        $table->foreignId('user_id')->constrained()->cascadeOnDelete();
        $table->binary('credential_id')->unique();
        $table->binary('public_key');
        $table->unsignedBigInteger('counter')->default(0);
        $table->string('device_type', 32)->default('singleDevice');
        $table->boolean('backed_up')->default(false);
        $table->json('transports')->nullable();
        $table->string('aaguid', 36)->nullable();
        $table->string('name', 100)->nullable();
        $table->timestamp('last_used_at')->nullable();
        $table->timestamps();
    });
}
```

### Eloquent Model

```php
// app/Models/Passkey.php
class Passkey extends Model
{
    protected $fillable = [
        'user_id', 'credential_id', 'public_key', 'counter',
        'device_type', 'backed_up', 'transports', 'aaguid', 'name',
    ];
    protected $casts = ['transports' => 'array', 'backed_up' => 'boolean'];
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
```

### Controller Scaffold

```php
// app/Http/Controllers/PasskeyController.php
use Webauthn\PublicKeyCredentialRpEntity;
use Webauthn\PublicKeyCredentialUserEntity;
use Webauthn\PublicKeyCredentialCreationOptions;

class PasskeyController extends Controller
{
    private string $rpId;
    private string $rpName;
    private string $origin;

    public function __construct()
    {
        $this->rpId   = config('passkeys.rp_id', 'localhost');
        $this->rpName = config('passkeys.rp_name', config('app.name'));
        $this->origin = config('passkeys.origin', config('app.url'));
    }

    // POST /auth/passkey/register/challenge  (auth:sanctum)
    public function registerChallenge(Request $request): JsonResponse
    {
        $user = $request->user();
        // WebAuthn requires base64url encoding (not standard base64).
        // base64url differs: uses '-' and '_' instead of '+' and '/', no padding.
        $challenge = $this->base64url(random_bytes(32));
        $request->session()->put('passkey_challenge', $challenge);

        $options = [
            'rp'     => ['id' => $this->rpId, 'name' => $this->rpName],
            'user'   => [
                'id'          => $this->base64url($user->passkey_user_id ?? $user->id),
                'name'        => $user->email,
                'displayName' => $user->name,
            ],
            'challenge'               => $challenge,
            'pubKeyCredParams'        => [
                ['type' => 'public-key', 'alg' => -7],   // ES256
                ['type' => 'public-key', 'alg' => -257], // RS256
            ],
            'authenticatorSelection'  => [
                'residentKey'       => 'preferred',
                'userVerification'  => 'preferred',
            ],
            'excludeCredentials'      => $user->passkeys->map(fn($pk) => [
                'type'       => 'public-key',
                'id'         => $this->base64url($pk->credential_id),
                'transports' => $pk->transports ?? [],
            ])->toArray(),
            'attestation' => 'none',
            'timeout'     => 300000,
        ];
        return response()->json($options);
    }

    /** Encode binary data as base64url (no padding, URL-safe chars). */
    private function base64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    // POST /auth/passkey/register/verify  (auth:sanctum)
    public function registerVerify(Request $request): JsonResponse
    {
        $challenge = $request->session()->pull('passkey_challenge');
        if (!$challenge) {
            return response()->json(['error' => 'Session expired'], 400);
        }

        // Decode the attestation response and verify with web-auth/webauthn-lib.
        // The exact API depends on your webauthn-lib version — consult its README
        // for AuthenticatorAttestationResponseValidator usage. The fields below
        // are what you store after a successful verification result:
        //
        // $credentialId  = base64_decode(strtr($request->input('rawId'), '-_', '+/'));
        // $publicKey     = $verificationResult->getAttestedCredentialData()->getCredentialPublicKey();
        // $signCount     = $verificationResult->getAuthenticatorData()->getSignCount();
        // $aaguid        = (string) $verificationResult->getAttestedCredentialData()->getAaguid();
        // $backedUp      = (bool) ($verificationResult->getAuthenticatorData()->getFlags() & 0x08);
        //
        // After verification, persist the credential:
        $request->user()->passkeys()->create([
            'credential_id' => $credentialId,
            'public_key'    => $publicKey,
            'counter'       => $signCount,
            'device_type'   => $backedUp ? 'multiDevice' : 'singleDevice',
            'backed_up'     => $backedUp,
            'transports'    => $request->input('response.transports', []),
            'aaguid'        => $aaguid,
        ]);
        return response()->json(['verified' => true]);
    }

    // POST /auth/passkey/authenticate/challenge  (public)
    public function authChallenge(Request $request): JsonResponse
    {
        $challenge = $this->base64url(random_bytes(32));
        $request->session()->put('passkey_auth_challenge', $challenge);
        return response()->json([
            'challenge'        => $challenge,
            'rpId'             => $this->rpId,
            'userVerification' => 'preferred',
            'allowCredentials' => [], // empty = discoverable
            'timeout'          => 300000,
        ]);
    }

    // POST /auth/passkey/authenticate/verify  (public)
    public function authVerify(Request $request): JsonResponse
    {
        $challenge = $request->session()->pull('passkey_auth_challenge');
        // rawId from browser is base64url — convert to standard base64 before decoding
        $credentialId = base64_decode(strtr($request->input('rawId'), '-_', '+/'));
        $passkey = Passkey::where('credential_id', $credentialId)
                         ->with('user')->firstOrFail();
        // ... verify signature with webauthn-lib
        $passkey->update(['counter' => $newCounter, 'last_used_at' => now()]);
        $token = $passkey->user->createToken('passkey')->plainTextToken;
        return response()->json(['token' => $token]);
    }

    // GET /auth/passkey/list (auth:sanctum)
    public function list(Request $request): JsonResponse
    {
        return response()->json($request->user()->passkeys()->select([
            'id', 'name', 'aaguid', 'device_type', 'backed_up', 'created_at', 'last_used_at'
        ])->get());
    }

    // DELETE /auth/passkey/{id} (auth:sanctum)
    public function delete(Request $request, string $id): JsonResponse
    {
        $request->user()->passkeys()->findOrFail($id)->delete();
        return response()->json(['deleted' => true]);
    }
}
```

### Routes (routes/api.php)

```php
Route::prefix('auth/passkey')->group(function () {
    Route::post('authenticate/challenge', [PasskeyController::class, 'authChallenge']);
    Route::post('authenticate/verify',   [PasskeyController::class, 'authVerify']);

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('register/challenge', [PasskeyController::class, 'registerChallenge']);
        Route::post('register/verify',    [PasskeyController::class, 'registerVerify']);
        Route::get('list',                [PasskeyController::class, 'list']);
        Route::delete('{id}',             [PasskeyController::class, 'delete']);
    });
});
```

### Config (config/passkeys.php)

```php
return [
    'rp_id'  => env('RP_ID', 'localhost'),
    'rp_name'=> env('APP_NAME', 'My App'),
    'origin' => env('APP_URL', 'http://localhost:8000'),
];
```

```env
RP_ID=localhost                        # domain only
APP_ORIGIN=http://localhost:3000       # full origin
APP_NAME=MyApp                         # shown in passkey prompts
PASSKEY_CHALLENGE_TTL=300              # seconds
```

---

---

## Passkey Naming — PATCH Endpoint

The `name` column exists in the passkeys table from day one (see `references/db-schema.md`).
Two responsibilities:
1. **Set default name at registration** — resolve from AAGUID using FIDO MDS (see security-checklist.md §F.2)
2. **Allow user rename** — `PATCH /auth/passkey/:id` with ownership check

### NestJS (TypeScript)

```typescript
// passkey.controller.ts
@Patch(':id')
@UseGuards(JwtAuthGuard)
async rename(
  @Param('id') id: string,
  @Body('name') name: string,
  @Request() req,
): Promise<{ id: string; name: string }> {
  return this.passkeyService.rename(req.user.id, id, name);
}

// passkey.service.ts
async rename(userId: string, passkeyId: string, name: string) {
  const trimmed = name?.trim();
  if (!trimmed) throw new BadRequestException('Name cannot be empty');
  if (trimmed.length > 100) throw new BadRequestException('Name must be 100 characters or fewer');

  // Filter by both id AND userId — prevents horizontal privilege escalation
  const passkey = await this.prisma.passkey.findFirst({
    where: { id: passkeyId, userId },
  });
  if (!passkey) throw new NotFoundException('Passkey not found');

  return this.prisma.passkey.update({
    where: { id: passkeyId },
    data: { name: trimmed },
    select: { id: true, name: true },
  });
}
```

### Express (TypeScript)

```typescript
// routes/passkey.ts
router.patch('/:id', authMiddleware, async (req, res) => {
  const { name } = req.body;
  const trimmed = name?.trim();

  if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
  if (trimmed.length > 100) return res.status(400).json({ error: 'Name too long' });

  const passkey = await prisma.passkey.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!passkey) return res.status(404).json({ error: 'Not found' });

  const updated = await prisma.passkey.update({
    where: { id: req.params.id },
    data: { name: trimmed },
    select: { id: true, name: true },
  });
  res.json(updated);
});
```

### Django (Python)

```python
# views.py
@login_required
def rename_passkey(request, passkey_id):
    if request.method != 'PATCH':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    import json
    body = json.loads(request.body)
    name = body.get('name', '').strip()

    if not name:
        return JsonResponse({'error': 'Name cannot be empty'}, status=400)
    if len(name) > 100:
        return JsonResponse({'error': 'Name must be 100 characters or fewer'}, status=400)

    # Filter by both id AND user — ownership enforced here
    passkey = get_object_or_404(Passkey, pk=passkey_id, user=request.user)
    passkey.name = name
    passkey.save(update_fields=['name'])
    return JsonResponse({'id': str(passkey.id), 'name': passkey.name})

# urls.py — add alongside other passkey routes
path('auth/passkey/<uuid:passkey_id>/', rename_passkey),
```

### FastAPI (Python)

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, constr

router = APIRouter(prefix="/auth/passkey")

class RenameRequest(BaseModel):
    name: constr(min_length=1, max_length=100, strip_whitespace=True)

@router.patch("/{passkey_id}")
async def rename_passkey(
    passkey_id: str,
    body: RenameRequest,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == current_user.id)
    )
    passkey = result.scalar_one_or_none()
    if not passkey:
        raise HTTPException(status_code=404, detail="Passkey not found")

    passkey.name = body.name
    await db.commit()
    return {"id": str(passkey.id), "name": passkey.name}
```

### Setting Default Name at Registration

Call this immediately after a successful `verifyRegistrationResponse()` and before storing the credential:

```typescript
// aaguid-resolver.ts — uses the helper from security-checklist.md §F.2
import { getProviderNameFromMds } from './aaguid-mds';

export async function resolvePasskeyName(aaguid: string | null | undefined): Promise<string> {
  if (!aaguid) return 'Passkey';
  return getProviderNameFromMds(aaguid);  // returns 'Passkey' if unrecognized
}

// In registerVerify handler:
const name = await resolvePasskeyName(registrationInfo.aaguid);
await prisma.passkey.create({
  data: {
    userId: req.user.id,
    credentialId: Buffer.from(registrationInfo.credential.id, 'base64url'),
    publicKey: registrationInfo.credential.publicKey,
    counter: BigInt(registrationInfo.credential.counter),
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    transports: body.response.transports ?? [],
    aaguid: registrationInfo.aaguid ?? null,
    name,  // ← AAGUID-resolved default; user can rename later
  },
});
```

> For the canonical passkey table schema (SQL, Prisma, TypeORM, SQLAlchemy,
> Hibernate, Eloquent, ActiveRecord, and MongoDB), see `references/db-schema.md`.
> Do not duplicate schema definitions here — db-schema.md is the single source of truth.
