const { __test__ } = require('./src/services/priceAlertEngine');

const results = {
  passed: 0,
  failed: 0,
};

function assertCase(id, name, actual, expected) {
  if (actual !== expected) {
    results.failed += 1;
    console.error(`[FAIL] ${id} ${name}: expected ${expected}, got ${actual}`);
    return;
  }
  results.passed += 1;
  console.log(`[PASS] ${id} ${name}`);
}

function run() {
  assertCase('CROSS-01', 'up-cross pre-step does not trigger (99 < 105)', __test__.shouldTriggerAtCurrentPrice(99, 105, 'above'), false);
  assertCase('CROSS-02', 'up-cross triggers at target (105 >= 105)', __test__.shouldTriggerAtCurrentPrice(105, 105, 'above'), true);
  assertCase('CROSS-03', 'up-cross triggers above target (106 >= 105)', __test__.shouldTriggerAtCurrentPrice(106, 105, 'above'), true);
  assertCase('CROSS-04', 'down-cross pre-step does not trigger (99 > 90)', __test__.shouldTriggerAtCurrentPrice(99, 90, 'below'), false);
  assertCase('CROSS-05', 'down-cross triggers at target (90 <= 90)', __test__.shouldTriggerAtCurrentPrice(90, 90, 'below'), true);
  assertCase('CROSS-06', 'down-cross triggers below target (89 <= 90)', __test__.shouldTriggerAtCurrentPrice(89, 90, 'below'), true);

  assertCase('CROSS-07', 'equal-at-create keeps explicit above condition', __test__.resolveCondition({ initialPrice: 100, condition: 'above' }, 100), 'above');
  assertCase('CROSS-08', 'equal-at-create keeps explicit below condition', __test__.resolveCondition({ initialPrice: 100, condition: 'below' }, 100), 'below');
  assertCase('CROSS-09', 'initial above target derives below condition', __test__.resolveCondition({ initialPrice: 101, condition: 'above' }, 100), 'below');
  assertCase('CROSS-10', 'initial below target derives above condition', __test__.resolveCondition({ initialPrice: 99, condition: 'below' }, 100), 'above');
  assertCase('CROSS-11', 'invalid target does not trigger', __test__.shouldTriggerAtCurrentPrice(100, 0, 'above'), false);

  console.log(`\nSummary: passed=${results.passed}, failed=${results.failed}`);
  if (results.failed > 0) {
    process.exitCode = 1;
    throw new Error('Price crossing regression checks failed');
  }

  console.log('All price crossing regression checks passed.');
}

run();
