# Email setup — Forgot Password

The forgot-password feature emails a secure reset link to users. Four providers are supported:

- **Mailjet** (recommended — free 200/day, instant activation, no domain needed)
- **Brevo** (free 300/day, no domain needed — but new accounts may need manual activation)
- **Resend** (needs a verified custom domain to send to real users)
- **SMTP / Gmail** (blocked on most cloud hosts — good for local dev only)

Priority: Brevo → Mailjet → Resend → SMTP (first configured provider wins).

---

## Option 1 — Mailjet (recommended — fastest to get working)

Mailjet uses HTTPS API (port 443), so it's not blocked by cloud providers.
Free tier: 200 emails/day, 6 000/month. **No domain needed.**
Account activates **instantly** after email verification (no manual review).

1. Create a free account at [mailjet.com](https://www.mailjet.com).
2. Go to **Account Settings** → **REST API** → **API Key Management**.
   You'll see an **API Key** and a **Secret Key**.
3. Add both to Render env vars (and `server/.env` locally):

```env
MAILJET_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAILJET_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FRONTEND_URL=https://your-frontend.vercel.app
```

4. _(Optional)_ Set a custom sender address:
```env
MAILJET_FROM=CryptoAlerts <yourname@gmail.com>
```
By default it uses `MAIL_FROM` or `SMTP_USER`. The sender email must be
verified in Mailjet (your sign-up email is auto-verified).

5. Deploy / restart. Done!

---

## Option 2 — Brevo (free, but may need activation)

Brevo (formerly Sendinblue) also uses HTTPS API. Free tier: 300 emails/day.
**No domain needed**, but new accounts sometimes require manual activation
(you get a 403 "account not yet activated" — contact Brevo support to speed it up).

1. Create a free account at [brevo.com](https://www.brevo.com).
2. Go to **SMTP & API** → **API Keys** → create one (starts with `xkeysib-`).
3. Add to Render env vars (and `server/.env` locally):

```env
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxx
FRONTEND_URL=https://your-frontend.vercel.app
```

4. _(Optional)_ Set a custom sender address:
```env
BREVO_FROM=CryptoAlerts <yourname@gmail.com>
```
By default it uses `MAIL_FROM` or `SMTP_USER`. The sender email must be
verified in Brevo (your sign-up email is auto-verified).

5. Deploy / restart.

---

## Option 3 — Resend (requires custom domain)

> **Note:** Resend's free plan is in sandbox mode — it can only send to
> the account owner's email until you verify your own domain.

1. Create a free account at [resend.com](https://resend.com).
2. Go to **Domains** → add and verify your sending domain (2 DNS records).
3. Go to **API Keys** → **Create API Key** → copy it.
4. Add to env:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM=CryptoAlerts <noreply@yourdomain.com>
FRONTEND_URL=https://your-frontend.vercel.app
```

---

## Option 4 — Gmail SMTP (local development only)

> **Warning:** Gmail SMTP is blocked from Render, Railway, and most cloud
> providers (SMTP ports 25/465/587 are firewalled). Use for local dev only.

1. **Google Account** → **Security** → enable **2-Step Verification**.
2. **Security** → **App passwords** → create one for **Mail** → copy the 16-character password.
3. Add to **`server/.env`**:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourname@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
MAIL_FROM=yourname@gmail.com
FRONTEND_URL=http://localhost:5173
```

---

## Dev mode — bypass email (no provider needed)

Set `DEV_SHOW_RESET_LINK=true` in `server/.env`. The reset link will be returned directly
in the API response and shown on the "Check your email" screen, so you can test the full
flow without configuring any email provider.

---

## How it works

1. User submits `/forgot-password` with their email.
2. Server looks up the email. If found, it creates a `PasswordResetToken` (SHA-256 hashed, 1-hour expiry) and emails the link.
3. User clicks the link → `/reset-password?token=<raw_token>`.
4. Server verifies the token is unused and not expired → hashes the new password with bcrypt → saves it → marks the token as used.
5. User can now log in with the new password.
