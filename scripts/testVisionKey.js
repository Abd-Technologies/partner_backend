// Quick check that the payment-slip reader (Google Cloud Vision) works.
// Run from the backend folder:  node scripts/testVisionKey.js [path/to/slip.jpg]
// Without a path it sends a tiny blank image (just checks the API key).
require('dotenv').config();
const fs = require('fs');

(async () => {
  const key = (process.env.GOOGLE_VISION_API_KEY || '').trim();
  if (!key) return console.log('❌ GOOGLE_VISION_API_KEY is missing in .env');
  const file = process.argv[2];
  if (file) {
    const { extractSlipData } = require('../helper/visionOCR');
    const r = await extractSlipData(file);
    console.log(r ? '✅ Slip read:' : '❌ Could not read the slip', r ? { amount: r.amount, date: r.date, bank: r.bank, sender: r.sender, confidence: r.confidence } : '');
    return;
  }
  // 1x1 white PNG
  const img = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: img }, features: [{ type: 'TEXT_DETECTION' }] }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && !body.error) console.log('✅ Vision API key works (HTTP ' + res.status + ')');
  else console.log('❌ Vision API error (HTTP ' + res.status + '):', (body.error && body.error.message) || JSON.stringify(body).slice(0, 300));
})();
