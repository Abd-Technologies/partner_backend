// worker.js — the app backend's background worker (Nov 2026).
//
// Runs every scheduled job except the ones that push live socket updates
// (those need the socket server, so they stay in app.js with RUN_JOBS=web).
//   web:    RUN_JOBS=web    node app.js
//   worker: RUN_JOBS=worker node worker.js
// ecosystem.config.js starts both. With RUN_JOBS unset, app.js runs every job
// itself, as before. Every job takes a database lock, so overlap is safe.
require("dotenv").config();
process.env.RUN_JOBS = "worker";
const db = require("./models");
require("./helper/errorMonitor").install({ sequelize: db.sequelize, role: "worker" });

db.sequelize.authenticate()
  .then(() => {
    console.log("✅ [worker] Database connected");
    require("./jobs/scheduler").start({ mode: "worker" });
  })
  .catch((e) => {
    console.error("[worker] failed to start:", e);
    process.exit(1);
  });
