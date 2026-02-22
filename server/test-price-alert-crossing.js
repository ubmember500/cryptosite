const {
  hasTouchedTargetWithTolerance,
  hasCrossedTargetWithTolerance,
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

  console.log('\nAll price crossing checks passed.');
}

run();
