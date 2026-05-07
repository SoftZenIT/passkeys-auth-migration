# DB Schema & ORM Migration Patterns

## Core Principle: Always Additive

Never modify existing user/auth tables. Only ADD new tables/columns.
Existing auth continues to work during migration. Passkeys are purely additive.

---

## Recommended Schema Design (Google Identity Guide)

Always split user identity for WebAuthn compliance:

```
users table (existing):
  id               -> your existing PK (do NOT use as WebAuthn user.id)
  email            -> PII — do NOT use as WebAuthn user.id
  passkey_user_id  -> NEW: PII-free UUID, used as user.id in WebAuthn options
                     Must be stable (never changes), unique, no PII
                     W3C spec requires user.id to be free of PII

passkeys table (new — full schema):
  id               UUID PK
  user_id          FK -> users.id  (or users.passkey_user_id)  ON DELETE CASCADE
  credential_id    BYTES  UNIQUE — WebAuthn raw credential ID
  public_key       BYTES  — COSE-encoded public key
  counter          BIGINT — signature counter (replay attack protection)
  device_type      VARCHAR(32)  — "singleDevice" | "multiDevice"
  backed_up        BOOL — true = synced (iCloud/Google PM), false = device-bound
  transports       ARRAY/JSON — ["internal","hybrid","usb","nfc","ble"]
  aaguid           VARCHAR(36) — passkey provider ID (optional but recommended)
  name             VARCHAR(100) — derived from aaguid or user-assigned label
  created_at       TIMESTAMPTZ
  last_used_at     TIMESTAMPTZ
```

**Why `passkey_user_id`?**
The `user.id` in WebAuthn options (`generateRegistrationOptions`) becomes `userHandle` in auth responses. The authenticator returns it when a discoverable credential is used to identify the user. It must be PII-free per the W3C spec — never use email or username.

**Why `aaguid`?**
AAGUID identifies the passkey provider (Google Password Manager, iCloud Keychain, 1Password, Dashlane, etc.). Store it and use it to show meaningful passkey card names in Account Settings.

---

## Prisma (PostgreSQL / MySQL / SQLite)

### Schema addition
```prisma
// Add to schema.prisma — do NOT modify existing User model fields

model Passkey {
  id           String    @id @default(cuid())
  userId       String
  credentialId Bytes     @unique
  publicKey    Bytes
  counter      BigInt    @default(0)
  deviceType   String    @default("singleDevice") // "singleDevice" | "multiDevice"
  backedUp     Boolean   @default(false)
  transports   String[]  @default([])             // PostgreSQL only; use Json for MySQL
  aaguid       String?                            // Passkey provider AAGUID
  name         String?                            // Derived from aaguid or user-assigned
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("passkeys")
}

// In User model — add these two lines only:
// passkeys      Passkey[]
// passkeyUserId String?  @unique  @default(cuid())  // PII-free, stable, for WebAuthn user.id
```

> For **MySQL**: replace `String[]` with `Json` for `transports` — MySQL does not support arrays in Prisma.

### Migration command
```bash
npx prisma migrate dev --name add_passkeys
# or for production:
npx prisma migrate deploy
```

### Prisma with MySQL (transports workaround)
```prisma
model Passkey {
  // ... same as above except:
  transports   Json    @default("[]")   // store as JSON string in MySQL
}
```

```typescript
// When reading:
const transports = JSON.parse(passkey.transports as string) as AuthenticatorTransport[];
// When writing:
await prisma.passkey.create({ data: { transports: JSON.stringify(body.response.transports ?? []) } });
```

---

## TypeORM (PostgreSQL / MySQL)

### Entity
```typescript
// passkey.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Index } from 'typeorm';
import { User } from '../user/user.entity';

@Entity('passkeys')
export class Passkey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.passkeys, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Index({ unique: true })
  @Column({ name: 'credential_id', type: 'bytea' })  // 'blob' for MySQL
  credentialId: Buffer;

  @Column({ name: 'public_key', type: 'bytea' })      // 'blob' for MySQL
  publicKey: Buffer;

  @Column({ name: 'counter', type: 'bigint', default: 0 })
  counter: bigint;

  @Column({ name: 'device_type', length: 32, default: 'singleDevice' })
  deviceType: string;

  @Column({ name: 'backed_up', default: false })
  backedUp: boolean;

  @Column({ name: 'transports', type: 'simple-array', nullable: true })
  transports: string[];

  @Column({ name: 'aaguid', length: 36, nullable: true })
  aaguid: string;

  @Column({ nullable: true, length: 100 })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'last_used_at', nullable: true, type: 'timestamp' })
  lastUsedAt: Date;
}
```

### Add relation to User entity
```typescript
// In user.entity.ts — add two fields:
@OneToMany(() => Passkey, passkey => passkey.user)
passkeys: Passkey[];

@Column({ name: 'passkey_user_id', type: 'uuid', unique: true, nullable: true })
passkeyUserId: string;  // PII-free, used as user.id in WebAuthn
```

### TypeORM migration (auto-generate)
```bash
npx typeorm migration:generate -n AddPasskeys
npx typeorm migration:run
```

---

## Sequelize (Node.js)

### Model definition
```javascript
// models/passkey.js
module.exports = (sequelize, DataTypes) => {
  const Passkey = sequelize.define('Passkey', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    credentialId: { type: DataTypes.BLOB, allowNull: false, unique: true },
    publicKey: { type: DataTypes.BLOB, allowNull: false },
    counter: { type: DataTypes.BIGINT, defaultValue: 0 },
    deviceType: { type: DataTypes.STRING(32), defaultValue: 'singleDevice' },
    backedUp: { type: DataTypes.BOOLEAN, defaultValue: false },
    transports: { type: DataTypes.JSON, defaultValue: [] },
    aaguid: { type: DataTypes.STRING(36) },
    name: { type: DataTypes.STRING(100) },
    lastUsedAt: { type: DataTypes.DATE },
  }, { tableName: 'passkeys', underscored: true });

  Passkey.associate = models => {
    Passkey.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    models.User.hasMany(Passkey, { foreignKey: 'userId' });
  };
  return Passkey;
};
```

### Sequelize migration file
```javascript
// migrations/YYYYMMDDHHMMSS-add-passkeys.js
'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('passkeys', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      credential_id: { type: Sequelize.BLOB, allowNull: false, unique: true },
      public_key: { type: Sequelize.BLOB, allowNull: false },
      counter: { type: Sequelize.BIGINT, defaultValue: 0 },
      device_type: { type: Sequelize.STRING(32), defaultValue: 'singleDevice' },
      backed_up: { type: Sequelize.BOOLEAN, defaultValue: false },
      transports: { type: Sequelize.JSON, defaultValue: [] },
      aaguid: { type: Sequelize.STRING(36) },
      name: { type: Sequelize.STRING(100) },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      last_used_at: { type: Sequelize.DATE },
    });
    await queryInterface.addIndex('passkeys', ['user_id']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('passkeys');
  },
};
```

---

## Mongoose (MongoDB)

### Schema
```typescript
// passkey.schema.ts
import { Schema, Document, model } from 'mongoose';

export interface IPasskey extends Document {
  userId: string;              // ref to User._id
  credentialId: Buffer;
  publicKey: Buffer;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  aaguid?: string;
  name?: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

const PasskeySchema = new Schema<IPasskey>({
  userId: { type: String, required: true, index: true },
  credentialId: { type: Buffer, required: true, unique: true },
  publicKey: { type: Buffer, required: true },
  counter: { type: Number, default: 0 },
  deviceType: { type: String, default: 'singleDevice' },
  backedUp: { type: Boolean, default: false },
  transports: { type: [String], default: [] },
  aaguid: { type: String },
  name: { type: String },
  lastUsedAt: { type: Date },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export const Passkey = model<IPasskey>('Passkey', PasskeySchema);
```

### NestJS + Mongoose decorator style
```typescript
// passkey.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PasskeyDocument = HydratedDocument<Passkey>;

@Schema({ collection: 'passkeys', timestamps: { createdAt: true, updatedAt: false } })
export class Passkey {
  @Prop({ required: true, index: true }) userId: string;
  @Prop({ required: true, unique: true, type: Buffer }) credentialId: Buffer;
  @Prop({ required: true, type: Buffer }) publicKey: Buffer;
  @Prop({ default: 0 }) counter: number;
  @Prop({ default: 'singleDevice' }) deviceType: string;
  @Prop({ default: false }) backedUp: boolean;
  @Prop({ type: [String], default: [] }) transports: string[];
  @Prop() aaguid: string;
  @Prop() name: string;
  @Prop() lastUsedAt: Date;
}
export const PasskeySchema = SchemaFactory.createForClass(Passkey);
```

---

## SQLAlchemy (Python — Django or FastAPI)

### Model (alembic-compatible)
```python
# models/passkey.py
from sqlalchemy import Column, String, LargeBinary, BigInteger, Boolean, ARRAY, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from datetime import datetime
import uuid
from .base import Base

class Passkey(Base):
    __tablename__ = 'passkeys'

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(PG_UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    credential_id = Column(LargeBinary, unique=True, nullable=False)
    public_key = Column(LargeBinary, nullable=False)
    counter = Column(BigInteger, default=0, nullable=False)
    device_type = Column(String(32), default='singleDevice')
    backed_up = Column(Boolean, default=False, nullable=False)
    transports = Column(ARRAY(String), default=list)   # PostgreSQL only; use JSON for MySQL
    aaguid = Column(String(36), nullable=True)
    name = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    user = relationship('User', back_populates='passkeys')

# In your User model — add:
# passkey_user_id = Column(PG_UUID(as_uuid=True), unique=True, default=uuid.uuid4)
# passkeys = relationship('Passkey', back_populates='user', cascade='all, delete-orphan')
```

### Alembic migration
```bash
alembic revision --autogenerate -m "add_passkeys"
alembic upgrade head
```

---

## Django ORM

```python
# passkeys/models.py
from django.db import models
from django.conf import settings
import uuid

class Passkey(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='passkeys'
    )
    credential_id = models.BinaryField(unique=True, null=False)
    public_key = models.BinaryField(null=False)
    counter = models.BigIntegerField(default=0)
    device_type = models.CharField(max_length=32, default='singleDevice')
    backed_up = models.BooleanField(default=False)
    transports = models.JSONField(default=list)
    aaguid = models.CharField(max_length=36, blank=True, null=True)
    name = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'passkeys'
        indexes = [models.Index(fields=['user'])]

    def __str__(self):
        return f"Passkey({self.name or 'unnamed'}) for {self.user}"

# In your User model — add one line:
# passkey_user_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
```

```bash
python manage.py makemigrations passkeys
python manage.py migrate
```

---

## Hibernate / JPA (Spring Boot)

```java
@Entity
@Table(name = "passkeys", indexes = @Index(columnList = "user_id"))
public class PasskeyCredential {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "credential_id", columnDefinition = "BYTEA", unique = true, nullable = false)
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
// In User entity: add @Column(name = "passkey_user_id", unique = true) private UUID passkeyUserId = UUID.randomUUID();
```

---

## Raw SQL Migration (fallback for any framework)

```sql
-- Add passkey_user_id to existing users table (PII-free user handle for WebAuthn)
ALTER TABLE users ADD COLUMN passkey_user_id UUID UNIQUE DEFAULT gen_random_uuid();

-- Create passkeys table
CREATE TABLE passkeys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    credential_id   BYTEA UNIQUE NOT NULL,
    public_key      BYTEA NOT NULL,
    counter         BIGINT NOT NULL DEFAULT 0,
    device_type     VARCHAR(32) NOT NULL DEFAULT 'singleDevice',
    backed_up       BOOLEAN NOT NULL DEFAULT FALSE,
    transports      TEXT[] NOT NULL DEFAULT '{}',
    aaguid          VARCHAR(36),            -- passkey provider identifier
    name            VARCHAR(100),           -- display name derived from aaguid
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_passkeys_user_id ON passkeys(user_id);

-- Rollback
-- ALTER TABLE users DROP COLUMN passkey_user_id;
-- DROP TABLE IF EXISTS passkeys;
```

For **MySQL**:
```sql
ALTER TABLE users ADD COLUMN passkey_user_id CHAR(36) UNIQUE DEFAULT (UUID());

CREATE TABLE passkeys (
    id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id         CHAR(36) NOT NULL,
    credential_id   BLOB NOT NULL,
    public_key      BLOB NOT NULL,
    counter         BIGINT NOT NULL DEFAULT 0,
    device_type     VARCHAR(32) NOT NULL DEFAULT 'singleDevice',
    backed_up       TINYINT(1) NOT NULL DEFAULT 0,
    transports      JSON,
    aaguid          VARCHAR(36),
    name            VARCHAR(100),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    DATETIME,
    UNIQUE KEY uq_credential_id (credential_id(255)),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
);
```

---

## Performance & Indexing Guidance

### Required indexes (created by the schema above)

- `credential_id` — UNIQUE index (already declared) — fastest auth lookup path
- `user_id` — INDEX — listing a user's passkeys in Account Settings

### Query patterns to optimize for

```sql
-- Authentication: lookup by credential ID (most frequent, must be fast)
SELECT * FROM passkeys WHERE credential_id = $1;

-- Account Settings: list all passkeys for a user
SELECT id, name, aaguid, device_type, backed_up, created_at, last_used_at
FROM passkeys
WHERE user_id = $1
ORDER BY created_at DESC;
-- Paginate at 20 per page — users rarely have more than 5 passkeys in practice

-- Delete: ownership check + delete (atomic)
DELETE FROM passkeys WHERE id = $1 AND user_id = $2;
```

### Challenge storage sizing (Redis)

```
Key pattern: passkey:challenge:{session_id}
Value:       base64url challenge string (~43 bytes)
TTL:
  Registration:    300 seconds (5 min) — user is authenticated, fast flow
  Authentication:  600 seconds (10 min) — may include cross-device BLE setup
Eviction policy:  allkeys-lru (Redis) — safe: challenges re-generated on expiry

Max concurrent challenges per user: 1
(Overwrite existing challenge if user requests a new one before TTL expires)
```

### Soft delete vs hard delete for audit trails

If your compliance requirements mandate audit trails:

```sql
-- Option: Add soft delete column to passkeys table
ALTER TABLE passkeys ADD COLUMN deleted_at TIMESTAMPTZ;

-- Queries must filter: WHERE deleted_at IS NULL
-- Periodic cleanup job: DELETE FROM passkeys WHERE deleted_at < NOW() - INTERVAL '90 days'
```

Soft delete is optional — hard delete (default) is simpler and keeps the
table lean. Only use soft delete if legally required to retain records.

### Passkey count limits

Allowing unlimited passkeys per user is a potential DoS vector (storage
exhaustion). Recommend capping at 20–50 passkeys per user server-side:

```typescript
// Before creating a new passkey:
const count = await prisma.passkey.count({ where: { userId } });
if (count >= 20) throw new Error('Maximum number of passkeys reached');
```
