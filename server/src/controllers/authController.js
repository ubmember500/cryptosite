const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { registerSchema, loginSchema } = require('../utils/validators');
const { sendPasswordResetEmail, getResetLink } = require('../utils/email');

const RESET_TOKEN_EXPIRY_HOURS = 1;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Register new user
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    const validatedData = registerSchema.parse(req.body);
    const { username, email, password } = validatedData;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username },
        ],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        error: existingUser.email === email ? 'Email already registered' : 'Username already taken',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        email: true,
        subscriptionPlan: true,
        createdAt: true,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.status(201).json({
      user,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Login user
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const validatedData = loginSchema.parse(req.body);
    const { email, password } = validatedData;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        subscriptionPlan: user.subscriptionPlan ?? 'free',
        createdAt: user.createdAt,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get current user
 * GET /api/auth/me
 * Protected route - requires authMiddleware
 */
async function getMe(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        subscriptionPlan: true,
        createdAt: true,
        telegramChatId: true,
        telegramConnectedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    // Return a plain serializable object (dates to ISO string) to avoid 500 from res.json()
    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      subscriptionPlan: user.subscriptionPlan ?? 'free',
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
      telegramChatId: user.telegramChatId ?? null,
      telegramConnectedAt: user.telegramConnectedAt instanceof Date ? user.telegramConnectedAt.toISOString() : (user.telegramConnectedAt ?? null),
    };

    res.json({ user: safeUser });
  } catch (error) {
    console.error('[authController.getMe] Error:', error?.message, error);
    next(error);
  }
}

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
async function refresh(req, res, next) {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(token);

    // Generate new access token
    const accessToken = generateAccessToken(decoded.userId);

    res.json({ accessToken });
  } catch (error) {
    next(error);
  }
}

/**
 * Request password reset
 * POST /api/auth/forgot-password
 * Creates a single-use, time-limited token, stores its hash, and sends email with link.
 * Always returns the same message (no user enumeration).
 */
async function forgotPassword(req, res, next) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // Invalidate any existing unused reset tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const resetLink = getResetLink(rawToken);
      try {
        await sendPasswordResetEmail(user.email, resetLink);
      } catch (emailErr) {
        console.error('[authController.forgotPassword] Email send failed:', emailErr?.message || emailErr);
        if (process.env.DEV_SHOW_RESET_LINK !== 'true') {
          return res.status(503).json({
            error: 'Could not send reset email. Please try again later or contact support.',
          });
        }
      }

      const payload = {
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
      if (process.env.DEV_SHOW_RESET_LINK === 'true') {
        payload.resetLink = resetLink;
      }
      return res.json(payload);
    }

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Reset password with token
 * POST /api/auth/reset-password
 * Validates token (single-use, not expired), updates password, marks token used.
 */
async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        error: 'Invalid or expired reset link. Please request a new one.',
      });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters',
      });
    }

    const tokenHash = hashToken(token.trim());
    const now = new Date();

    const resetRecord = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (!resetRecord) {
      return res.status(400).json({
        error: 'Invalid or expired reset link. Please request a new one.',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: now },
      }),
    ]);

    res.json({
      message: 'Password has been reset. You can now sign in with your new password.',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  getMe,
  refresh,
  forgotPassword,
  resetPassword,
};
