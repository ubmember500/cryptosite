# Send reset link by email to users

Add your Gmail to `server/.env` so the app can email the password reset link to users.

1. **Google Account** → **Security** → turn on **2-Step Verification**.
2. **Security** → **App passwords** → create one for **Mail** → copy the 16-character password (not your normal Gmail password).
3. In **`server/.env`** add:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourname@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
MAIL_FROM=yourname@gmail.com
```

Use your real Gmail address and the App Password from step 2.

4. **Restart the server.**

After that, when a user requests “Forgot password”, the reset link is sent to their **registered email** from your Gmail.
