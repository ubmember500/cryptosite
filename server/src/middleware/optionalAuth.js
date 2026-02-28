const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

async function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);
    if (!decoded?.userId) {
      req.user = null;
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, username: true },
    });

    req.user = user || null;
    return next();
  } catch {
    req.user = null;
    return next();
  }
}

module.exports = optionalAuthMiddleware;
