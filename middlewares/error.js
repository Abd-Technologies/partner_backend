const ApiResponse = require("../helper/ApiResponse");
module.exports = function (err, req, res, next) {
  // Oct 2026: friendly upload messages (helper/uploadRules.js / multer).
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.json(ApiResponse("0", "This file is too big. Please pick one under 15 MB.", {}));
  }
  if (err && (err.code === "UPLOAD_TYPE" || err.code === "LIMIT_UNEXPECTED_FILE")) {
    return res.json(ApiResponse("0", err.message || "This file type can't be uploaded.", {}));
  }
  const value = ApiResponse("0", err.message, {});
  return res.json(value);
};
