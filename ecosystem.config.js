// PM2 — app backend (Nov 2026): the web server and the job worker.
//   pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: "fither-app",
      script: "app.js",
      instances: 1,          // more is fine: every job is locked (helper/jobRunner.js)
      autorestart: true,
      max_memory_restart: "700M",
      env:            { RUN_JOBS: "web" },
      env_production: { RUN_JOBS: "web", NODE_ENV: "production" },
    },
    {
      name: "fither-app-worker",
      script: "worker.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env:            { RUN_JOBS: "worker" },
      env_production: { RUN_JOBS: "worker", NODE_ENV: "production" },
    },
  ],
};
