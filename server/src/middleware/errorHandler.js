/**
 * Global error handler middleware
 * Catches all errors, logs them, and sends JSON response
 * Handles Prisma errors (unique constraint, etc.)
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  console.error('Error:', err);

  // Handle Prisma errors
  if (err.code === 'P2002') {
    // Unique constraint violation
    return res.status(409).json({
      error: 'A record with this value already exists',
    });
  }

  if (err.code === 'P2025') {
    // Record not found
    return res.status(404).json({
      error: 'Record not found',
    });
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: err.message || 'Invalid or expired token',
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
  });
}

module.exports = errorHandler;
