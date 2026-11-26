# Sign in with vcglone

Desk can sign people in with the account they already have in vcglone. vcglone remains the place where the password is checked; Desk only receives a short-lived, signed proof of that sign-in. Desk never sees or stores a vcglone password.

A Desk account is created automatically the first time someone signs in with vcglone. No superadmin needs to pre-create it. vcglone proves *who* the person is and supplies their role; Desk creates the account in the default queue and keeps the account's active flag.

## Flow

1. The sign-in button on `/login` or `/admin` opens `GET /api/v1/auth/sso/start?door=staff|admin`.
2. Desk stores a signed `state` + door in an HttpOnly cookie and redirects to vcglone's `/api/sso/authorize`.
3. If there is no vcglone session, vcglone sends the person to its login page with `callbackUrl` set back to the authorize URL. After a successful vcglone login, the browser returns there.
4. vcglone re-reads the person from its database, checks `employmentStatus === ACTIVE`, and signs a 60-second JWT (`HS256`) containing `sub`, `email`, `name`, `role`, `departmentId`, `employmentStatus`, `jti`, `iss` and `aud`. It redirects to Desk's callback with `assertion` and `state`.
5. Desk checks `state` against the cookie, verifies the JWT signature/issuer/audience/expiry, and records `jti` so the same URL cannot be replayed. It finds the Desk user by `sso_subject`, then by email, and **creates one if neither exists**.
6. On every sign-in, Desk syncs name, email, role and department from vcglone: `EMPLOYEE → member`, `MANAGER → lead`, `HR_ADMIN`/`SUPER_ADMIN → admin`. The vcglone department is mapped to a Desk queue (see below); users are moved and added as recipients of that queue. A disabled Desk account is not re-enabled.
7. Desk enforces the door: `/admin` requires `role = admin`; admins cannot use `/login`. It then creates a normal Desk session and the usual `desk_session` cookie. Every existing route and `/ws` works unchanged.

Password login stays enabled. Existing password users are linked by email on their first vcglone sign-in; their Argon2 hash is left alone. A manually assigned Desk role or department is overwritten by the mapping above at the next vcglone sign-in; use the password account if you need a role that vcglone does not map.

## Setup

Generate one shared secret, at least 32 random bytes, and set it in **both** apps. Never commit it.

In vcglone's `.env`:

```
APP_URL="http://localhost:3100"
SSO_ISSUER="http://localhost:3100"
SSO_CLIENT_ID="desk"
SSO_REDIRECT_URI="http://localhost:3000/api/v1/auth/sso/callback"
SSO_SHARED_SECRET="the-same-secret"
```

In Desk's `.env`:

```
APP_ORIGIN=http://localhost:3000
VCGLONE_URL=http://localhost:3100
SSO_ISSUER=http://localhost:3100
SSO_CLIENT_ID=desk
SSO_REDIRECT_URI=http://localhost:3000/api/v1/auth/sso/callback
SSO_SHARED_SECRET=the-same-secret
SSO_DEFAULT_DEPARTMENT=it-software
SSO_DEPARTMENT_MAP={"IT Department":"it-software"}
```

`SSO_DEFAULT_DEPARTMENT` is only a fallback when a vcglone department is missing or unmapped. `SSO_DEPARTMENT_MAP` optionally overrides the built-in name-to-queue mapping; names are matched case-insensitively after punctuation is normalized.

### Department mapping

The built-in mapping from vcglone department names to Desk queues is:

| vcglone | Desk |
| --- | --- |
| IT Department, Etcon Labs Team | IT / Software |
| Operations Team | Business Operations |
| Human Resource | HR / Admin |
| Account-Finance-Admin | Account / Finance |
| Sales & Biz Development, Technical Sales | Sales |
| BUSINESS DEVELOPMENT/TRAINING CENTRE | Business Development |
| Exhibition Team | Exhibition |
| CREATIVE MARKETING, Procument & Customer Service | Creative Marketing / Customer Service |
| Logistics | Logistic / Warehouse |

Set `SSO_DEPARTMENT_MAP` to change any of these without editing code. Roles and departments are re-synced at every sign-in, so changing someone in Desk manually does not stick when they use vcglone.

`SSO_ISSUER` must match exactly in both apps; so must `SSO_CLIENT_ID`, `SSO_REDIRECT_URI` and the secret. `SSO_REDIRECT_URI` is allowlisted in vcglone, so a client cannot choose where the assertion is sent. Run the two apps on different ports in development — both default to 3000. In production both must be HTTPS so the browser sends the `Secure` cookies.

Run `npm run db:migrate` in Desk. Migration 2 makes `users.password_hash` nullable and adds `users.sso_subject`, `users.identity_provider` and `sso_assertions`.

## Failure messages on the sign-in pages

| Query error | Meaning |
| --- | --- |
| `sso-unavailable` | One or both apps are missing SSO configuration. |
| `sso-expired` | The state cookie is missing or does not match the callback. |
| `sso-failed` | Signature, issuer, audience, expiry or replay check failed. |
| `sso-inactive` | The vcglone account is no longer `ACTIVE`. |
| `sso-disabled` | The Desk account is disabled. |
| `sso-no-account` | Desk could not create the account automatically; a superadmin can check the logs. |
| `sso-not-admin`, `sso-use-admin` | The account used the wrong door. |

## Notes

- The assertion is one-time and expires after 60 seconds. Desk accumulates no login tokens.
- First login creates the Desk user, so no superadmin setup row is needed. vcglone `HR_ADMIN` and `SUPER_ADMIN` accounts become Desk admins; only use that mapping if those people should administer the ticket desk.
- Desk's session is still 30 days, independent of vcglone's shorter NextAuth session. Signing out of Desk clears only Desk's session. Federated single logout is not implemented.
- If another app needs to sign in with vcglone later, give it a different `SSO_CLIENT_ID` and replace the shared secret with per-client keys (or move to OIDC) rather than sharing this secret widely.
