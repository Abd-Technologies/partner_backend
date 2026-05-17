// test_vertex.js
// Smoke test using Google's new unified Gen AI SDK (@google/genai).
// Routes through Vertex AI (uses your $25k GCP credit), authenticated via ADC.
// Run with: node test_vertex.js

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'my-fit-her',
  location: 'us-central1',
});

async function run() {
  console.log('Calling Gemini 2.5 Flash on Vertex AI...\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents:
      'Generate a 1-day Pakistani diet plan for a 28-year-old woman with PCOS, ' +
      '1500 calorie target, no peanuts. Return JSON with 5 meals: breakfast, ' +
      'mid-morning snack, lunch, snack, dinner. Each meal must have time, ' +
      'food name, and calories.',
  });

  console.log('--- DIET PLAN FROM GEMINI ---\n');
  console.log(response.text);
  console.log('\n--- DONE ---');
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
