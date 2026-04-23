# Backend Integration Reference

## Google-Recommended Database Schema (from Google Identity Passkeys Guide)

Google's official guidance recommends splitting user identity to keep passkeys PII-free:

```
Users table:
  user_id          UUID  PK   ← main user identity (may become de-facto PII)
  username         TEXT       ← editable, may change
  passkey_user_id  UUID  UQ   ← PII-free, stable, used as user.id in WebAuthn
                                 Never set as PK (PKs tend to leak as PII)

Passkeys table:
  id               UUID  PK
  passkey_user_id  UUID  FK → users.passkey_user_id   ON DELETE CASCADE
  credential_id    BYTES UQ  ← use as PK in credential lookups
  public_key       BYTES
  counter          BIGINT    ← CRITICAL: replay attack protection
  device_type      VARCHAR   ← "singleDevice" | "multiDevice"
  backed_up        BOOL      ← synced across devices? (BE flag)
  transports       ARRAY     ← ["internal","hybrid","usb","nfc","ble"]
  aaguid           VARCHAR   ← passkey provider ID (Google PM, iCloud, etc.)
  name             VARCHAR   ← display name, can be derived from aaguid
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
1. Client calls `/auth/passkey/register/challenge` → server returns challenge + options
2. Client calls `navigator.credentials.create()` → device creates key pair, returns credential
3. Client calls `/auth/passkey/register/verify` → server verifies & stores public key

**Authentication (sign in with passkey)**
1. Client calls `/auth/passkey/authenticate/challenge` → server returns challenge + allowed credentials
2. Client calls `navigator.credentials.get()` → device signs challenge with private key
3. Client calls `/auth/passkey/authenticate/verify` → server verifies signature → issues session/token

---

## NestJS + Prisma + PostgreSQL (Full Example)

### Install
```bash
npm install @simplewebauthn/server
# @simplewebauthn/browser is for the frontend — install it there, not here
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
  rpName: process.env.APP_NAME ?? 'My App',
  rpID: process.env.RP_ID ?? 'localhost',            // domain only, no port, no protocol
  origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',  // full origin
  expectedOrigins: process.env.APP_ORIGIN
    ? [process.env.APP_ORIGIN]
    : ['http://localhost:3000'],
};
```

> ⚠️ rpID MUST match the effective domain. For `https://app.example.com`, rpID = `app.example.com` or `example.com` (broader). Wrong rpID = ceremony always fails.

> For framework-specific environment variable configuration (Django, Spring Boot,
> Laravel, Go), see `assets/env-template.md`. It includes a copy-paste `.env`
> template and a common misconfiguration troubleshooting table.

### Challenge Storage
Challenges must be stored temporarily (server-side, not client-side):
- **Option A**: Redis with 5-minute TTL (preferred for distributed systems)
- **Option B**: In-memory map (dev only, not suitable for multi-instance)
- **Option C**: Session store (express-session, NestJS session)

```typescript
// Using Redis (recommended)
await redis.set(`passkey:challenge:${userId}`, challenge, 'EX', 300);
const storedChallenge = await redis.get(`passkey:challenge:${userId}`);
await redis.del(`passkey:challenge:${userId}`); // delete after use!
```

### Controller Endpoints
```typescript
@Controller('auth/passkey')
export class PasskeyController {
  @Post('register/challenge')
  @UseGuards(JwtAuthGuard)  // user must be logged in to register a passkey
  async getRegisterChallenge(@Request() req) {}

  @Post('register/verify')
  @UseGuards(JwtAuthGuard)
  async verifyRegistration(@Request() req, @Body() body) {}

  @Post('authenticate/challenge')
  async getAuthChallenge(@Body() body: { username?: string }) {}

  @Post('authenticate/verify')
  async verifyAuthentication(@Body() body) {}

  @Get('list')
  @UseGuards(JwtAuthGuard)
  async listPasskeys(@Request() req) {}

  @Delete(':credentialId')
  @UseGuards(JwtAuthGuard)
  async deletePasskey(@Request() req, @Param('credentialId') credentialId: string) {}
}
```

### Registration Service Logic
```typescript
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

// 1. Generate challenge
const existingPasskeys = await this.prisma.passkey.findMany({ where: { userId } });
const options = await generateRegistrationOptions({
  rpName: rpConfig.rpName,
  rpID: rpConfig.rpID,
  // user.id must be PII-free: use passkeyUserId (stable UUID, not email or username)
  userID: Buffer.from(user.passkeyUserId),  
  userName: user.email,                       // shown in credential selector
  userDisplayName: user.name ?? user.email,
  attestationType: 'none',  // 'none' is fine for most consumer apps
  excludeCredentials: existingPasskeys.map(pk => ({
    id: pk.credentialId,
    transports: pk.transports as AuthenticatorTransport[],
  })),
  authenticatorSelection: {
    residentKey: 'preferred',       // enables passkey (discoverable credential)
    userVerification: 'preferred',  // biometric or PIN
  },
});
await this.storeChallenge(userId, options.challenge);
return options;

// 2. Verify registration
const verification = await verifyRegistrationResponse({
  response: body,
  expectedChallenge: await this.getChallenge(userId),
  expectedOrigin: rpConfig.expectedOrigins,
  expectedRPID: rpConfig.rpID,
  requireUserVerification: false, // true for high-security apps
});
if (!verification.verified) throw new UnauthorizedException('Registration failed');

const { credential, aaguid, credentialDeviceType, credentialBackedUp } = verification.registrationInfo!;

// Derive name from AAGUID (optional — maintain a local AAGUID→name map or use fido-mds)
const providerName = this.getProviderName(aaguid) ?? body.response.transports?.[0] ?? 'Passkey';

await this.prisma.passkey.create({
  data: {
    userId,
    credentialId: Buffer.from(credential.id),
    publicKey: Buffer.from(credential.publicKey),
    counter: BigInt(credential.counter),  // Number → BigInt for Prisma
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    transports: body.response.transports ?? [],
    aaguid: aaguid ?? null,
    name: providerName,
  }
});
// Always delete challenge after use (success or failure)
await this.deleteChallenge(userId);
```

### Authentication Service Logic
```typescript
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

// 1. Generate challenge (discoverable — allowCredentials empty → passkey picker shown)
const options = await generateAuthenticationOptions({
  rpID: rpConfig.rpID,
  userVerification: 'preferred',
  allowCredentials: [],  // empty = discoverable credential flow (passkey selector)
  timeout: 300000,       // 5 minutes recommended (increase to 10min for hybrid/cross-device)
});
// Store challenge against session ID (user not yet known)
await this.storeChallenge(sessionId, options.challenge);
return options;

// 2. Verify authentication
// For discoverable credentials, identify user via credential ID or userHandle:

// Option A: Find via credential ID (most reliable)
const credentialId = Buffer.from(body.rawId, 'base64url');
const passkey = await this.prisma.passkey.findUnique({
  where: { credentialId },
  include: { user: true },
});

// Option B: Find via userHandle (if provided by authenticator)
// const userHandle = body.response.userHandle;
// const user = await this.prisma.user.findUnique({ where: { passkeyUserId: userHandle } });

if (!passkey) throw new UnauthorizedException('Passkey not found');

const verification = await verifyAuthenticationResponse({
  response: body,
  expectedChallenge: await this.getChallenge(sessionId),
  expectedOrigin: rpConfig.expectedOrigins,
  expectedRPID: rpConfig.rpID,
  credential: {
    id: passkey.credentialId,
    publicKey: passkey.publicKey,
    counter: Number(passkey.counter),  // BigInt → Number (SimpleWebAuthn expects Number)
    transports: passkey.transports as AuthenticatorTransport[],
  },
  requireUserVerification: false,  // true for high-security use cases
});
if (!verification.verified) throw new UnauthorizedException('Authentication failed');

// CRITICAL: Update counter immediately (prevents replay attacks)
await this.prisma.passkey.update({
  where: { id: passkey.id },
  data: {
    counter: BigInt(verification.authenticationInfo.newCounter),  // Number → BigInt for Prisma
    lastUsedAt: new Date(),
  },
});

// CRITICAL: Delete challenge after use regardless of outcome
await this.deleteChallenge(sessionId);

// Issue JWT / session for passkey.user
return this.authService.generateToken(passkey.user);
```

---

## Django + py_webauthn

### Install
```bash
pip install webauthn
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
import json
from django.http import JsonResponse
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
)

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
            PublicKeyCredentialDescriptor(id=bytes(pk.credential_id), transports=pk.transports)
            for pk in existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    # Store challenge in session (py_webauthn options_to_json returns JSON string)
    request.session['passkey_challenge'] = options.challenge
    return JsonResponse(json.loads(options_to_json(options)))

def passkey_register_verify(request):
    body = json.loads(request.body)
    expected_challenge = request.session.pop('passkey_challenge', None)
    verification = verify_registration_response(
        credential=body,
        expected_challenge=expected_challenge,
        expected_rp_id=settings.RP_ID,
        expected_origin=settings.APP_ORIGIN,
        require_user_verification=False,
    )
    Passkey.objects.create(
        user=request.user,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        device_type=verification.credential_device_type,
        backed_up=verification.credential_backed_up,
        transports=body.get('response', {}).get('transports', []),
        aaguid=str(verification.aaguid) if verification.aaguid else None,
    )
    return JsonResponse({'verified': True})
```

### Authentication Views
```python
from base64 import urlsafe_b64decode
from django.contrib.auth import login
from django.utils import timezone

def _base64url_decode(val: str) -> bytes:
    """Decode base64url string to bytes (with padding fix)."""
    val += '=' * (4 - len(val) % 4)
    return urlsafe_b64decode(val)

def passkey_auth_challenge(request):
    options = generate_authentication_options(
        rp_id=settings.RP_ID,
        user_verification=UserVerificationRequirement.PREFERRED,
        allow_credentials=[],  # empty = discoverable credential flow
        timeout=300000,
    )
    request.session['passkey_auth_challenge'] = options.challenge
    return JsonResponse(json.loads(options_to_json(options)))

def passkey_auth_verify(request):
    body = json.loads(request.body)
    credential_id = _base64url_decode(body['rawId'])
    passkey = Passkey.objects.select_related('user').get(credential_id=credential_id)
    expected_challenge = request.session.pop('passkey_auth_challenge', None)
    verification = verify_authentication_response(
        credential=body,
        expected_challenge=expected_challenge,
        expected_rp_id=settings.RP_ID,
        expected_origin=settings.APP_ORIGIN,
        credential_public_key=bytes(passkey.public_key),
        credential_current_sign_count=passkey.sign_count,
        require_user_verification=False,
    )
    # Update counter
    passkey.sign_count = verification.new_sign_count
    passkey.last_used_at = timezone.now()
    passkey.save()
    # Issue session for passkey.user
    login(request, passkey.user)
    return JsonResponse({'verified': True})
```

---

## Spring Boot + java-webauthn-server (Full Example)

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
            .allowOriginPort(false)       // ← never allow ports in rpID
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
                .credentialId(ByteArray.fromBase64(
                    Base64.getEncoder().encodeToString(pk.getCredentialId())))
                .userHandle(userHandle)
                .publicKeyCose(ByteArray.fromBase64(
                    Base64.getEncoder().encodeToString(pk.getPublicKeyCose())))
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
                UserVerified: true,
                BackupEligible: pk.BackedUp,
                BackupState: pk.BackedUp,
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

    // Retrieve and immediately delete challenge
    sessionJSON, _ := h.store.Get("reg:" + userID)
    h.store.Del("reg:" + userID) // CRITICAL: delete in all paths

    var sessionData webauthn.SessionData
    if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "session not found"})
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

    sessionJSON, _ := h.store.Get("auth:" + sessionID)
    h.store.Del("auth:" + sessionID) // CRITICAL: delete in all paths

    var sessionData webauthn.SessionData
    if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "session not found"})
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

### Install
```bash
composer require web-auth/webauthn-lib
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
        $challenge = base64_encode(random_bytes(32));
        $request->session()->put('passkey_challenge', $challenge);

        $options = [
            'rp'     => ['id' => $this->rpId, 'name' => $this->rpName],
            'user'   => [
                'id'          => base64_encode($user->passkey_user_id ?? $user->id),
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
                'id'         => base64_encode($pk->credential_id),
                'transports' => $pk->transports ?? [],
            ])->toArray(),
            'attestation' => 'none',
            'timeout'     => 300000,
        ];
        return response()->json($options);
    }

    // POST /auth/passkey/register/verify  (auth:sanctum)
    public function registerVerify(Request $request): JsonResponse
    {
        // Hand off to web-auth/webauthn-lib for full verification
        // then store the credential
        $challenge = $request->session()->pull('passkey_challenge');
        // ... verify using webauthn-lib's AuthenticatorAttestationResponseValidator
        $user = $request->user();
        $user->passkeys()->create([
            'credential_id' => base64_decode($request->input('rawId')),
            'public_key'    => $decodedPublicKey,        // from verification result
            'counter'       => $verificationResult->getAuthenticatorData()->getSignCount(),
            'device_type'   => $verificationResult->getAuthenticatorData()->getAttestedCredentialData()->getAaguid() ? 'multiDevice' : 'singleDevice',
            'backed_up'     => (bool)($flags & 0x08),
            'transports'    => $request->input('response.transports', []),
            'aaguid'        => (string)$verificationResult->getAuthenticatorData()->getAttestedCredentialData()->getAaguid(),
        ]);
        return response()->json(['verified' => true]);
    }

    // POST /auth/passkey/authenticate/challenge  (public)
    public function authChallenge(Request $request): JsonResponse
    {
        $challenge = base64_encode(random_bytes(32));
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
        $credentialId = base64_decode($request->input('rawId'));
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

## Database Schema — Passkey Table (generic)

```sql
CREATE TABLE passkeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   BYTEA UNIQUE NOT NULL,
  public_key      BYTEA NOT NULL,
  counter         BIGINT NOT NULL DEFAULT 0,
  device_type     VARCHAR(32) NOT NULL DEFAULT 'singleDevice',
  backed_up       BOOLEAN NOT NULL DEFAULT FALSE,
  transports      TEXT[] DEFAULT '{}',
  aaguid          VARCHAR(36),
  name            VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_passkeys_user_id ON passkeys(user_id);
```

For MongoDB:
```javascript
{
  userId: ObjectId,
  credentialId: Binary,        // unique index
  publicKey: Binary,
  counter: Long,
  deviceType: String,
  backedUp: Boolean,
  transports: [String],
  aaguid: String,              // passkey provider AAGUID
  name: String,
  createdAt: Date,
  lastUsedAt: Date
}
```
