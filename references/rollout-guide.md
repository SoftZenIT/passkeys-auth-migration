# Rollout Guide Reference

Sources:
- FIDO Alliance Passkey Roll-Out Guides (passkeycentral.org/passkey-roll-out-guides)
- FIDO Alliance Phishing Prevention Journey (passkeycentral.org/passkey-roll-out-guides/prevent-phishing)

---

## Part 1 — Choose Your Rollout Strategy

### Comparison Table

| Factor | Gradual | Rapid |
|---|---|---|
| Cost / effort | Low | High |
| Time to adoption | Slow (months) | Fast (weeks) |
| Team size | 1-2, part-time | Multi-department, dedicated |
| Risk level | Very low | Moderate |
| Change management | Minimal | Significant |
| Who leads | Mid-level PM or engineer | VP / Division leader |
| Best for | Dev projects, small teams, internal apps | High-traffic consumer products |

---

## Strategy A: Rapid Rollout (Recommended for consumer-facing apps)

Active promotion to maximize passkey adoption quickly. FIDO Alliance research
shows that without active promotion, enrollment rates stay in the low single digits —
Gradual alone rarely exceeds 5% adoption without a deliberate campaign.

**Choose Rapid if:** you have a public-facing sign-up flow, an active user base
with meaningful DAU, or an executive-level goal to reduce password-related costs.

### Phase 1 — Identify Needs
- Document current auth methods, costs (password reset rate, support tickets, cart abandonment)
- Define success metrics: enrollment rate target (e.g. 30% in 90 days), sign-in success rate, fallback rate
- No production changes yet

### Phase 2 — Research and Screen
- Select library (see library-matrix.md)
- Study the 2 required FIDO design patterns: Create/Manage + Sign In with a Passkey
- One sprint proof-of-concept (internal employees only, not users)
- Marketing + communications plan:
  - Email campaign: "Your account now supports passkeys"
  - In-app banner: "Sign in faster with passkeys"
  - Help center article explaining passkeys in plain language
  - Customer support team training on passkey questions

### Phase 3 — Concept and Prototype
- Implement backend endpoints (registration + authentication + credential management + rename)
- Add passkey section to Account Settings UI (hero + cards with naming + delete + rename)
- Internal QA: test on Chrome, Safari, Firefox, iOS, Android, Windows Hello
- Resolve cross-browser inconsistencies before launch

### Phase 4 — Build and Test
- Add Conditional UI (`autocomplete="username webauthn"` + `useBrowserAutofill`)
- Add explicit "Sign in with passkey" button
- During account creation: passkey as primary option, password as fallback
- During sign-in: modal upgrade prompt (once per user, dismissible, persistent dismiss stored server-side)
- During password reset: "Create a passkey instead of a new password"
- Dashboard: enrollment progress metrics
- Write integration tests (registration flow, authentication flow, rename, delete)
- Reference troubleshooting guide for known ecosystem issues

### Phase 5 — Release and Optimize
- Launch announcement (email/push/banner)
- Monitor: passkey enrollment rate, sign-in success rate, fallback usage rate
- Track: password usage decline, cart abandonment improvement, support ticket reduction
- Iterate UX based on data

**Rapid UX scope — all of the following are required:**
- Account Settings: create hero + passkey cards (with naming + rename + delete)
- Sign-in page: conditional UI + "Sign in with passkey" button + password fallback
- Post-login upgrade nudge (dismissible, never re-shown after user dismisses)
- Account creation passkey prompt
- Password reset passkey offering
- `/.well-known/passkey-endpoints` JSON file (enables Google Password Manager upgrade prompts)
- Metrics instrumentation: enrollment events, sign-in success/failure events

**Rapid rollout team:**
- Product Manager (lead)
- 2-3 Engineers (frontend + backend + DevOps)
- UX Designer
- Content writer (passkey copy)
- Marketing (email/push notifications)
- Customer support (trained on passkey FAQs)

---

## Strategy B: Gradual Rollout (For developer tools, internal apps, small teams)

Users organically self-discover passkeys in Account Settings. No campaign required.

**Choose Gradual if:** this is a developer-facing tool, an internal app, a small
team project, or a first passkey proof-of-concept before a larger rollout.

### Phase 1 — Identify Needs
- Document current auth methods, costs, and performance metrics
- Define success metrics: enrollment rate, sign-in success rate, fallback usage
- No production changes yet

### Phase 2 — Research and Screen
- Select library (see library-matrix.md)
- Study the 2 required FIDO design patterns: Create/Manage + Sign In with a Passkey
- One sprint proof-of-concept (internal employees only, not users)

### Phase 3 — Concept and Prototype
- Implement backend endpoints (registration + authentication + credential management + rename)
- Add passkey section to Account Settings UI (hero + cards with naming + delete + rename)
- Internal QA: test on Chrome, Safari, Firefox, iOS, Android, Windows Hello
- Resolve cross-browser inconsistencies before launch

### Phase 4 — Build and Test
- Add Conditional UI (`autocomplete="username webauthn"` + `useBrowserAutofill`)
- Add explicit "Sign in with passkey" button as alternative
- Write integration tests (registration flow, authentication flow, rename, delete)
- Reference troubleshooting guide for known ecosystem issues

### Phase 5 — Release and Optimize
- Launch to production (no announcement needed)
- No interrupt prompts, no popups — passkeys just appear in settings
- Monitor: passkey enrollment rate, sign-in success rate, fallback usage rate
- After stable: add optional patterns (post-login nudge, recovery flow, cross-device)

**Gradual UX scope — Initial launch (all required):**
- Account Settings: create hero + passkey cards (with naming + rename + delete)
- Sign-in page: conditional UI + "Sign in with passkey" button + password fallback

**Gradual UX scope — Post-launch (optional):**
- One-time post-login upgrade prompt (dismissible, never shown again)
- Passkey creation during account recovery

---

## Part 2 — The 4-Stage Phishing Prevention Journey

Every project should understand which stage it is at and plan toward the next.
Source: passkeycentral.org/passkey-roll-out-guides/prevent-phishing/

### Stage Table

| Stage | Phishable methods | Phishing-resistant | Description |
|---|---|---|---|
| **Legacy Authentication** | ✅ used | ❌ none | Passwords + SMS OTP only. No phishing resistance. Starting point. |
| **Optional Adoption** | ✅ allowed | ✅ available | Passkeys available alongside legacy. Users choose. Still no enforcement. |
| **Partial Prevention** | ⚠️ conditional | ✅ enforced | Passkeys required for high-risk actions (sensitive data, admin). Legacy allowed elsewhere. |
| **Full Prevention** | ❌ eliminated | ✅ exclusive | Passkeys only. No phishable fallback permitted. Maximum security. |

### Phishable methods (all of these must eventually be replaced for Full Prevention)
- Passwords
- SMS OTP
- Email OTP
- TOTP (authenticator app codes)
- WebOTP
- Push notification auth (approve/deny)
- Recovery codes

### Phishing-resistant methods (these are safe to keep)
- Passkeys (synced or device-bound)
- Hardware security keys (FIDO2)
- MNO network authentication (SIM-based)
- TLS client certificates

### Stage 1 to Stage 2 (what this skill delivers)
When you complete the migration using this skill, you move from **Legacy Authentication** to **Optional Adoption**. Both auth methods coexist. Users can choose passkeys but are not forced to.

### Stage 2 -> Stage 3 (Partial Prevention)
- Require passkeys for high-risk actions: admin panel, payment confirmation, sensitive data access
- Allow legacy auth for regular sign-in during this transition period
- RPs that have suffered phishing attacks should prioritize reaching this stage

### Stage 3 -> Stage 4 (Full Prevention — advanced)
- Deprecate all phishable methods
- Require passkey or phishing-resistant recovery (e.g., MNO network auth) for all operations
- Currently only a few RPs have achieved this due to usability and business challenges
- Requires viable alternatives for all account recovery scenarios

---

## Part 3 — Post-Launch Metrics

Track these after going live:

```
Passkey enrollment rate    = users with ≥1 passkey / total users
Sign-in success rate       = successful passkey sign-ins / total passkey attempts
Fallback rate              = password sign-ins from users who have passkeys
Deletion rate              = passkeys deleted / passkeys created
Cross-device rate          = hybrid transport sign-ins / total passkey sign-ins
Support ticket delta       = passkey-related tickets / total auth tickets
```

Target before considering password deprecation: sign-in success rate ≥ 95%.

### Real-world benchmarks (from FIDO Alliance 2023–2024 data)

| Organization | Metric | Passwords | Passkeys |
|---|---|---|---|
| Google | Sign-in success rate | 13.8% | 63.8% |
| Google | Sign-in time | 30.4 seconds | 14.9 seconds |
| KAYAK | Sign-in time reduction | — | −50% |
| KAYAK | Password reset tickets | — | Significantly reduced |
| TikTok | Sign-in success rate | — | 97% |
| TikTok | Eligible user adoption | — | 14% in first period |
| Target (retailer) | Employee adoption | — | 99% (20 months) |
| Target (retailer) | Fingerprint registrations | — | 500,000+ |

**Note:** 30–60% of contact center costs are typically attributed to account
lockout from password/OTP issues. Passkey adoption directly reduces this.

---

## Part 3b — Account Recovery Flow (with passkey enrollment)

When users go through account recovery (forgot password / account unlock),
take the opportunity to enroll a new passkey. This is the highest-intent
moment for passkey adoption — the user is already motivated to improve their
security.

### Recommended flow

```
1. User triggers "Forgot password"
2. Server sends email OTP / magic link
3. User verifies email -> server marks session: recovery_verified: true
4. ─── At this point show passkey enrollment ───
5. Passkey creation prompt:
   "You're back in! Want to sign in faster next time?
    Create a passkey — no password needed."
   [Create passkey] [Skip for now]
6. If user clicks "Create passkey":
   -> Same registration ceremony as Account Settings
   -> Require: session.recovery_verified === true (prevent unauthorized enrollment)
   -> On success: passkey added, session fully established
7. User proceeds to app normally
```

### Security requirement: Gate enrollment on recovery verification
```typescript
// Registration challenge endpoint — add recovery session check
async getRegisterChallenge(req) {
  const isAuthenticated = req.user !== null;
  const isRecoveryVerified = req.session.recovery_verified === true;

  if (!isAuthenticated && !isRecoveryVerified) {
    throw new UnauthorizedException('Must be logged in or completing account recovery');
  }
  // Proceed with challenge generation...
}
```

### Email notification after passkey creation
Always send an email when a new passkey is created (whether in Account
Settings or via account recovery). This lets users detect unauthorized
passkey registration attempts.

**Subject:** "New sign-in method added to your account"  
**Body:** "A passkey was added to your [App Name] account on [date] from
[device hint if available]. If this wasn't you, remove it at [account settings link]."

---

## Part 4 — The Future (Password Deprecation Roadmap)

**Phase: Passkey-preferred**
- Sign-in page shows passkeys as default
- Password hidden but accessible via "Use password instead" link

**Phase: Password-optional**
- Users with ≥1 passkey can delete their password
- Password remains only for account recovery

**Phase: Passkey-only (Full Prevention)**
- Legacy auth fully removed
- Phishing-resistant recovery methods only (security key, MNO auth)
- Reference: passkeycentral.org/passkey-roll-out-guides/future/

---

## Anti-Patterns to Avoid

| Anti-pattern | Why it's harmful |
|---|---|
| Force passkey creation during sign-in flow | Blocks users, high friction, high abandonment |
| Remove password auth before majority have passkeys | Locks users out, destroys trust |
| Deploy without fallback mechanism | Single point of failure |
| Short challenge TTL (<2 min) | Fails users on slow connections or hybrid flow |
| rpID with port number or protocol | Breaks WebAuthn entirely |
| Store passkeys per-device label only | Label lost if user reinstalls browser |
| Show raw WebAuthn error names to users | Confusing, exposes implementation details |
| Cap challenges in session without TTL | Challenges accumulate forever in DB/Redis |
| Allow same challenge twice | Opens replay attack vector |
