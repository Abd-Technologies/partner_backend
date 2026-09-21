// googleAuth.js — connects to the dietitian's Google account for reading
// Meet attendance data, WITHOUT needing a browser open on the server.
//
// How this works:
//   1) ONE TIME, a human runs scripts/linkDietitianMeetAccount.js from a
//      terminal. That opens a real browser, the dietitian signs in and
//      clicks Allow, and the result (a refresh token) gets saved to
//      config/google-meet/token.json.
//   2) From then on, the cron job calls getAuthorizedClient() below,
//      which loads that saved file and silently gets a fresh access
//      token from Google each time — no browser, no human involved.
//
// If token.json is missing, getAuthorizedClient() throws a clear error
// instead of trying (and failing) to pop open a browser on a headless
// server.

const fs = require('fs');
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/meetings.space.readonly'];

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config', 'google-meet');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');

function loadSavedToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `config/google-meet/token.json exists but isn't valid JSON (${err.message}). ` +
      'Delete it and re-run scripts/linkDietitianMeetAccount.js.'
    );
  }
}

function saveToken(client) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing ${CREDENTIALS_PATH}. Download the OAuth client credentials ` +
      'from Google Cloud Console (Google Auth Platform > Clients) and save ' +
      'them there as credentials.json before running this.'
    );
  }
  const keys = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const key = keys.installed || keys.web;
  const payload = {
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(payload, null, 2));
}

// Silent path — used by the cron job on every run.
async function getAuthorizedClient() {
  const saved = loadSavedToken();
  if (!saved) {
    throw new Error(
      'No saved Google Meet authorization found. Run ' +
      '`node scripts/linkDietitianMeetAccount.js` once, interactively, to ' +
      "connect the dietitian's Google account before this can run unattended."
    );
  }
  const client = new OAuth2Client(saved.client_id, saved.client_secret);
  client.setCredentials({ refresh_token: saved.refresh_token });
  return client;
}

// Interactive path — only ever run by a human, from a real terminal with
// a browser available. See scripts/linkDietitianMeetAccount.js.
async function linkAccountInteractively() {
  const client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  saveToken(client);
  return client;
}

module.exports = {
  getAuthorizedClient,
  linkAccountInteractively,
  SCOPES,
  CREDENTIALS_PATH,
  TOKEN_PATH,
};
