const axios = require('axios');

const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

function getApiKey() {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    return null;
  }
  return apiKey;
}

/**
 * Get list of available payment currencies from NOWPayments.
 * GET /api/subscription/currencies (protected)
 * Returns: { currencies: string[] } e.g. ['btc','eth','usdttrc20',...]
 */
async function getCurrencies(req, res, next) {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Payment service unavailable',
        message: 'Payment provider is not configured.',
      });
    }

    const { data, status } = await axios.get(`${NOWPAYMENTS_API_URL}/currencies`, {
      headers: { 'x-api-key': apiKey },
      validateStatus: () => true,
    });

    if (status !== 200) {
      return res.status(502).json({
        error: 'Payment provider error',
        message: data?.message || 'Could not load currencies.',
      });
    }

    const currencies = Array.isArray(data.currencies) ? data.currencies : [];
    return res.json({ currencies });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({
        error: 'Payment provider error',
        message: err.response.data?.message || 'Could not load currencies.',
      });
    }
    next(err);
  }
}

/**
 * Create a PRO subscription payment via NOWPayments.
 * POST /api/subscription/create-pro-payment (protected)
 * Body: { pay_currency?: string } - optional, default 'btc'. Use ticker from GET /currencies.
 * Returns: { pay_address, pay_amount, pay_currency, payment_id, order_id }
 */
async function createProPayment(req, res, next) {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Payment service unavailable',
        message: 'Payment provider is not configured.',
      });
    }

    const payCurrency = (req.body?.pay_currency && String(req.body.pay_currency).trim()) || 'btc';
    const orderId = `pro_${req.user.id}_${Date.now()}`;

    const payload = {
      price_amount: 14,
      price_currency: 'usd',
      pay_currency: payCurrency.toLowerCase(),
      order_id: orderId,
      order_description: 'PRO subscription - 1 month',
    };

    const { data, status } = await axios.post(`${NOWPAYMENTS_API_URL}/payment`, payload, {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    if (status !== 200 && status !== 201) {
      const message = data?.message || data?.errors?.join?.(' ') || 'Payment provider error';
      return res.status(502).json({
        error: 'Payment provider error',
        message,
      });
    }

    return res.status(200).json({
      pay_address: data.pay_address,
      pay_amount: data.pay_amount,
      pay_currency: data.pay_currency,
      payment_id: data.payment_id,
      order_id: data.order_id || orderId,
    });
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || err.response.data?.errors?.join?.(' ') || 'Payment provider error';
      return res.status(502).json({ error: 'Payment provider error', message });
    }
    next(err);
  }
}

module.exports = {
  getCurrencies,
  createProPayment,
};
