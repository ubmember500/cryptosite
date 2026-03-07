// ── Per-token minimum wall size thresholds ──────────────────────────────────
// Walls below these USD values are filtered out for the respective token.
// This prevents "density spam" on high-cap tokens with extremely liquid order
// books — only genuinely large walls are shown.
//
// Rationale: BTC's order book routinely has $5-10M levels that are noise, while
// for a small-cap token $500K can be a meaningful wall.  These defaults reflect
// typical order-book depth and are designed so only **above-average** walls for
// each token appear in the density screener.
//
// Users can override any of these via Individual Settings (per-user DB records).
// ---------------------------------------------------------------------------

const TOKEN_THRESHOLDS = {
  // ── Tier 1: Ultra-liquid, only mega walls ─────────────────
  BTC:  50_000_000,     // $50M – massive books, only show true whales
  ETH:  30_000_000,     // $30M – second most liquid

  // ── Tier 2: Major alts with deep books ────────────────────
  BNB:  15_000_000,     // $15M
  SOL:  15_000_000,     // $15M – very active futures & spot

  // ── Tier 3: Top 10 by market cap ──────────────────────────
  XRP:   7_000_000,     // $7M
  DOGE:  5_000_000,     // $5M – meme king, surprisingly liquid
  ADA:   4_000_000,     // $4M
  TRX:   4_000_000,     // $4M

  // ── Tier 4: Top 15-20, solid liquidity ────────────────────
  AVAX:  3_000_000,     // $3M
  LINK:  3_000_000,     // $3M – major DeFi / oracle
  TON:   3_000_000,     // $3M
  SHIB:  3_000_000,     // $3M
  '1000SHIB': 3_000_000,
  SUI:   3_000_000,     // $3M
  BCH:   3_000_000,     // $3M – BTC fork, liquid
  ETC:   3_000_000,     // $3M – user specified

  // ── Tier 5: Top 20-30, established projects ───────────────
  XLM:   2_000_000,     // $2M
  DOT:   2_000_000,     // $2M
  HBAR:  2_000_000,     // $2M
  LTC:   2_000_000,     // $2M
  UNI:   2_000_000,     // $2M – major DEX
  NEAR:  2_000_000,     // $2M
  APT:   2_000_000,     // $2M
  PEPE:  2_000_000,     // $2M
  '1000PEPE': 2_000_000,
  ICP:   2_000_000,     // $2M
  AAVE:  2_000_000,     // $2M – DeFi blue chip
  HYPE:  2_000_000,     // $2M
  RENDER: 2_000_000,    // $2M – AI/GPU
  FET:   2_000_000,     // $2M – AI

  // ── Tier 6: Top 30-50, moderate liquidity ─────────────────
  MNT:   1_500_000,     // $1.5M
  FIL:   1_500_000,     // $1.5M
  ARB:   1_500_000,     // $1.5M – L2
  ATOM:  1_500_000,     // $1.5M – Cosmos hub
  OP:    1_500_000,     // $1.5M – L2
  TAO:   1_500_000,     // $1.5M – AI
  MKR:   1_500_000,     // $1.5M – DeFi OG
  CRO:   1_500_000,     // $1.5M
  STX:   1_500_000,     // $1.5M – Bitcoin L2
  IMX:   1_500_000,     // $1.5M – Gaming L2

  // ── Tier 7: Top 50-80 ────────────────────────────────────
  VET:   1_000_000,     // $1M
  GRT:   1_000_000,     // $1M
  INJ:   1_000_000,     // $1M
  THETA: 1_000_000,     // $1M
  FTM:   1_000_000,     // $1M (Sonic)
  ALGO:  1_000_000,     // $1M
  SEI:   1_000_000,     // $1M
  JASMY: 1_000_000,     // $1M
  ONDO:  1_000_000,     // $1M – RWA
  LDO:   1_000_000,     // $1M – Lido
  PYTH:  1_000_000,     // $1M
  TIA:   1_000_000,     // $1M – Celestia
  BONK:  1_000_000,     // $1M
  '1000BONK': 1_000_000,
  FLOKI: 1_000_000,     // $1M
  '1000FLOKI': 1_000_000,
  WIF:   1_000_000,     // $1M
  JUP:   1_000_000,     // $1M
  PENDLE: 1_000_000,    // $1M
  RUNE:  1_000_000,     // $1M – THORChain
  ENS:   1_000_000,     // $1M
  ENA:   1_000_000,     // $1M – Ethena
  DYDX:  1_000_000,     // $1M
  W:     1_000_000,     // $1M – Wormhole
  BLUR:  1_000_000,     // $1M
  MINA:  1_000_000,     // $1M
  FLOW:  1_000_000,     // $1M
  AXS:   1_000_000,     // $1M
  SAND:  1_000_000,     // $1M
  MANA:  1_000_000,     // $1M
  GALA:  1_000_000,     // $1M
  APE:   1_000_000,     // $1M
  SNX:   1_000_000,     // $1M
  '1INCH': 1_000_000,   // $1M
  COMP:  1_000_000,     // $1M
  CRV:   1_000_000,     // $1M
  SUSHI: 1_000_000,     // $1M
  YFI:   1_000_000,     // $1M
  KAVA:  1_000_000,     // $1M
  CELO:  1_000_000,     // $1M
  ORDI:  1_000_000,     // $1M
  '1000SATS': 1_000_000,
  '1000CAT': 1_000_000,

  // ── Tokenized commodities ─────────────────────────────────
  XAU:   5_000_000,     // $5M – Gold, very liquid
  XAG:   4_000_000,     // $4M – Silver
};

export default TOKEN_THRESHOLDS;
