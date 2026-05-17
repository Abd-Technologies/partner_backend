const { GoogleGenAI } = require('@google/genai');

/**
 * Singleton GoogleGenAI client used by every AI service in this app.
 *
 * Why a singleton:
 *   - Constructing GoogleGenAI runs ADC discovery (token refresh, metadata
 *     server probes), which is non-trivial. We only want to pay that cost
 *     once per process lifetime, not per request.
 *   - Vertex AI quotas are per-project. Sharing one client makes it easy
 *     to add cross-cutting concerns (rate limiting, retries, observability)
 *     in one place later without touching every call site.
 *
 * Auth — Application Default Credentials (ADC):
 *   - In dev: `gcloud auth application-default login` writes credentials
 *     to ~/.config/gcloud/. The SDK picks them up automatically.
 *   - In prod (Cloud Run / GCE): the runtime service account is used.
 *     No service-account JSON file ever lives on disk.
 *
 * Project + location come from env, with my-fit-her / us-central1
 * defaults so local `node test_vertex_v2.js` works without any setup.
 */
const aiClient = new GoogleGenAI({
  vertexai: true,
  project: process.env.GCP_PROJECT_ID || 'my-fit-her',
  location: process.env.GCP_LOCATION || 'us-central1',
});

module.exports = aiClient;
