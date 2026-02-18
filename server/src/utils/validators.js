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
  description: z.string().optional(),
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
