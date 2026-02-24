const { z } = require('zod');

/**
 * Register validation schema
 */
const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
});

/**
 * Login validation schema
 */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Create alert validation schema
 * Supports both price and complex alerts
 */
const createAlertSchema = z.object({
  alertType: z.enum(['price', 'complex']).default('price'),
  name: z.string().optional(),
  exchange: z.string().optional(),
  exchanges: z.array(z.string()).optional(),
  market: z.enum(['futures', 'spot']).default('futures'),
  symbol: z.string().optional(),
  symbols: z.union([
    z.array(z.string()),
    z.string(), // JSON string
  ]).optional(),
  conditions: z.union([
    z.array(z.object({
      type: z.string(),
      value: z.union([z.number(), z.string()]),
      timeframe: z.string(),
    })),
    z.string(), // JSON string
  ]).optional(),
  notificationOptions: z.union([
    z.object({}).passthrough(),
    z.string(), // JSON string
  ]).optional(),
  condition: z.enum(['above', 'below']).optional(), // Optional for price alerts - backend auto-determines based on initialPrice vs targetValue
  targetValue: z.number().optional(),
  currentPrice: z.number().optional(),
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.alertType !== 'price') return;

  const hasExchange = typeof data.exchange === 'string' && data.exchange.trim() !== '';
  const hasMarket = typeof data.market === 'string' && data.market.trim() !== '';
  const hasTargetValue = Number.isFinite(Number(data.targetValue)) && Number(data.targetValue) > 0;

  const symbolFromField = typeof data.symbol === 'string' ? data.symbol.trim() : '';
  let symbolFromSymbols = '';
  if (Array.isArray(data.symbols) && data.symbols.length > 0) {
    symbolFromSymbols = String(data.symbols[0] || '').trim();
  } else if (typeof data.symbols === 'string') {
    symbolFromSymbols = data.symbols.trim();
  }
  const hasSymbol = Boolean(symbolFromField || symbolFromSymbols);

  if (!hasExchange) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['exchange'], message: 'Exchange is required for price alerts.' });
  }
  if (!hasMarket) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['market'], message: 'Market is required for price alerts.' });
  }
  if (!hasSymbol) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['symbol'], message: 'Symbol is required for price alerts.' });
  }
  if (!hasTargetValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetValue'], message: 'Target price must be greater than 0.' });
  }
});

/**
 * Update alert validation schema (partial)
 */
const updateAlertSchema = createAlertSchema.partial();

module.exports = {
  registerSchema,
  loginSchema,
  createAlertSchema,
  updateAlertSchema,
};
