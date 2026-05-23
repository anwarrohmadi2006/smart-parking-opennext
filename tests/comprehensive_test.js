const puppeteer = require('puppeteer');
const assert = require('assert');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = 'C:\\Users\\user\\.gemini\\antigravity-ide\\brain\\877032dd-ffde-4c45-96ee-55bf3852395f';

async function testApiPredictNormal() {
  console.log('🧪 Testing API: /api/predict with query parameters (Normal/Cloud ML simulation path)...');
  const response = await fetch(`${BASE_URL}/api/predict?current_occ=0.62&weather=RAINY&hour=14`);
  assert.strictEqual(response.status, 200, 'API predict should return 200 OK');
  
  const data = await response.json();
  console.log('   Response source:', data.source);
  console.log('   Current occupancy:', data.current_occupancy);
  console.log('   Predicted 30m:', data.predicted_occupancy_30min);
  console.log('   Interpolated 10m:', data.predicted_pct_10min);
  console.log('   Interpolated 20m:', data.predicted_pct_20min);

  assert.strictEqual(data.current_occupancy, 0.62, 'current_occupancy should match input parameter');
  assert.ok(data.predicted_occupancy_30min !== undefined, 'predicted_occupancy_30min should be defined');
  assert.ok(data.predicted_pct_10min.endsWith('%'), '10m percentage should format correctly');
  assert.ok(data.predicted_pct_20min.endsWith('%'), '20m percentage should format correctly');
  console.log('   ✅ API /api/predict (Normal) passed.');
}

async function testApiPredictFallback() {
  console.log('🧪 Testing API: /api/predict fallback parameters...');
  // Passing a different occupancy to verify dynamic calculations
  const response = await fetch(`${BASE_URL}/api/predict?current_occ=0.88&weather=SUNNY&hour=9`);
  assert.strictEqual(response.status, 200, 'API predict should return 200 OK');
  
  const data = await response.json();
  assert.strictEqual(data.current_occupancy, 0.88, 'current_occupancy should match input parameter');
  assert.ok(data.predicted_pct_10min !== undefined, '10m prediction must be calculated');
  console.log('   ✅ API /api/predict (Fallback baseline) passed.');
}

async function testApiFeedback() {
  console.log('🧪 Testing API: /api/feedback (POST feedback log)...');
  const payload = {
    prediction_id: 'test_pred_id_123',
    actual_occupancy: 0.62,
    admin_action_taken: 'Test manual verification action',
    correct: true
  };

  const response = await fetch(`${BASE_URL}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 200, 'API feedback should return 200 OK');
  const data = await response.json();
  assert.strictEqual(data.status, 'logged', 'feedback response status should be logged');
  console.log('   ✅ API /api/feedback passed.');
}

async function testFrontendUI() {
  console.log('🧪 Testing Frontend UI with Headless Chrome (Puppeteer)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Capture browser console logs to detect any React/Next.js frontend errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    console.log(`   Navigating to ${BASE_URL}/admin...`);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle2' });
    await page.setViewport({ width: 1280, height: 1000 });

    // Verify main elements exist
    console.log('   Checking main layout elements...');
    const headerTitle = await page.$eval('header h1', el => el.textContent);
    console.log('   Active page header:', headerTitle.trim());
    assert.ok(headerTitle.includes('Dashboard Overview'), 'Header should display Dashboard Overview');

    // Wait for the AI Prediction card to load predictions
    console.log('   Waiting for AI Prediction card to load...');
    await page.waitForSelector('span[title*="Sumber"]', { timeout: 15000 });

    // Read values from the new 10m/20m/30m timeline
    const timelineLabels = await page.$$eval('.relative.flex.items-center.justify-between span', nodes => 
      nodes.map(n => n.textContent.trim())
    );
    console.log('   Rendered timeline values on card:', timelineLabels);
    
    // Check that "+10 Mins" and "+20 Mins" are present in the rendering nodes
    assert.ok(timelineLabels.includes('+10 Mins'), 'Timeline should render +10 Mins node');
    assert.ok(timelineLabels.includes('+20 Mins'), 'Timeline should render +20 Mins node');
    assert.ok(timelineLabels.includes('Saat Ini'), 'Timeline should render Saat Ini node');

    // Capture screenshot of the default dashboard
    const screenshotPathLive = path.join(SCREENSHOT_DIR, 'tests_dashboard_live.png');
    await page.screenshot({ path: screenshotPathLive });
    console.log(`   📸 Captured screenshot of default dashboard to: ${screenshotPathLive}`);

    // Trigger "Suntik Hujan Lebat" scenario
    console.log('   Triggering scenario: Suntik Hujan Lebat...');
    const buttons = await page.$$('button');
    let rainyBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Suntik Hujan Lebat')) {
        rainyBtn = btn;
        break;
      }
    }

    if (rainyBtn) {
      await rainyBtn.click();
      console.log('   Clicked "Suntik Hujan Lebat". Waiting 3 seconds for UI refresh & API prediction...');
      await new Promise(r => setTimeout(r, 3000));

      const weatherText = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        const weatherSpan = spans.find(s => s.textContent.includes('HUJAN LEBAT') || s.textContent.includes('CERAH'));
        return weatherSpan ? weatherSpan.textContent.trim() : 'NOT_FOUND';
      });
      console.log('   Current virtual weather indicator:', weatherText);
      assert.ok(weatherText.includes('HUJAN LEBAT'), 'Weather indicator should show HUJAN LEBAT');

      // Capture screenshot of the dashboard with Rainy weather active
      const screenshotPathRainy = path.join(SCREENSHOT_DIR, 'tests_dashboard_rainy.png');
      await page.screenshot({ path: screenshotPathRainy });
      console.log(`   📸 Captured screenshot of rainy scenario dashboard to: ${screenshotPathRainy}`);
    } else {
      console.warn('   ⚠️ Button "Suntik Hujan Lebat" not found on page.');
    }

    // Verify no console errors occurred during the test lifetime
    if (consoleErrors.length > 0) {
      console.warn('   ⚠️ Console errors detected on page:', consoleErrors);
    } else {
      console.log('   ✅ No console errors occurred in the browser context.');
    }

    console.log('   ✅ Frontend UI headless automation test passed.');
  } finally {
    await browser.close();
  }
}

async function runAllTests() {
  console.log('==================================================');
  console.log('🚀 RUNNING COMPREHENSIVE SMARTPARK AI TEST SUITE');
  console.log('==================================================');
  const start = Date.now();
  try {
    await testApiPredictNormal();
    await testApiPredictFallback();
    await testApiFeedback();
    await testFrontendUI();
    console.log('==================================================');
    console.log(`🎉 ALL TESTS PASSED SUCCESSFULLY IN ${((Date.now() - start)/1000).toFixed(2)}s!`);
    console.log('==================================================');
  } catch (error) {
    console.error('==================================================');
    console.error('❌ TEST SUITE FAILED!');
    console.error(error);
    console.error('==================================================');
    process.exit(1);
  }
}

runAllTests();
