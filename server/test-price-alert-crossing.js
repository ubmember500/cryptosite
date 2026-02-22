const {
  hasTouchedTargetWithTolerance,
  hasCrossedTargetWithTolerance,
  hasReachedTargetFromPrevious,
} = require('./src/services/priceAlertTrigger');

function assertCase(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
  console.log(`[PASS] ${name}`);
}

function run() {
  assertCase('touch exact target', hasTouchedTargetWithTolerance(1000, 1000), true);
  assertCase('cross up (99 -> 106, target 105)', hasCrossedTargetWithTolerance(99, 106, 105), true);
  assertCase('cross down (99 -> 89, target 90)', hasCrossedTargetWithTolerance(99, 89, 90), true);
  assertCase('no cross same side (99 -> 104, target 105)', hasCrossedTargetWithTolerance(99, 104, 105), false);
  assertCase('no cross same side down (99 -> 95, target 90)', hasCrossedTargetWithTolerance(99, 95, 90), false);

  assertCase('reaches target from below after creation (0.69 -> 0.70)', hasReachedTargetFromPrevious(0.69, 0.7, 0.7), true);
  assertCase('reaches target from above after creation (0.71 -> 0.70)', hasReachedTargetFromPrevious(0.71, 0.7, 0.7), true);
  assertCase('does not trigger while staying below (0.69 -> 0.695)', hasReachedTargetFromPrevious(0.69, 0.695, 0.7), false);
  assertCase('does not trigger while staying above (0.71 -> 0.705)', hasReachedTargetFromPrevious(0.71, 0.705, 0.7), false);
  assertCase('does not trigger if already at target previously (0.70 -> 0.705)', hasReachedTargetFromPrevious(0.7, 0.705, 0.7), false);

  console.log('\nAll price crossing checks passed.');
}

run();
