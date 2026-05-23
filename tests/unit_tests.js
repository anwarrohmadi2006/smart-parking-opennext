const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function testCacheConsistency() {
  console.log('🧪 TEST 1: Cache Consistency & State Synchronization (The "Mismatched Timeline" Test)...');
  
  // Request 1: low occupancy
  console.log('   Sending Request 1: current_occ = 0.10...');
  const res1 = await fetch(`${BASE_URL}/api/predict?current_occ=0.10&weather=SUNNY&hour=10`);
  const data1 = await res1.json();
  console.log('   Request 1 current_occupancy in response:', data1.current_occupancy);

  // Request 2: high occupancy, sent IMMEDIATELY (within the throttle time limit of 2 seconds)
  console.log('   Sending Request 2 immediately: current_occ = 0.85...');
  const res2 = await fetch(`${BASE_URL}/api/predict?current_occ=0.85&weather=SUNNY&hour=10`);
  const data2 = await res2.json();
  console.log('   Request 2 current_occupancy in response:', data2.current_occupancy);

  // Assertions
  assert.strictEqual(data1.current_occupancy, 0.10, 'Request 1 occupancy should be 0.10');
  assert.strictEqual(data2.current_occupancy, 0.85, 'Request 2 occupancy should be 0.85 (must not return cached 0.10!)');
  
  console.log('   ✅ TEST 1 PASSED: Cache did not intercept different payload.');
}

async function testInterpolationMathematics() {
  console.log('🧪 TEST 2: Interpolation Mathematics Verification...');
  const res = await fetch(`${BASE_URL}/api/predict?current_occ=0.50&weather=SUNNY&hour=12`);
  const data = await res.json();
  
  const c = data.current_occupancy; // 0.50
  const p30 = data.predicted_occupancy_30min;
  
  // Calculate expected values
  const expected10 = Number((c + (p30 - c) * (1 / 3)).toFixed(4));
  const expected20 = Number((c + (p30 - c) * (2 / 3)).toFixed(4));

  console.log(`   Baseline Current: ${c}, predicted 30m: ${p30}`);
  console.log(`   Calculated 10m: ${data.predicted_occupancy_10min} | Expected: ${expected10}`);
  console.log(`   Calculated 20m: ${data.predicted_occupancy_20min} | Expected: ${expected20}`);

  assert.strictEqual(data.predicted_occupancy_10min, expected10, '10-minute prediction math should match expected linear interpolation');
  assert.strictEqual(data.predicted_occupancy_20min, expected20, '20-minute prediction math should match expected linear interpolation');
  
  console.log('   ✅ TEST 2 PASSED: Interpolation math is correct.');
}

async function runUnitTests() {
  console.log('==================================================');
  console.log('🚀 RUNNING TARGETED SMARTPARK AI UNIT TESTS');
  console.log('==================================================');
  const start = Date.now();
  try {
    await testCacheConsistency();
    console.log('--------------------------------------------------');
    await testInterpolationMathematics();
    console.log('==================================================');
    console.log(`🎉 ALL UNIT TESTS PASSED SUCCESSFULLY IN ${((Date.now() - start)/1000).toFixed(2)}s!`);
    console.log('==================================================');
  } catch (error) {
    console.error('==================================================');
    console.error('❌ UNIT TESTS FAILED!');
    console.error(error.message || error);
    console.error('==================================================');
    process.exit(1);
  }
}

runUnitTests();
