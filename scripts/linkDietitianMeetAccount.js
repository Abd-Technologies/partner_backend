// Run this ONE TIME, by hand, from a terminal:
//   node scripts/linkDietitianMeetAccount.js
//
// It opens your browser — the DIETITIAN should sign in with her own
// Google account there and click Allow. After that, the backend can
// check Meet attendance automatically, forever, with no more sign-ins.
//
// Needs config/google-meet/credentials.json to already exist (the file
// downloaded from Google Cloud Console).

const { linkAccountInteractively, TOKEN_PATH } = require('../services/meetAttendance/googleAuth');

linkAccountInteractively()
  .then(() => {
    console.log('\nSuccess! Saved to: ' + TOKEN_PATH);
    console.log("The dietitian's Google account is now connected.");
    console.log('This only needed to happen once.');
  })
  .catch((err) => {
    console.error('\nSomething went wrong linking the account:\n', err.message || err);
    process.exit(1);
  });
