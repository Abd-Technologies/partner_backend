// meetAttendanceService.js — the actual "did this consultation happen,
// and who was in it" lookup, for one Appointment at a time.
//
// Flow: extract the meeting code from the SlotDiet's pasted Meet link ->
// figure out the appointment's real UTC time window -> ask Google for
// any conference record in that space around that time -> if found,
// list who was actually in it -> match against the dietitian's known
// Meet display name to tell her apart from the client.
//
// This never guesses "not attended" when it simply couldn't check —
// see the null-means-unknown note on the migration for why that
// distinction matters upstream.

const moment = require('moment-timezone');
const { ConferenceRecordsServiceClient } = require('@google-apps/meet').v2;
const { CANONICAL_TZ, parseEndAsUtc } = require('../../helper/timeFormats');
const { getAuthorizedClient } = require('./googleAuth');

// The Meet API doesn't hand back participant email addresses, only a
// display name. This is how we tell "the dietitian" apart from "the
// client" until there's more than one dietitian, at which point this
// needs to become a real per-dietitian lookup instead of one env var.
function dietitianDisplayName() {
  return (process.env.DIETITIAN_MEET_DISPLAY_NAME || '').trim().toLowerCase();
}

// Give Google a few minutes after the scheduled end to finish writing
// the conference record before we bother looking for it.
const RECORD_SETTLE_MINUTES = 5;

// Pulls "abc-defg-hij" out of whatever the dietitian pasted, however
// she pasted it (full URL, trailing slash, stray whitespace, etc).
function extractMeetingCode(rawLink) {
  if (!rawLink || typeof rawLink !== 'string') return null;
  const match = rawLink.trim().match(/([a-z]{3,}-[a-z]{4,}-[a-z]{3,})/i);
  return match ? match[1].toLowerCase() : null;
}

function timestampToMillis(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof ts.seconds !== 'undefined') {
    const seconds =
      ts.seconds && typeof ts.seconds.toNumber === 'function'
        ? ts.seconds.toNumber()
        : Number(ts.seconds);
    if (!Number.isFinite(seconds)) return null;
    return seconds * 1000 + Math.floor((ts.nanos || 0) / 1e6);
  }
  return null;
}

function timestampToIso(ts) {
  const millis = timestampToMillis(ts);
  return millis === null ? null : new Date(millis).toISOString();
}

function participantIdentity(p) {
  if (p.signedinUser) return { label: p.signedinUser.displayName || 'Signed-in user', kind: 'signedIn' };
  if (p.anonymousUser) return { label: p.anonymousUser.displayName || 'Guest', kind: 'anonymous' };
  if (p.phoneUser) return { label: p.phoneUser.displayName || 'Caller', kind: 'phone' };
  return { label: 'Unknown', kind: 'unknown' };
}

// The appointment's real UTC start/end, derived from its SlotDiet
// template's wall-clock strings + its own calendar date. Reuses the
// same parsing helper.js uses for the auto-end cron, so both crons
// agree on what a given appointment's time window actually is.
function appointmentWindowUtc(appointment) {
  const slot = appointment.SlotDiet;
  if (!slot || !slot.start || !slot.end || !appointment.date) return null;
  const anchorPkt = moment.tz(appointment.date, CANONICAL_TZ);
  const startUtc = parseEndAsUtc(slot.start, anchorPkt);
  const endUtc = parseEndAsUtc(slot.end, anchorPkt);
  if (!startUtc || !endUtc) return null;
  return { startUtc, endUtc };
}

// Looks up attendance for one appointment. Returns a plain result
// object ready to save onto the Appointment row — never throws for
// "nothing to find yet" cases, only for real auth/API failures, so the
// caller (the cron sweep) can tell "not ready" apart from "broke".
async function checkAttendanceForAppointment(appointment) {
  // Prefer this appointment's own frozen link snapshot (taken at
  // confirm time — see appointmentController.js updateAppointment)
  // over the slot's live, possibly-since-changed link. Falls back to
  // the slot's link for older appointments confirmed before that
  // snapshot existed.
  const slot = appointment.SlotDiet;
  const link = appointment.meetLink || (slot ? slot.dietitionLink : null);
  const meetingCode = extractMeetingCode(link);
  if (!meetingCode) return { skipped: true, reason: 'no_link_on_file' };

  const window = appointmentWindowUtc(appointment);
  if (!window) return { skipped: true, reason: 'no_time_window' };

  const now = moment.utc();
  if (now.isBefore(window.endUtc.clone().add(RECORD_SETTLE_MINUTES, 'minutes'))) {
    return { skipped: true, reason: 'too_soon' };
  }

  const authClient = await getAuthorizedClient();
  const client = new ConferenceRecordsServiceClient({ authClient });

  // Widen the search slightly in case the call started a bit early/late.
  const searchStart = window.startUtc.clone().subtract(30, 'minutes').toISOString();
  const searchEnd = window.endUtc.clone().add(30, 'minutes').toISOString();
  const filter =
    `space.meeting_code = "${meetingCode}" AND ` +
    `start_time >= "${searchStart}" AND start_time <= "${searchEnd}"`;

  const [records] = await client.listConferenceRecords({ filter });

  if (!records || records.length === 0) {
    return {
      skipped: false,
      dietitianAttended: false,
      clientAttended: false,
      conferenceRecordName: null,
      raw: [],
    };
  }

  // If more than one record matches (e.g. a reused recurring link with
  // back-to-back bookings), pick whichever started closest to the
  // scheduled slot start.
  const targetMillis = window.startUtc.valueOf();
  records.sort((a, b) => {
    const aMillis = timestampToMillis(a.startTime) ?? Infinity;
    const bMillis = timestampToMillis(b.startTime) ?? Infinity;
    return Math.abs(aMillis - targetMillis) - Math.abs(bMillis - targetMillis);
  });
  const record = records[0];

  const [participants] = await client.listParticipants({ parent: record.name });
  const raw = (participants || []).map((p) => {
    const identity = participantIdentity(p);
    return {
      label: identity.label,
      kind: identity.kind,
      joinedAt: timestampToIso(p.earliestStartTime),
      leftAt: timestampToIso(p.latestEndTime),
    };
  });

  const knownDietitianName = dietitianDisplayName();
  let dietitianAttended = null;
  let clientAttended = null;
  if (knownDietitianName) {
    dietitianAttended = false;
    clientAttended = false;
    for (const p of raw) {
      if (p.label.trim().toLowerCase() === knownDietitianName) dietitianAttended = true;
      else clientAttended = true;
    }
  }

  return {
    skipped: false,
    dietitianAttended,
    clientAttended,
    conferenceRecordName: record.name,
    raw,
  };
}

module.exports = {
  checkAttendanceForAppointment,
  extractMeetingCode,
  appointmentWindowUtc,
  timestampToIso,
};
