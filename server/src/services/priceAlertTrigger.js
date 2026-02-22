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

function classifyRelativeToTarget(price, targetValue) {
  const priceNum = Number(price);
  const target = Number(targetValue);
  if (!Number.isFinite(priceNum) || !Number.isFinite(target)) return null;

  const tolerance = getPriceTolerance(target);
  const delta = priceNum - target;

  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
}

function hasReachedTargetFromPrevious(previousPrice, currentPrice, targetValue) {
  const previousZone = classifyRelativeToTarget(previousPrice, targetValue);
  const currentZone = classifyRelativeToTarget(currentPrice, targetValue);

  if (previousZone == null || currentZone == null) return false;

  // Trigger only when the price reaches target/crosses target after previously
  // being clearly on one side. If previous was already near target, do not fire.
  if (previousZone === 0) return false;
  if (currentZone === 0) return true;
  return previousZone !== currentZone;
}

module.exports = {
  getPriceTolerance,
  hasTouchedTargetWithTolerance,
  hasCrossedTargetWithTolerance,
  hasReachedTargetFromPrevious,
};
