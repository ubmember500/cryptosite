function getPriceTolerance(targetValue) {
  const target = Number(targetValue);
  if (!Number.isFinite(target)) return 1e-8;
  return Math.max(Math.abs(target) * 1e-4, 1e-8);
}

function hasTouchedTargetWithTolerance(currentPrice, targetValue) {
  const current = Number(currentPrice);
  const target = Number(targetValue);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return Math.abs(current - target) <= getPriceTolerance(target);
}

function hasCrossedTargetWithTolerance(previousPrice, currentPrice, targetValue) {
  const previous = Number(previousPrice);
  const current = Number(currentPrice);
  const target = Number(targetValue);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || !Number.isFinite(target)) return false;

  const tolerance = getPriceTolerance(target);
  if (Math.abs(previous - target) <= tolerance || Math.abs(current - target) <= tolerance) {
    return true;
  }

  const prevDelta = previous - target;
  const currDelta = current - target;
  return prevDelta * currDelta < 0;
}

module.exports = {
  getPriceTolerance,
  hasTouchedTargetWithTolerance,
  hasCrossedTargetWithTolerance,
};
