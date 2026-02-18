const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-jwt-access-secret-render';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-me-jwt-refresh-secret-render';

if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  console.warn('[auth] JWT secrets are missing in environment. Using fallback secrets. Set JWT_SECRET and JWT_REFRESH_SECRET in Render environment variables.');
}

/**
 * Generate access token for user
 * @param {string} userId - User ID
 * @returns {string} JWT access token (expires in 15 minutes)
 */
function generateAccessToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

/**
 * Generate refresh token for user
 * @param {string} userId - User ID
 * @returns {string} JWT refresh token (expires in 7 days)
 */
function generateRefreshToken(userId) {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

/**
 * Verify access token
 * @param {string} token - JWT access token
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }
}

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
