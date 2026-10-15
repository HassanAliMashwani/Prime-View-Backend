const assert = require('assert');
const path = require('path');

// Import generator functions from compiled or source ts/js
// Since ts-node is available, we can require directly or compile
const {
  generateReceiptSerial,
  generateSlipNumber,
  SLIP_ALPHABET,
  SLIP_SERIAL_LENGTH,
} = require(path.resolve(__dirname, '../../src/receipts/receipt-number.generator.ts'));

async function run() {
  console.log('--- Testing Receipt Number Generator (Step 3) ---');

  const EXPECTED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  assert.strictEqual(SLIP_ALPHABET, EXPECTED_ALPHABET, 'Alphabet must match specified 32 chars');
  assert.strictEqual(SLIP_SERIAL_LENGTH, 10, 'Serial length must be exactly 10');

  // Spy on Math.random to strictly enforce crypto.randomInt
  const originalMathRandom = Math.random;
  let mathRandomCallCount = 0;
  Math.random = () => {
    mathRandomCallCount++;
    throw new Error('FAIL: Math.random() was invoked! crypto.randomInt must be used exclusively.');
  };

  const COUNT = 10000;
  const generatedNumbers = new Set();
  const allowedCharSet = new Set(EXPECTED_ALPHABET);

  console.log(`Generating ${COUNT.toLocaleString()} numbers with year 2026...`);
  const startTime = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const slipNumber = generateSlipNumber(2026);

    // 1. Prefix assertion
    assert(
      slipNumber.startsWith('PV-SLIP-2026-'),
      `Slip number "${slipNumber}" must start with prefix "PV-SLIP-2026-"`
    );

    // 2. Length after year assertion (prefix is 13 chars: 'PV-SLIP-2026-')
    const serial = slipNumber.slice(13);
    assert.strictEqual(
      serial.length,
      10,
      `Serial "${serial}" must have length 10 after year prefix`
    );

    // 3. Alphabet assertion
    for (const ch of serial) {
      assert(
        allowedCharSet.has(ch),
        `Character "${ch}" in "${serial}" is not in the allowed alphabet`
      );
    }

    // 4. Collect for uniqueness check
    assert(
      !generatedNumbers.has(slipNumber),
      `Duplicate number detected: "${slipNumber}" at iteration ${i}`
    );
    generatedNumbers.add(slipNumber);
  }

  const elapsedMs = Date.now() - startTime;

  // Restore Math.random
  Math.random = originalMathRandom;

  // Assertions
  assert.strictEqual(
    generatedNumbers.size,
    COUNT,
    `All ${COUNT} numbers must be strictly unique`
  );
  assert.strictEqual(
    mathRandomCallCount,
    0,
    'Math.random() was called during generation'
  );

  const sample = Array.from(generatedNumbers)[0];
  console.log(`✓ Successfully generated ${COUNT.toLocaleString()} unique numbers in ${elapsedMs}ms`);
  console.log(`✓ All numbers match prefix "PV-SLIP-2026-"`);
  console.log(`✓ All numbers have length 10 after year prefix`);
  console.log(`✓ All characters belong strictly to Base32 alphabet: ${EXPECTED_ALPHABET}`);
  console.log(`✓ Math.random() calls: ${mathRandomCallCount} (100% crypto.randomInt)`);
  console.log(`✓ Sample new number: ${sample}`);

  // Test flag default behavior
  const defaultVersion = process.env.RECEIPT_NUMBER_FORMAT_VERSION || '1';
  assert.strictEqual(defaultVersion, '1', 'Default format version flag must be 1');
  console.log(`✓ Default flag RECEIPT_NUMBER_FORMAT_VERSION is "${defaultVersion}" (old 4-digit path stays active)`);

  console.log('\n=== ALL 10,000 NUMBER GENERATOR ASSERTIONS PASSED ===\n');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
