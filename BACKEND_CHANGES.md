# Backend change history (partner_backend)

One running log of what changed in the backend, so the laptop, GitHub and
the Google VM stay in step. Newest entry on top. Add a line each time
something changes; git (push / pull) carries this file to the VM.

- Laptop: `C:\Users\dell\Desktop\dev\New folder\partner_backend`
- VM: `/home/khalidshaista90/partner_backend`
- Branch: `hannan_changes` (remote: `Abd-Technologies/partner_backend`)
- Deploy on the VM: `git pull origin hannan_changes` then `pm2 restart all && pm2 save`

---

## How to add an entry

```
### YYYY-MM-DD · <short title>
- Files: <file>, <file>
- What: <what changed, in plain words>
- Why: <reason>
- VM steps: pull + restart / .env change / migration / none
- Commit: <hash>   Status: on laptop | pushed | live on VM
```

---

## Status on 2026-11-01

- Laptop and GitHub are the same: last commit `993f2af`, nothing unpushed.
- Home streak + trial class status changes (below) are on the laptop, not pushed yet.
- VM: run the pull + restart above if it isn't on `993f2af` yet
  (check with `git log -1 --oneline` on the VM).
- Migration `migrations/20261105120000-appointment-join-taps.js` came in with
  `983ffd6`. If the VM hasn't run it yet: `npx sequelize-cli db:migrate`.

---

## History

### 2026-11-01 · Trial class list sends each class's status
- Files: `helper/trialClasses.js` (backup: `*.bak_trialnext`)
- What: each class in `/trial/classes` now has `status` (Upcoming / In Progress /
  Completed / Cancelled). Extra field only, nothing removed.
- Why: the app's free-trial box ("Next: …") kept showing a class that had moved,
  ended or was cancelled, while the home class card had already moved on.
- Goes with an app change (fit_her-main, not this repo): `nextTrialClass()` uses
  the trial rule (join within 10 min; missed → next class; joined → keep until
  it ends; skip cancelled / finished), shows "Live now", and the list reloads
  with Home (max every 2 min). Files: `home_controller.dart`,
  `paid_home_controller.dart`, `v2_trial_banner.dart` (backups `*.bak_trialnext`).
- VM steps: pull + restart. Old app versions ignore the new field.
- Commit: (not yet)   Status: on laptop

### 2026-11-01 · Streak: starts at 1 on sign-up, never resets, same on Home and Profile
- Files: `helper/attendanceStats.js`, `controllers/FrontSite/DashboardController.js`
  (backups: `*.bak_signupstreak`)
- What: new `streakDays(userId)` in attendanceStats = number of days she was
  active since sign-up (class 5+ min, meal, water, daily insights), sign-up day
  included, so a new member shows 1🔥 the day she joins. A day with nothing
  pauses it; it never goes back to 0. Home (`/users/home/dashboard`
  goal.streakDays) and Profile / Classes (`motivationStats.streak`) use it, so
  the app and the web app show the same number.
- Why: Home used the old class table (not written since 17 Oct), so most women,
  trial members included, saw no streak; founder's rule: don't reset to 0.
- Example: sign up Mon = 1 · water Tue = 2 · nothing Wed = 2 · meal Thu = 3.
- VM steps: pull + restart. No new packages, no database change.
- Commit: (not yet)   Status: on laptop

### 2026-11-01 · Saving the class schedule keeps today's class status
- Files: `controllers/Admin/AdminController.js`
- What: saving the schedule in admin no longer resets every class of the day
  to "Upcoming". Only a cancelled class moved to a new time reopens.
- Why: ended / live classes showed "Get ready" again, then got auto-cancelled
  and women received a false "class cancelled" push.
- VM steps: pull + restart. No new packages, no database change.
- Commit: `993f2af`   Status: pushed (see REMOTE_SERVER_TODO.md A1)

### 2026-10-31 · Attendance, streak, class joining, notifications
- Commits: `cbe0694` attendance · `007d424` last changes · `f5613b5` streak and
  class joining · `12e5ab6` notification on slots · `983ffd6` last changes
- Files: `helper/attendanceStats.js`, `helper/trialClasses.js`,
  `helper/trialAttendance.js`, `helper/classDiary.js`, `helper/classFeedback.js`,
  `helper/crownjobfunction.js`, `helper/preConsultFormReminders.js`,
  `helper/preConsultRequirements.js`, `helper/supportTickets.js`,
  `controllers/Admin/growthController.js`, `controllers/FrontSite/DashboardController.js`,
  `controllers/FrontSite/trialController.js`, `models/Appointments.js`,
  `routes/FrontSite/appointmentRoutes.js`, `notificationWorker.js`,
  new migration `20261105120000-appointment-join-taps.js`
- What: About-you / health-form / support pushes, 15-day progress, consultation
  attendance from app taps (+ admin view, "Did she join?"), class reminder after
  a time change, dashboard Today + Plans on pause, streak from any activity,
  5-minute class attendance rule, class diary, trial classes counted like profile.
- VM steps: pull + restart, run the migration, `.env`: `MEET_LINKED_DIETITIAN_IDS`
  and check `TRIAL_ATTENDANCE_MIN_SECONDS` (300). See REMOTE_SERVER_TODO.md A1b-A3.
- Status: pushed

### 2026-10-28 · October security pass, web app support, clean-up
- Commits: `c9037df` (152 files), `8deb2ba`, `de4814a`
- What: token expiry + revocation (`helper/authToken.js`), login / OTP / sign-up
  rate limits (`helper/rateLimit.js`), role guards (`middlewares/roleGuards.js`),
  private `/files` route (`helper/privateFiles.js`), `client: "web"` logins for the
  member website (7-day token, doesn't touch the phone's push token / logout).
  `.gitignore` stops tracking backups, secrets and uploads. One-time fix for old
  class times (`scripts/backfill_slot_canonical_format.js`), Home classes check
  (`scripts/diag_home_classes.js`).
- Status: pushed

### 2026-10-14 · last final changes
- Commit: `45136ce`
- Status: pushed

---

## Open items (found in the 2026-11-01 audit, NOT fixed yet)

Nothing below has been changed. Move an item into History when it's done.

1. **Secrets tracked in git.** `.env` and `config/config.json` are still in the repo
   (`.gitignore` doesn't untrack files already committed). Old Firebase key is in
   history. To do: change the keys, `git rm --cached .env config/config.json`,
   clean history.
2. **Bank-slip price comes from the request.** `addImage` (AdminController) uses
   `price` and `userId` from the body; the slip check compares against that price,
   not the real `Prices.priceAmount`. Route has no `selfOrStaff` check.
   To do: price from the database (or the member's live trial offer), and the
   logged-in user's id unless staff.
3. **Stripe card payment.** `/admin/payment` takes `amount` from the request,
   charges in USD, and no webhook activates the plan. Fix or hide Card.
4. **Private files still public.** `PRIVATE_FILES_PUBLIC` defaults to `true`, so
   slips / progress photos / support screenshots are served by `/public/...`.
   Set `PRIVATE_FILES_PUBLIC=false` in the VM `.env` when the apps are updated.
5. **Push notifications.** NEXT_PHASE.md says push is broken until the Firebase
   key is replaced (`node scripts/test_push.js <userId>` to test).
6. **Dead code.** `routes/FrontSite/avalibilityRoutes.js` (unprotected PUT/DELETE)
   is not mounted; safe to delete.
