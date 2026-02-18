# Telegram Alerts Bot – Agent Task Lists

Reference: plan in `.cursor/plans/` (Telegram Alerts Bot Integration).  
Execute in order: **Database → Backend → Frontend → UI**.

---

## Agent 1: Database

**Deliverable:** Updated Prisma schema and a migration that runs without errors.

| # | Task | Details |
|---|------|---------|
| 1.1 | Extend User model | In `server/prisma/schema.prisma`, add to **User**: `telegramChatId String? @unique`, `telegramUsername String?`, `telegramConnectedAt DateTime?`. Add relation to `TelegramConnectToken[]` if you add the new model on User side. |
| 1.2 | Add TelegramConnectToken model | New model: `id String @id @default(uuid())`, `userId String`, `user User @relation(...)`, `token String @unique`, `expiresAt DateTime`, `usedAt DateTime?`, `createdAt DateTime @default(now())`. Add `@@index` on `token` (and optionally `expiresAt` for cleanup). |
| 1.3 | Run migration | Run `npx prisma migrate dev --name add_telegram_link` from project root (or server dir if prisma is there). Ensure migration applies cleanly. |
| 1.4 | No app code | Do not add or change any API or application code; schema and migration only. |

**Done when:** `prisma migrate dev` succeeds and schema matches the plan.

---

## Agent 2: Backend

**Deliverable:** Telegram connect-link, webhook (or polling), disconnect, getMe extended, and alert forwarding to Telegram. No change to existing Socket.IO behavior.

**Depends on:** Database tasks completed (User + TelegramConnectToken exist).

| # | Task | Details |
|---|------|---------|
| 2.1 | Config | Add `TELEGRAM_BOT_TOKEN` (and optional `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_BOT_USERNAME`) to `server/.env.example` with short comments. In code, if `TELEGRAM_BOT_TOKEN` is missing: connect-link and webhook return 503 or no-op; `sendMessage` no-ops. |
| 2.2 | Telegram service | Create `server/src/services/telegramService.js`. Implement: `createConnectToken(userId)` → random token (e.g. 32 bytes hex), insert into TelegramConnectToken with expiresAt = now + 15 min, return `{ token, expiresAt }`; `consumeConnectToken(token)` → find by token, check not expired and not used, return userId and set usedAt; `linkUserTelegram(userId, chatId, telegramUsername?)` → update User; `unlinkUserTelegram(userId)` → clear User telegram fields; `sendMessage(chatId, text)` → POST to `https://api.telegram.org/bot<token>/sendMessage`, handle errors and log, do not throw. |
| 2.3 | Connect-link endpoint | New route `GET /api/telegram/connect-link`, auth required. Handler: call `createConnectToken(req.user.id)`, build `connectLink = https://t.me/<botUsername>?start=CONNECT_<token>` (bot username from env or getMe cache), return `{ connectLink, expiresAt }`. If no bot token, return 503. |
| 2.4 | Webhook endpoint | New route `POST /api/telegram/webhook` **without** auth. Parse `req.body` as Telegram Update: if `message.text` matches `/start CONNECT_<token>`, extract token, `consumeConnectToken(token)`, get `chat_id` from `message.chat.id`, optional `message.from.username`, then `linkUserTelegram(userId, chatId, username)`. Always respond 200. |
| 2.5 | setWebhook (optional) | If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_URL` are set at startup, call Telegram `setWebhook` with that URL once. |
| 2.6 | Polling fallback (optional) | If no webhook URL, run getUpdates loop to process `/start CONNECT_xxx` the same way as webhook (for local dev). |
| 2.7 | Alert forwarding | In `server/src/services/alertEngine.js`, after each `socketService.emitAlertTriggered(alert.userId, payload)`: load user by `alert.userId` (select `telegramChatId`); if `user.telegramChatId` is set, format a short alert text from payload and call `telegramService.sendMessage(user.telegramChatId, text)`; catch and log errors, do not fail the alert flow. |
| 2.8 | Disconnect endpoint | New route `DELETE /api/telegram/disconnect` (or POST), auth required. Call `unlinkUserTelegram(req.user.id)`, return 204 or 200. |
| 2.9 | Expose connection status | Extend `authController.getMe` in `server/src/controllers/authController.js` to include in the user object: `telegramChatId` (or a boolean `telegramConnected`) and optionally `telegramConnectedAt`. Prefer getMe over a separate status endpoint. |

**Done when:** Connect-link returns a t.me link; webhook links user after /start CONNECT_xxx; disconnect clears link; getMe returns telegram status; triggered alerts are sent to Telegram when user is linked.

---

## Agent 3: Frontend

**Deliverable:** Connect and disconnect wired to real API; connection status from backend; Telegram Bots page uses backend state for Подключено/Отключено.

**Depends on:** Backend tasks completed (endpoints and getMe shape exist).

| # | Task | Details |
|---|------|---------|
| 3.1 | Telegram API client | New file `client/src/services/telegramService.js`: `getConnectLink()` → GET `/api/telegram/connect-link`, return `{ connectLink, expiresAt }`; `disconnectTelegram()` → DELETE `/api/telegram/disconnect`. Use the same `api` instance (with auth) as in `client/src/services/authService.js`. |
| 3.2 | Auth store / user shape | Ensure `client/src/store/authStore.js` stores the full user from `getMe()`. After backend extends getMe, user will have e.g. `telegramChatId` or `telegramConnectedAt`. Expose a derived flag if needed (e.g. `telegramConnected: !!user?.telegramChatId`). |
| 3.3 | Telegram Bots page – Connect | In `client/src/pages/TelegramBots.jsx`: For "Бот оповещений Telegram", derive connection status from backend (auth store user, e.g. `user?.telegramConnectedAt` or `user?.telegramChatId`). On "Подключить" click: call `telegramService.getConnectLink()`, then redirect (e.g. `window.location.href = connectLink` or `window.open(connectLink)`). Optional: on return to page, refetch user (e.g. on mount or focus) or poll getMe until connected. |
| 3.4 | Telegram Bots page – Disconnect | "Отключить" button: call `telegramService.disconnectTelegram()`, then refresh user (e.g. call auth store method that fetches getMe again) so the card shows "Отключено" and "Подключить". |
| 3.5 | Loading and errors | When requesting connect link, set loading (button disabled or "Opening..."); on API error (e.g. 503), show toast or inline message. Minimal UX; no full redesign. |

**Done when:** Clicking Подключить redirects to Telegram with correct link; after connecting in Telegram, page shows Подключено; Отключить clears and shows Отключено; errors are visible.

---

## Agent 4: UI

**Deliverable:** Polished /telegram-bots page: clear copy, loading/error states, Listing bot marked as coming soon. No new API or backend logic.

**Depends on:** Frontend has wired Connect/Disconnect and status (so UI can rely on real state).

| # | Task | Details |
|---|------|---------|
| 4.1 | Status and buttons | "Бот оповещений Telegram" card: green pill "Подключено" when user has Telegram linked, red pill "Отключено" when not; primary button "Подключить" when disconnected, "Отключить" when connected; "Настройки" stays secondary/placeholder. |
| 4.2 | Copy and hints | When disconnected: short line under buttons, e.g. "You will be redirected to Telegram to authorize the bot. After you press Start, you'll receive alerts here and in Telegram." (or Russian). When connected: optional one-liner "Alerts are also sent to your Telegram." |
| 4.3 | Loading and error states | Connect button: show loading (disabled + "Opening..." or spinner) while link is fetched; on server error (e.g. bot not configured), show clear inline or toast message. |
| 4.4 | Listing bot card | Leave "Бот листингов" as-is or add "Скоро" / "Coming soon" so it's clear only the Alerts bot is active. |
| 4.5 | Accessibility and responsiveness | Buttons have focus states and clear labels; layout works on small screens (existing grid). |

**Done when:** Page clearly explains the flow, shows loading/errors, and Listing bot is clearly secondary or coming soon.

---

## Order and handoff

1. **Database** completes 1.1–1.4 and confirms migration runs.
2. **Backend** implements 2.1–2.9 (optional 2.5, 2.6 as needed).
3. **Frontend** implements 3.1–3.5 after backend is deployable.
4. **UI** implements 4.1–4.5 after frontend has real connect/disconnect and status.
