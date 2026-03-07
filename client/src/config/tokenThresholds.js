// ── Per-token minimum wall size thresholds ──────────────────────────────────
// Walls below these USD values are filtered out for the respective token.
// This prevents "density spam" on high-cap tokens with extremely liquid order
// books — only genuinely large walls are shown.
//
// These are the **generic fallback** thresholds — applied when neither the user
// has a saved Individual Setting nor a TOKEN_DEFAULTS per-exchange entry exists.
//
// VALUES ARE CALIBRATED conservatively so legitimate walls are NOT hidden:
//   - Real BTC walls on Binance futures are typically $3-20M
//   - On Bybit/OKX the same token has 3-5x thinner books
//   - Hence these are set to ~2-3x the typical single-level noise floor
//
// For per-exchange precision, use TOKEN_DEFAULTS in FilterPanel.jsx or the
// Individual Settings modal. Users can override any of these via their account.
// ---------------------------------------------------------------------------

const TOKEN_THRESHOLDS = {
  // ── Tier 1: Ultra-liquid ──────────────────────────────────
  BTC:  4_000_000,      // $4M – BTC books are massive, $4M+ is meaningful
  ETH:  2_000_000,      // $2M – second most liquid

  // ── Tier 2: Major alts with deep books ────────────────────
  BNB:  1_500_000,      // $1.5M
  SOL:  1_500_000,      // $1.5M

  // ── Tier 3: Top 10 by market cap ──────────────────────────
  XRP:    800_000,      // $800K
  DOGE:   700_000,      // $700K – meme king, liquid
  ADA:    600_000,      // $600K
  TRX:    500_000,      // $500K

  // ── Tier 4: Top 15-25, solid liquidity ────────────────────
  AVAX:   500_000,      // $500K
  LINK:   500_000,      // $500K
  TON:    500_000,      // $500K
  SHIB:   500_000,      // $500K
  '1000SHIB': 500_000,
  SUI:    500_000,      // $500K
  BCH:    500_000,      // $500K
  ETC:    400_000,      // $400K
  XLM:    400_000,      // $400K
  DOT:    400_000,      // $400K
  HBAR:   400_000,      // $400K
  LTC:    400_000,      // $400K

  // ── Tier 5: Top 25-50, established projects ───────────────
  UNI:    300_000,      // $300K
  NEAR:   300_000,      // $300K
  APT:    300_000,      // $300K
  PEPE:   300_000,      // $300K
  '1000PEPE': 300_000,
  ICP:    300_000,      // $300K
  AAVE:   300_000,      // $300K
  HYPE:   300_000,      // $300K
  RENDER: 300_000,      // $300K
  FET:    300_000,      // $300K
  MNT:    250_000,      // $250K
  FIL:    250_000,      // $250K
  ARB:    250_000,      // $250K
  ATOM:   250_000,      // $250K
  OP:     250_000,      // $250K
  TAO:    250_000,      // $250K
  MKR:    250_000,      // $250K
  CRO:    250_000,      // $250K
  STX:    250_000,      // $250K
  IMX:    250_000,      // $250K

  // ── Tier 6: Top 50-80 ────────────────────────────────────
  VET:    200_000,      // $200K
  GRT:    200_000,      // $200K
  INJ:    200_000,      // $200K
  THETA:  200_000,      // $200K
  FTM:    200_000,      // $200K (Sonic)
  ALGO:   200_000,      // $200K
  SEI:    200_000,      // $200K
  JASMY:  200_000,      // $200K
  ONDO:   200_000,      // $200K
  LDO:    200_000,      // $200K
  PYTH:   200_000,      // $200K
  TIA:    200_000,      // $200K
  BONK:   200_000,      // $200K
  '1000BONK': 200_000,
  FLOKI:  200_000,      // $200K
  '1000FLOKI': 200_000,
  WIF:    200_000,      // $200K
  JUP:    200_000,      // $200K
  PENDLE: 200_000,      // $200K
  RUNE:   200_000,      // $200K
  ENS:    200_000,      // $200K
  ENA:    200_000,      // $200K
  DYDX:   200_000,      // $200K
  W:      200_000,      // $200K
  BLUR:   200_000,      // $200K
  MINA:   200_000,      // $200K
  FLOW:   200_000,      // $200K
  AXS:    200_000,      // $200K
  SAND:   200_000,      // $200K
  MANA:   200_000,      // $200K
  GALA:   200_000,      // $200K
  APE:    200_000,      // $200K
  SNX:    200_000,      // $200K
  '1INCH': 200_000,     // $200K
  COMP:   200_000,      // $200K
  CRV:    200_000,      // $200K
  SUSHI:  200_000,      // $200K
  YFI:    200_000,      // $200K
  KAVA:   200_000,      // $200K
  CELO:   200_000,      // $200K
  ORDI:   200_000,      // $200K
  '1000SATS': 200_000,
  '1000CAT': 200_000,
  ZEC:    200_000,      // $200K – Zcash
  WLD:    200_000,      // $200K – Worldcoin
  KAS:    200_000,      // $200K

  // ── Tokenized commodities ─────────────────────────────────
  XAU:    800_000,      // $800K – Gold, liquid commodity
  XAG:    500_000,      // $500K – Silver
};

export default TOKEN_THRESHOLDS;
