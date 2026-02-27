# Email setup  Forgot Password

The forgot-password feature emails a secure reset link to users. Two providers are supported:

- **Resend** (recommended for production  1 API key, 3 000 free emails/month, great deliverability)
- **SMTP / Gmail** (good for development/self-hosting)

Resend takes priority. If `RESEND_API_KEY` is not set, the server falls back to SMTP.

---

## Option 1  Resend (recommended for production)

1. Create a free account at [resend.com](https://resend.com).
2. Go to **API Keys**  **Create API Key**  copy it.
3. _(Optional but recommended)_ Go to **Domains**  add and verify your sending domain.  
   If you skip this, use `onboarding@resend.dev` as `MAIL_FROM` (limited to your own verified email as recipient in sandbox mode).
4. Add to **`server/.env`** (and to Render's Environment Variables in production):

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
MAIL_FROM=CryptoAlerts <noreply@yourdomain.com>
FRONTEND_URL=https://your-frontend.vercel.app
```

5. Restart the server.

---

## Option 2  Gmail SMTP (development / self-hosting)

1. **Google Account**  **Security**  enable **2-Step Verification**.
2. **Security**  **App passwords**  create one for **Mail**  copy the 16-character password.
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

4. Restart the server.

---

## Dev mode  bypass email (no provider needed)

Set `DEV_SHOW_RESET_LINK=true` in `server/.env`. The reset link will be returned directly
in the API response and shown on the "Check your email" screen, so you can test the full
flow without configuring any email provider.

---

## How it works

1. User submits `/forgot-password` with their email.
2. Server looks up the email. If found, it creates a `PasswordResetToken` (SHA-256 hashed, 1-hour expiry) and emails the link.
3. User clicks the link  `/reset-password?token=<raw_token>`.
4. Server verifies the token is unused and not expired  hashes the new password with bcrypt  saves it  marks the token as used.
5. User can now log in with the new password.
