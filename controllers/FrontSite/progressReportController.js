// "Download PDF report" unlock rule (Oct 2026): a starting entry plus at
// least one weekly check-in 7+ days later, so the report shows real change.
// Entries = weekly weigh-ins (WeeklyCheckins) and weekly measurement
// reports (Reports).
const ApiResponse = require("../../helper/ApiResponse");

const DAY = 86400000;
const MIN_GAP_DAYS = 7;

exports.eligibility = async (req, res) => {
  try {
    const { WeeklyCheckin, Report } = require("../../models");
    const userId = req.user.id;
    const [checkins, reports] = await Promise.all([
      WeeklyCheckin.findAll({ where: { userId }, attributes: ["weekDate", "createdAt"] }),
      Report.findAll({ where: { userId }, attributes: ["createdAt"] }),
    ]);
    const times = [
      ...checkins.map((c) => new Date(c.weekDate || c.createdAt).getTime()),
      ...reports.map((r) => new Date(r.createdAt).getTime()),
    ].filter((t) => !isNaN(t)).sort((a, b) => a - b);
    if (!times.length) {
      return res.json(ApiResponse("1", "Report", {
        canDownload: false,
        reason: "Log your first weekly check-in to start your report.",
      }));
    }
    const first = times[0];
    const last = times[times.length - 1];
    const can = last - first >= MIN_GAP_DAYS * DAY;
    const unlockOn = new Date(first + MIN_GAP_DAYS * DAY);
    return res.json(ApiResponse("1", "Report", {
      canDownload: can,
      startedOn: new Date(first).toISOString(),
      unlockOn: can ? null : unlockOn.toISOString(),
      reason: can ? null : "Your report unlocks after your first weekly check-in.",
    }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};
