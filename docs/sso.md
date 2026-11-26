# Sign in with vcglone

Desk can sign people in with the account they already have in vcglone. vcglone remains the place where the password is checked; Desk only receives a short-lived, signed proof of that sign-in. Desk never sees or stores a vcglone password.

Access is still decided in Desk. A superadmin adds the person, sets their role and department, and keeps their account active. vcglone proves *who* the person is; it does not grant Desk permissions.

## Flow

1. The sign-in button on `/login` or `/admin` opens `GET /api/v1/auth/sso/start?door=staff|admin`.
2. Desk stores a signed `state` + door in an HttpOnly cookie and redirects to vcglone's `/api/sso/authorize`.
3. If there is no vcglone session, vcglone sends the person to its login page with `callbackUrl` set back to the authorize URL. After a successful vcglone login, the browser returns there.
4. vcglone re-reads the person from its database, checks `employmentStatus === ACTIVE`, and signs a 60-second JWT (`HS256`) containing `sub`, `email`, `name`, `role`, `departmentId`, `employmentStatus`, `jti`, `iss` and `aud`. It redirects to Desk's callback with `assertion` and `state`.
5. Desk checks `state` against the cookie, verifies the JWT signature/issuer/audience/expiry, and records `jti` so the same URL cannot be replayed. It matches the person by `sso_subject`, then by email (linking the account on first sign-in).
6. Desk enforces the door: `/admin` requires `role = admin`; admins cannot use `/login`. It then creates a normal Desk session and the usual `desk_session` cookie. Every existing route and `/ws` works unchanged.

Password login stays enabled. Existing users are linked by email the first time they use vcglone sign-in; their Argon2 hash is left alone.

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
```

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
| `sso-no-account` | No Desk user has this email; a superadmin must add them. |
| `sso-not-admin`, `sso-use-admin` | The account used the wrong door. |

## Notes

- The assertion is one-time and expires after 60 seconds. Desk accumulates no login tokens.
- Desk's session is still 30 days, independent of vcglone's shorter NextAuth session. Signing out of Desk clears only Desk's session. Federated single logout is not implemented.
- If another app needs to sign in with vcglone later, give it a different `SSO_CLIENT_ID` and replace the shared secret with per-client keys (or move to OIDC) rather than sharing this secret widely.
