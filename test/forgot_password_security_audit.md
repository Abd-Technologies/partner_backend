# Forgot Password — Security Audit (partner_backend)

> Read-only investigation. No production files modified. Audit run 2026-04-27.
> Scope: `partner_backend/` only (per memory `project_active_backend.md`).

---

## Executive summary

The original premise — *"backend returns the OTP in the API response"* — turned out to be **false in current code**. But the audit surfaced **three issues that are worse**, plus the existing flow is **silently broken end-to-end on the client**.

| # | Severity | Finding |
|---|---|---|
| **A** | 🔴 **CRITICAL** | `change_password_after_otp` accepts `{email, password}` and **never verifies the OTP value**. Any actor who can call `/users/forget_password` for a victim's email can immediately call `/users/change_password_after_otp` for the same email and reset the victim's password. The "OTP-protected" reset endpoint is effectively unprotected. |
| **B** | 🟠 HIGH | Email enumeration — `forget_password` returns `"Sorry! User not exist"` vs `"Opt Sent Successfully!"`, letting an attacker map which emails are registered. |
| **C** | 🟠 HIGH | OTP "verification" on client is `widget.otp == userInput` inside `OtpScreen`. Because the backend doesn't return the OTP today the path is unreachable, but if the backend ever did return the OTP this would be a free-for-all. The screen accepts an `otp` field on its constructor, signalling the original architectural intent was to do exactly that. |
| **D** | 🟡 MED | Flutter `enter_email.dart` reads `response.body["data"]["otp"]` from the forget-password response. Backend doesn't return that field. So the call returns `null`, `if (otp != null)` is false, and the screen silently does nothing on success. **The forgot-password flow appears to be non-functional in current production code.** |
| **E** | 🟡 MED | `sentOtpMail.js` hardcodes `host: "smtp.gmail.com"` and ignores `EMAIL_HOST = 'smtp.titan.email'` from `.env`. The configured host is silently overridden. |
| **F** | 🟡 MED | Sender address is `hannaniqbal527@gmail.com` (developer's personal Gmail), not a branded mailbox. Looks unprofessional and increases spam-folder risk. |
| **G** | 🟢 LOW | `generateOTP()` uses `Math.random()` (not `crypto.randomInt`). 4-digit space (1000–9999, 9000 values). With no rate limiting, brute-forceable in seconds — but moot today because the OTP isn't checked. |
| **H** | 🟢 LOW | No rate limiting on `/users/forget_password`. An attacker can repeatedly request OTPs for any email, repeatedly resetting the 10-minute window. |

**Bottom line:** Findings A and D are blocking. A is a credential-takeover bug; D means real users currently can't complete the flow. B/C/E/F/G/H should ride along on the same fix-up sprint.

---

## Backend audit (Step 1)

### 1a. `forget_password` endpoint

`partner_backend/controllers/FrontSite/userController.js:155–205`

```js
async function forget_password(req, res) {
  const check = await User.findOne({ where: { email: req.body.email } });
  if (check) {
    const checkotp = await OtpData.findOne({ where: { email: check.email } });
    if (checkotp) {
      let OTP = generateOTP();
      checkotp.otp = OTP;
      checkotp.requestAt = new Date();
      checkotp.save().then((dat) => {
        sentOtpMail("OTP For Fither", `Your OTP for forget password is ${OTP}`, req.body.email);
        const data = { email: check.email };                        // ← OTP NOT in response
        const response = ApiResponse("1", "Opt Sent Successfully!", data);
        return res.json(response);
      }).catch(...)
    } else {
      let OTP = generateOTP();
      const newOtp = new OtpData();
      newOtp.requestAt = new Date();
      newOtp.email = check.email;
      newOtp.otp = OTP;
      newOtp.status = true;
      newOtp.save().then((dat) => {
        sentOtpMail("OTP For Fither", `Your OTP for forget password is ${OTP}`, req.body.email);
        const data = { email: check.email };                        // ← OTP NOT in response
        const response = ApiResponse("1", "Opt Sent Successfully!", data);
        return res.json(response);
      }).catch(...)
    }
  } else {
    const response = ApiResponse("0", "Sorry! User not exist", {}); // ← email enumeration
    return res.json(response);
  }
}
```

**Notes**
- Response payload is `{ status, message, data: { email } }`. **No OTP field is ever returned.** The original audit hypothesis (founder's prompt) was incorrect for this codebase.
- Branches by user-existence: known email gets `"Opt Sent Successfully!"`, unknown email gets `"Sorry! User not exist"`. This is the email enumeration leak (Finding B).
- OtpData uses an upsert pattern: one row per email, overwritten on each request. No history kept. No version/nonce; no per-attempt token.

### 1b. `change_password_after_otp` endpoint

`partner_backend/controllers/FrontSite/userController.js:206–250`

```js
async function change_password_after_otp(req, res) {
  const { email, password } = req.body;                        // ← NO `otp` in body

  // 1. Verify an OTP record exists for this email
  const otpRecord = await OtpData.findOne({ where: { email: email } });
  if (!otpRecord) {
    return res.json(ApiResponse("0", "No password reset was requested for this email.", {}));
  }

  // 2. Verify OTP was recently generated (within 10 minutes)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  if (!otpRecord.requestAt || otpRecord.requestAt < tenMinutesAgo) {
    return res.json(ApiResponse("0", "OTP has expired. Please request a new one.", {}));
  }

  // 3. Verify OTP status is valid
  if (!otpRecord.status) {
    return res.json(ApiResponse("0", "OTP has already been used.", {}));
  }

  // 4. Find user and update password
  const user = await User.findOne({ where: { email: email } });
  if (!user) return res.json(ApiResponse("0", "User not exists!", {}));

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(password, salt);
  user.save().then(async (dat) => {
    // 5. Invalidate OTP after successful password change
    otpRecord.status = false;
    await otpRecord.save();
    return res.json(ApiResponse("1", "Password updated successfully!", {}));
  }).catch(...)
}
```

**This is Finding A — critical vulnerability.**

The endpoint runs three OTP checks (existence, age, status) but **never compares any user-supplied OTP value against `otpRecord.otp`** because no `otp` field is read from `req.body`. So:

```
1. Attacker → POST /users/forget_password   { email: victim@x.com }
   → 200 OK, OtpData row created/updated for victim@x.com
2. Attacker → POST /users/change_password_after_otp
              { email: victim@x.com, password: "attackerChosen123" }
   → 200 OK, "Password updated successfully!"
3. Attacker logs in as victim with new password.
```

The phase-tracker note from 2026-03-27 ("add OTP verification before allowing password reset") added the existence/age/status checks. **It did not add a value comparison**, leaving the endpoint effectively unprotected.

### 1c. Route registration

`partner_backend/routes/FrontSite/user.js`

```
line 15: router.post('/forget_password',           asyncMiddleware(userController.forget_password));
line 21: router.post('/change_password_after_otp', asyncMiddleware(userController.change_password_after_otp));
```

Both POST, both **without** `validateToken` middleware (correct — pre-login flows). No rate-limiting middleware in either route file or `app.js` (Finding H).

### 1d. `OtpData` model

`partner_backend/models/OtpData.js` — 25 lines

```js
const OtpData = sequelize.define('OtpData', {
  otp:       { type: DataTypes.STRING(),  allowNull: true },
  email:     { type: DataTypes.STRING(),  allowNull: true },
  requestAt: { type: DataTypes.DATE,      allowNull: true },
  status:    { type: DataTypes.BOOLEAN,   allowNull: true },
});
```

- All four columns nullable — no NOT NULL on `email` or `otp`.
- No unique index on `email` — but the controller relies on `findOne({where: {email}})` and the upsert pattern keeps it to one row per email by convention only.
- No `attempts` counter (couldn't track brute force attempts even if we wanted to).
- No expiry timestamp — `requestAt` plus a hardcoded "10 minutes" in the controller is the only window.

### 1e. `sentOtpMail` helper

`partner_backend/helper/sentOtpMail.js` — 64 lines (most commented out)

```js
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",       // ← HARDCODED, ignores EMAIL_HOST in .env
  port: 465,                    // ← HARDCODED, ignores EMAIL_PORT in .env
  secure: true,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

module.exports = function sentOtpMail(subject, body, email) {
  console.log("-------------"+email+"111111111")
  transporter.sendMail(
    { from: process.env.EMAIL_USERNAME, to: email, subject, text: body },
    function (error, info) {
      if (error)  console.error("Error sending email:", error);
      else        console.log("Email sent successfully:", info.response);
    }
  );
};
```

**Findings**
- **E**: `host` and `port` are hardcoded to Gmail; `.env` defines `EMAIL_HOST = 'smtp.titan.email'` + `EMAIL_PORT = 465`, both ignored.
- **F**: `EMAIL_USERNAME = 'hannaniqbal527@gmail.com'` (per `.env`) — developer's personal Gmail. Sender = "from" address = same. No branded mailbox.
- **Errors swallowed**: `sendMail` is fire-and-forget. Errors only hit `console.error`. The API response says `"Opt Sent Successfully!"` whether the email actually delivered or not.
- **No retry**, no fallback transport.
- `EMAIL_PASSWORD = 'maedrrnciggrwctq'` — looks like a Gmail app password (16-char no-space), which is the right credential type for SMTP from a Google account.

### 1f. `generateOTP()`

`partner_backend/controllers/FrontSite/userController.js:8`

```js
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
```

**Finding G**: `Math.random()` is not cryptographically secure. 4 digits = 9,000 possible values. With no rate limiting, an attacker who *did* need to guess the OTP could brute-force it in seconds. **Moot today** because the value isn't actually checked at the reset endpoint, but matters as soon as Finding A is fixed.

---

## Flutter audit (Step 2)

### 2a. `AuthController.forgotPassword`

`lib/data/controllers/auth_controller/auth_controller.dart:488–521`

```dart
Future<String?> forgotPassword(String email) async {
  String? otp;
  await connectionService.checkConnection().then((value) async {
    if (!value) { CustomToast.noInternetToast(); otp = null; }
    else {
      Get.dialog(const Center(child: CircularProgressIndicator()), barrierDismissible: false);
      await authRepo.forgotPasswordRepo(email: email).then((response) async {
        Get.back();
        if (response.statusCode == 200) {
          if (response.body["status"] == "0") {
            CustomToast.failToast(msg: response.body["message"]);
            otp = null;
          } else if (response.body["status"] != "0") {
            if (response.body["status"] == "1") {
              otp = response.body["data"]["otp"];           // ← always null
            }
          }
        } else {
          CustomToast.failToast(msg: response.body["message"]);
          otp = null;
        }
      });
    }
  });
  return otp;
}
```

`response.body["data"]["otp"]` is **always null** because the backend never includes that field. Confirms **Finding D** — the function returns `null` on success.

### 2b. `AuthRepo` calls

`lib/data/Repos/auth_repo/auth_repo.dart:86–99`

```dart
Future<Response> forgotPasswordRepo({required String email}) async {
  var body = { "email": email };
  return await apiProvider.postData(Constants.forgotPassword, body: body);
  // Constants.forgotPassword = "/users/forget_password"
}

Future<Response> resetPasswordRepo({required String email, required String password}) async {
  var body = {"email": email, "password": password};                  // ← NO `otp` field
  return await apiProvider.postData(Constants.resetPassword, body: body);
  // Constants.resetPassword = "/users/change_password_after_otp"
}
```

The **client never sends an OTP value to the reset endpoint**, mirroring the backend bug from the other side. Both halves of Finding A.

### 2c. `enter_email.dart` (Step 1 of the flow)

`lib/UI/auth_module/managePassword/forgot_password/enter_email.dart:91–115`

```dart
CustomButton(
  text: 'Send Code'.tr,
  onPressed: () async {
    if (emailFormKey.currentState!.validate()) {
      String? otp = await authController.forgotPassword(email.text);
      if (otp != null) {                                        // ← NEVER true
        HelpingWidgets.showCustomDialog(context, null, "Check your email", ...);
        Future.delayed(const Duration(seconds: 2), () {
          Get.off(() => OtpScreen(email: email.text, otp: otp));
        });
      }
      // No else branch — silent no-op when otp is null
    } else {
      CustomToast.failToast(msg: "Please enter valid data".tr);
    }
  },
),
```

User flow today:
1. User enters valid email, taps "Send Code".
2. Spinner shows while `forgotPassword()` runs.
3. Backend returns `{status: "1", data: {email}}` (no otp).
4. AuthController returns `null`.
5. Spinner clears. **No dialog. No navigation. Silent.**
6. User stares at the screen.

Backend HAS sent an email (assuming Finding E doesn't break delivery), but the user has no in-app way to enter it because OtpScreen is never shown.

### 2d. `OtpScreen` (Step 2 of the flow)

`lib/UI/auth_module/managePassword/forgot_password/otp_screen.dart`

Constructor (line 24):
```dart
OtpScreen({Key? key, required this.email, required this.otp}) : super(key: key);
final String email;
final String otp;          // ← carries the OTP forward as widget state
```

Validation (line 247–262):
```dart
onPressed: () {
  if (_isExpired)                                  CustomToast.failToast(msg: "...expired...");
  else if (otpController.text.length < 4)          CustomToast.failToast(msg: "Invalid otp");
  else if (otpController.text != widget.otp) {     // ← CLIENT-SIDE COMPARISON
    CustomToast.failToast(msg: "Invalid otp");
  } else {
    Get.off(() => ResetPassword(email: widget.email));
  }
}
```

**Finding C**. The "Next" button compares user input against `widget.otp` — a Dart field on the widget. No backend call to verify. If the OTP value ever flows through (e.g., backend starts returning it), an attacker has multiple bypasses:
- Inspect the in-memory widget state via a rooted device / dev-mode debugger.
- Patch the APK to make `otpController.text != widget.otp` always evaluate false.
- MITM the original `forget_password` response and read the OTP straight off the wire.

This is screen path doesn't actually reach today (Finding D blocks it), but the architectural intent is to do client-side OTP verification — which is wrong regardless.

### 2e. `ResetPassword` (Step 3 of the flow)

`lib/UI/auth_module/managePassword/forgot_password/resetPassword.dart:106`

```dart
authController.resetPassword(email, pwd.text);
```

`AuthController.resetPassword(email, password)` then posts `{email, password}` to `/users/change_password_after_otp`. **Per 2b, no OTP is ever sent.**

So the *intended* end-to-end flow is:
- Step 1: client gets OTP from backend (currently broken — backend doesn't send it).
- Step 2: client compares user input against the OTP it already has (insecure even if it worked).
- Step 3: client calls reset with no OTP at all (backend doesn't check it).

Even if every part worked as the author intended, the flow would be weaker than no-OTP-at-all. The current "broken" state is, paradoxically, less exploitable than the "working" intent — because Finding D blocks the legitimate path while Finding A leaves the attack path open to anyone who calls the API directly.

---

## Recommended fix (Step 3)

The fix has to address Finding A first (real exploit), then Finding D (functional bug), then the rest in the same sprint.

### Fix shape

1. **Backend** — `change_password_after_otp` requires and verifies an OTP value:
   ```js
   const { email, password, otp } = req.body;
   ...
   // After existence/expiry/status checks:
   if (String(otpRecord.otp) !== String(otp)) {
     // Optional: increment attempts; lock after N tries.
     return res.json(ApiResponse("0", "Invalid OTP.", {}));
   }
   ```
   Single source of truth on the server. No client-side comparison.

2. **Backend** — add a dedicated `verify_otp` endpoint (recommended, not strictly required) so the OtpScreen can check the code without consuming it:
   ```
   POST /users/verify_otp  { email, otp }  →  { status: "1" } | { status: "0", message: "Invalid OTP" }
   ```
   Lets the UI separate "user typed wrong code" UX from "now choose your new password" UX. Without this, OtpScreen has to defer all validation until the password is also entered — workable but worse UX.

3. **Backend** — fix the email enumeration leak (Finding B): always return `"If that email is registered, an OTP has been sent."` regardless of whether the user exists. Send the email only when the user does exist. Same response, same status code, same latency (use a constant-time compare or a fixed delay if needed).

4. **Backend** — basic rate limiting on `forget_password` (Finding H): max 3 requests per email per hour, 10 per IP per hour. Use `express-rate-limit` or equivalent.

5. **Backend** — switch `generateOTP` to `crypto.randomInt(1000, 10000)` (Finding G). Tiny change.

6. **Backend** — fix `sentOtpMail.js` (Finding E): use `process.env.EMAIL_HOST`/`EMAIL_PORT`. Optionally migrate to a branded mailbox once SPF/DKIM are set up (Finding F) — that's a follow-up.

7. **Flutter** — `enter_email.dart`:
   - Drop `if (otp != null)` gate. Navigate to OtpScreen on backend success regardless.
   - Pass only `email` to OtpScreen (drop the `otp` parameter from the constructor).
   - Update success copy to talk about a "code" the user will receive in email.

8. **Flutter** — `OtpScreen`:
   - Drop `final String otp` from constructor and state.
   - Replace `otpController.text != widget.otp` with a backend call to either:
     - `/users/verify_otp` (if we add it) → on success, navigate to `ResetPassword(email, otp)`, OR
     - Defer verification to the reset call (carry `otp` forward and submit it with the new password).

9. **Flutter** — `ResetPassword`:
   - Accept `final String otp` on constructor.
   - `AuthController.resetPassword(email, password, otp)` → `authRepo.resetPasswordRepo({email, password, otp})` → backend now reads `otp` from body.

10. **Flutter** — `AuthController.forgotPassword`:
    - Stop reading `response.body["data"]["otp"]`.
    - Return `bool` (success) or `void` instead of `String?`. Caller logic simplifies to "did backend say success".

### What changes in the flow after the fix

```
Step 1  enter_email.dart  →  POST /users/forget_password { email }
                          ←  200 { status: "1", message: "If that email is registered, an OTP has been sent." }
                          →  navigate to OtpScreen(email)
Step 2  OtpScreen         →  user types OTP from email
                          →  POST /users/verify_otp { email, otp }                    [optional but recommended]
                          ←  200 { status: "1" }
                          →  navigate to ResetPassword(email, otp)
Step 3  ResetPassword     →  POST /users/change_password_after_otp { email, password, otp }
                          ←  200 { status: "1", message: "Password updated successfully!" }
                          →  navigate to Login
```

---

## Deployment safety analysis (Step 4)

### Q1 — How is forget_password being used today?

- **Backend reaches the controller fine** — the route is registered and the function runs.
- **Email is being attempted** via Gmail SMTP. Whether it lands in the user's inbox depends on the Gmail credentials being valid + Gmail not throttling. **Not verified in this audit** — see Section "Verification needed".
- **Flutter app cannot complete the flow today** — Finding D means the OtpScreen is never shown. So users who start the flow either:
  - Get stuck on `enter_email.dart` (silent button), and probably contact support / give up, OR
  - The "OTP sent" custom dialog never fires because that's also gated on `if (otp != null)`. So no UI feedback at all.
- **Direct API exploit is open** — anyone who knows the endpoint paths can take over accounts via Finding A. No analytics in the codebase shows whether this has happened. Recommend grepping production logs for unusual `change_password_after_otp` traffic before/after the fix ships.

### Q2 — If we fix backend first

If the backend starts requiring `otp` in the reset body and the Flutter app doesn't send it, every legitimate reset attempt will fail with `"Invalid OTP."` — but legitimate resets aren't currently completing anyway (Finding D). So strictly, **backend-first is safe for legitimate users** (no regression, the flow is already broken). It also closes Finding A immediately.

The only "user" affected would be anyone who's been completing the reset via direct API — i.e., the attackers. They get locked out. Fine.

### Q3 — If we fix Flutter first

If we fix Flutter (sending `otp` to the reset endpoint, dropping the `if (otp != null)` gate, adding the verify call, etc.) before backend, the verify call would 404, and the reset endpoint would ignore the new `otp` field. Flow stays broken; vulnerability stays open. **Not safe**.

### Q4 — Email delivery verification

**Unknown today.** Findings E + F mean we don't actually know whether emails reach inboxes. Three things to verify before any fix ships:

1. Does Gmail SMTP from `hannaniqbal527@gmail.com` with the app password in `.env` actually authenticate?
2. Do the emails land in the inbox or in spam? The body is `Your OTP for forget password is 1234` — no formatting, no branding, looks spammy.
3. Is the `EMAIL_HOST = smtp.titan.email` in `.env` actually the host the team intended? If the intent is to send from a Titan-hosted branded domain, the hardcoded Gmail override is a bug to fix even before the security work.

If email delivery is broken, the security fix would lock everyone out of password reset (because they'd never receive the OTP). **Verify email delivery first.**

### Q5 — Migration plan

#### Phase 0 — Verify email delivery (BEFORE any other change)

- Manually request a forgot-password OTP for a test account.
- Confirm the email arrives in the inbox (check spam).
- If broken: fix `sentOtpMail.js` (use `EMAIL_HOST` from env) and/or update credentials. Don't proceed until emails reliably deliver.

#### Phase A — Backend security fix (closes Finding A immediately)

- Modify `change_password_after_otp` to read `otp` from `req.body` and verify against `otpRecord.otp`. Reject if missing or mismatched.
- Optionally: also add the `verify_otp` endpoint at the same time (saves a follow-up deploy).
- Effect: legitimate reset is now broken too (because Flutter doesn't send `otp`), but it was already broken via Finding D — net zero regression for users, and the exploit closes.
- **Ship within hours of audit acknowledgement**. This is the only step that needs urgency.

#### Phase B — Flutter fix (restores the flow)

- Update `AuthController.forgotPassword` to return `bool` and stop reading `data.otp`.
- Update `enter_email.dart` to navigate to OtpScreen on success regardless of OTP presence.
- Update `OtpScreen` constructor to take only `email`; verify OTP via backend (or carry forward to reset).
- Update `ResetPassword` to take `otp` and pass it to `AuthController.resetPassword`.
- Update `AuthController.resetPassword` + `AuthRepo.resetPasswordRepo` to send `otp` in the body.
- Ship as a normal app release. Until the app updates roll out, users still can't reset (same as today).

#### Phase C — Backend hardening (no Flutter dependency)

- Email enumeration fix (always return generic success message).
- Rate limiting on `forget_password`.
- `crypto.randomInt` instead of `Math.random()`.
- Fix `sentOtpMail.js` host/port env reading (already did in Phase 0 if email was broken).

#### Phase D — Branded mailbox + email template (follow-up)

- Set up `noreply@fither.com` (or similar) with SPF/DKIM/DMARC.
- HTML email template with branding instead of `Your OTP for forget password is 1234`.
- This is polish, not security. Can be slow.

### Recommended sequence

```
Phase 0  (immediate)  Verify email delivery works
Phase A  (same day)   Backend: enforce OTP value in change_password_after_otp
Phase B  (next sprint) Flutter: send OTP value through the reset call
Phase C  (next sprint) Backend hardening (enum, rate limit, RNG, env fix)
Phase D  (when ready)  Branded sender + nicer template
```

---

## Verification needed before fix ships

| # | Check | Why it matters |
|---|---|---|
| 1 | Does Gmail SMTP from `hannaniqbal527@gmail.com` actually authenticate? Run a one-off test (e.g. nodemailer test from local) | If broken, security fix locks out all real users |
| 2 | Do OTP emails land in inbox vs spam folder? | Spam = same UX as broken |
| 3 | Are there `OtpData` rows from the last 30 days? `SELECT COUNT(*), MAX(updatedAt) FROM OtpData` | Tells us whether real users are even attempting this flow |
| 4 | Are there suspicious `change_password_after_otp` calls in app logs (e.g., burst from one IP, multiple distinct emails)? | Detect prior exploitation. If logs aren't kept, accept that we don't know |
| 5 | Does `EMAIL_HOST = smtp.titan.email` in `.env` reflect intended infra? | Determines whether to fix env-reading or update the env |
| 6 | Are there any production users with passwords that rotated recently without their knowledge? Cross-check support tickets | Detect prior exploitation from the user side |

---

## Files touched by recommended fix (preview, not building yet)

| File | Change |
|---|---|
| `partner_backend/controllers/FrontSite/userController.js` | Add `otp` read + value check in `change_password_after_otp`; fix email enumeration in `forget_password`; switch `generateOTP` to `crypto.randomInt` |
| `partner_backend/routes/FrontSite/user.js` | Add rate-limit middleware on `/forget_password`; optionally register new `/verify_otp` route |
| `partner_backend/helper/sentOtpMail.js` | Use `process.env.EMAIL_HOST` and `EMAIL_PORT` instead of hardcoded Gmail |
| `lib/data/controllers/auth_controller/auth_controller.dart` | `forgotPassword` returns `bool`; `resetPassword` takes `otp` |
| `lib/data/Repos/auth_repo/auth_repo.dart` | `resetPasswordRepo` includes `otp` in body |
| `lib/values/constants.dart` | Optionally add `verifyOtpPath` constant if we add the verify endpoint |
| `lib/UI/auth_module/managePassword/forgot_password/enter_email.dart` | Drop `if (otp != null)` gate; always navigate to OtpScreen on success |
| `lib/UI/auth_module/managePassword/forgot_password/otp_screen.dart` | Drop `otp` from constructor; replace client-side compare with backend verify call |
| `lib/UI/auth_module/managePassword/forgot_password/resetPassword.dart` | Accept `otp` on constructor; pass to `resetPassword(email, password, otp)` |

No DB migration required. No new tables, no new columns.

---

End of audit. Read-only — no production files modified.
