const B = process.env.HOME + "/mnt/dev/New folder/partner_backend";
process.env.JWT_ACCESS_SECRET = "test-secret";
const path = require("path");
const Module = require("module");
const req2 = Module.createRequire(B + "/app.js");
const { Op } = req2("sequelize");
const jwt = req2("jsonwebtoken");
const express = req2("express");
const http = require("http");

const likeMatch = (val, pat) => {
  const suf = pat.slice(1).replace(/\\(.)/g, "$1");
  return typeof val === "string" && val.endsWith(suf);
};
const T = {
  users: [
    { id: 1, userType: "User" }, { id: 2, userType: "User" }, { id: 9, userType: "Admin" },
    { id: 7, userType: "Customer_Support_Representative" }, { id: 5, userType: "Dietition" }, { id: 6, userType: "Dietition" },
  ],
  plan: [{ id: 1, UserId: 1, image: "/srv/app/public/payment_slips/slip-1778580496493-616488893.png" }],
  prog: [{ id: 1, UserId: 1, before: "public/images/before-237687764-.jpg", after: null }],
};
const matchWhere = (row, w) => {
  if (w[Op.or]) return w[Op.or].some((x) => matchWhere(row, x));
  return Object.entries(w).every(([k, v]) => (v && v[Op.like] ? likeMatch(row[k], v[Op.like]) : row[k] === v));
};
const model = (rows) => ({ findOne: async ({ where }) => rows.find((r) => matchWhere(r, where)) || null });
const models = {
  User: model(T.users), PlanImage: model(T.plan), ProgressImage: model(T.prog),
  SupportTicket: model([]), SupportTicketMessage: model([]),
};
const mock = (file, exp) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
mock(B + "/models/index.js", models);
mock(B + "/helper/dietitianScope.js", { getAssignedClientIds: async (id) => new Set(Number(id) === 5 ? [1] : []) });

const pf = require(B + "/helper/privateFiles.js");
const app = express();
app.use("/files", require(B + "/routes/FrontSite/privateFiles.js"));
app.use("/public", pf.publicGuard, express.static(B + "/public"));

const tok = (id) => jwt.sign({ id, email: "x" }, process.env.JWT_ACCESS_SECRET);
const get = (port, p, headers = {}) => new Promise((ok) => http.get({ port, path: p, headers }, (r) => { r.resume(); r.on("end", () => ok({ code: r.statusCode, cc: r.headers["cache-control"] })); }));

let pass = 0, fail = 0;
const check = (name, got, want) => { const g = got.code; if (g === want) { pass++; console.log("PASS", name, g); } else { fail++; console.log("FAIL", name, "got", g, "want", want); } };

const server = app.listen(0, async () => {
  const port = server.address().port;
  const SLIP = "/files/payment_slips/slip-1778580496493-616488893.png";
  const PROG = "/files/images/before-237687764-.jpg";
  const PUB = "/files/posts/image-1761399774514.jpg";
  check("no token -> 401", await get(port, SLIP), 401);
  check("bad token -> 401", await get(port, SLIP + "?t=abc"), 401);
  const own = await get(port, SLIP + "?t=" + tok(1));
  check("owner slip via ?t", own, 200);
  console.log("   cache-control:", own.cc);
  check("owner slip via header", await get(port, SLIP, { accessToken: tok(1) }), 200);
  check("other client slip -> 403", await get(port, SLIP + "?t=" + tok(2)), 403);
  check("admin slip", await get(port, SLIP + "?t=" + tok(9)), 200);
  check("CSR slip", await get(port, SLIP + "?t=" + tok(7)), 200);
  check("dietitian slip -> 403", await get(port, SLIP + "?t=" + tok(5)), 403);
  check("owner progress", await get(port, PROG + "?t=" + tok(1)), 200);
  check("assigned dietitian progress", await get(port, PROG + "?t=" + tok(5)), 200);
  check("other dietitian progress -> 403", await get(port, PROG + "?t=" + tok(6)), 403);
  check("CSR progress -> 403", await get(port, PROG + "?t=" + tok(7)), 403);
  check("other client progress -> 403", await get(port, PROG + "?t=" + tok(2)), 403);
  check("unknown-owner slip (other file) client -> 403", await get(port, "/files/payment_slips/slip-1778580558921-790631762.png?t=" + tok(1)), 403);
  check("unknown-owner slip admin -> 200", await get(port, "/files/payment_slips/slip-1778580558921-790631762.png?t=" + tok(9)), 200);
  check("public post any user", await get(port, PUB + "?t=" + tok(2)), 200);
  check("missing file -> 404", await get(port, "/files/payment_slips/nope.png?t=" + tok(9)), 404);
  check("traversal ../ -> 404", await get(port, "/files/../app.js?t=" + tok(9)), 404);
  check("traversal %2e%2e -> 404", await get(port, "/files/%2e%2e/app.js?t=" + tok(9)), 404);
  check("traversal %2e%2e%2f -> 404", await get(port, "/files/images/%2e%2e%2f%2e%2e%2fapp.js?t=" + tok(9)), 404);
  check("traversal backslash -> 404", await get(port, "/files/images/..%5c..%5capp.js?t=" + tok(9)), 404);
  check("dotfile -> 404", await get(port, "/files/.env?t=" + tok(9)), 404);
  // guard: default mode
  delete process.env.PRIVATE_FILES_PUBLIC;
  check("/public slip, PRIVATE_FILES_PUBLIC default -> 200", await get(port, "/public/payment_slips/slip-1778580496493-616488893.png"), 200);
  process.env.PRIVATE_FILES_PUBLIC = "false";
  check("/public slip, false -> 403", await get(port, "/public/payment_slips/slip-1778580496493-616488893.png"), 403);
  check("/public progress, false -> 403", await get(port, "/public/images/before-237687764-.jpg"), 403);
  check("/public post, false -> 200", await get(port, "/public/posts/image-1761399774514.jpg"), 200);
  const anyImg = require("fs").readdirSync(B + "/public/images").find((f) => f.startsWith("image-"));
  check("/public plan-style image (no slip row), false -> 200", await get(port, "/public/images/" + anyImg), 200);
  T.plan.push({ id: 2, UserId: 2, image: "public/images/" + anyImg }); pf._cache.clear();
  check("/public in-app slip in images/, false -> 403", await get(port, "/public/images/" + anyImg), 403);
  check("/files in-app slip owner 2", await get(port, "/files/images/" + anyImg + "?t=" + tok(2)), 200);
  check("/files in-app slip client 1 -> 403", await get(port, "/files/images/" + anyImg + "?t=" + tok(1)), 403);
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
});
