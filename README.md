# Crypto Exchange Alerts Platform

A full-stack cryptocurrency price alert platform with real-time charts, custom alerts, and market analysis.

## 🏗️ Architecture & Development

This project uses an **agent-based development approach**. The main architect has created detailed task assignments for specialized agents to implement different parts of the system.

### 📋 For Agents

**👉 See `AGENT_TASKS.md` for detailed task assignments**

Each agent has a specific role:
- **Agent 4**: Database & Authentication (Foundation)
- **Agent 1**: Backend API Server
- **Agent 3**: UI Design System & Components
- **Agent 2**: Frontend Pages & Integration

**Execution Order**: Agent 4 → Agent 1 → (Agent 3 parallel) → Agent 2

### 📖 Architecture Overview

See `ARCHITECTURE_OVERVIEW.md` for:
- System architecture diagram
- Technology stack
- API endpoints
- Database schema
- Real-time event flow

## 🚀 Quick Start (After Implementation)

Once all agents complete their tasks:

```bash
# Install root dependencies
npm install

# Setup both client and server (installs deps, runs migrations)
npm run setup

# Run both servers in development mode
npm run dev
```

- **Backend API**: http://localhost:5000
- **Frontend App**: http://localhost:5173

## ✨ Features

- 🔐 User authentication (JWT)
- 📊 Advanced charting (TradingView widget)
- 🔔 Custom price alerts (above/below/percentage)
- 📈 Real-time market data (CoinGecko API)
- ⭐ Personal watchlist
- 🔴 Live price updates via WebSocket
- 📱 Responsive dark-themed UI

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, React Router, Zustand, Tailwind CSS
- **Backend**: Node.js, Express, Socket.IO
- **Database**: SQLite + Prisma ORM
- **Charts**: TradingView Widget, Lightweight Charts
- **Real-time**: Socket.IO
- **Auth**: JWT (access + refresh tokens)

## 📁 Project Structure

```
crypto-exchange-alerts/
├── client/                    # React frontend
│   ├── src/
│   │   ├── pages/            # Page components
│   │   ├── components/       # Reusable components
│   │   ├── store/            # Zustand stores
│   │   ├── services/         # API services
│   │   └── hooks/            # Custom hooks
├── server/                    # Express backend
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── controllers/     # Route handlers
│   │   ├── services/        # Business logic
│   │   ├── middleware/      # Auth, error handling
│   │   └── utils/           # JWT, validators
│   └── prisma/              # Database schema & migrations
├── AGENT_TASKS.md           # Detailed agent assignments
├── ARCHITECTURE_OVERVIEW.md # Architecture reference
└── package.json             # Root workspace config
```

## 📝 Development Notes

- Backend runs on port 5000
- Frontend runs on port 5173 (Vite default)
- Database: SQLite (file: `server/dev.db`)
- Alert engine runs every 30 seconds
- Price data cached for 30 seconds to respect API limits

## 🔒 Environment Variables & Startup

Create **server/.env** and set your secrets (see `server/.env.example`). Include at least:
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `TELEGRAM_BOT_TOKEN` for the Telegram notification bot (see below).

For production deployments (Vercel frontend + Render API), ensure:
- `client/.env.production`: `VITE_API_BASE_URL=https://<your-render-domain>/api`
- `client/.env.production`: `VITE_SOCKET_URL=https://<your-render-domain>`
- `server/.env`: `FRONTEND_URL=https://<primary-frontend-domain>` (used in email reset links)
- `server/.env`: `FRONTEND_URLS=https://<frontend-1>,https://<frontend-2>` (API + Socket.IO CORS allowlist)

Start the server from repo root with **`npm run dev`** or from **server/** with **`npm run dev`** so that the working directory is server/ and server/.env is loaded. If you run from project root (e.g. `node server/src/index.js`), .env is still loaded from **server/.env**.

On startup, the server logs **"Telegram bot: configured"** or **"Telegram bot: not configured"**, and if configured, **"Telegram updates: webhook"** or **"Telegram updates: polling"** plus the bot username when getMe succeeds.

### Telegram bot setup (one-time)

The Telegram notification bot is **not** created by the app; it is created once by an admin:

1. Open Telegram, message [@BotFather](https://t.me/BotFather), run `/newbot`, follow the steps, and copy the **bot token**.
2. Put the token in **server/.env** as `TELEGRAM_BOT_TOKEN=...`. Optionally set `TELEGRAM_BOT_USERNAME=YourBotName` so the backend skips a getMe call.
3. Choose how Telegram delivers updates:
   - **Production (or dev with ngrok):** Set `TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook` (or your ngrok HTTPS URL). On startup the backend calls setWebhook so Telegram POSTs updates to that URL.
   - **Local dev without public URL:** Do **not** set `TELEGRAM_WEBHOOK_URL`. The backend will use **long polling** (getUpdates) so it still receives when users press Start in Telegram; the connect flow works on localhost.
4. Restart the server. Users can then click **"Подключить"** on the Telegram Bots page, get redirected to Telegram, press Start, and their account is linked. They receive the **same alerts** as on the /alerts page, also in Telegram.

## 📚 Documentation

- **Agent Tasks**: `AGENT_TASKS.md` - Step-by-step instructions for each agent
- **Architecture**: `ARCHITECTURE_OVERVIEW.md` - System design and API reference
- **Chart Deploy Troubleshooting**: `docs/CHART-DEPLOYMENT-TROUBLESHOOTING.md` - Smoke checks and fixes when charts fail after deploy

## 📅 Futures Listings Feed

- Listings endpoint: `GET /api/market/listings`
- Data source: official exchange futures listing metadata (Binance, Bybit, OKX)
- Scope: futures listings only (no spot)
- Default behavior: upcoming listings only (`LISTINGS_PAST_DAYS=0`)

Server env options:
- `LISTINGS_PAST_DAYS` (default: `0`) — include listings from the past N days
- `LISTINGS_UPCOMING_DAYS` (default: `14`) — include listings scheduled in the next N days

---

**Status**: 🚧 In Development - Agents are implementing the system according to the architecture plan.
