'use strict';
/**
 * Alerts for the Fit Her team (Oct 2026), e.g. "a trial plan failed 3
 * times" or "the AI login is broken". Sent as a push to every admin with
 * the app, and as an email to ADMIN_ALERT_EMAIL (.env, comma separated,
 * optional). Never throws.
 *
 *   opsAlert(key, title, body, { everyMinutes })
 *     key           same key = same alert; sent at most once per
 *                   everyMinutes (default 60), so a broken AI login
 *                   doesn't send one alert per woman.
 */
const { Op } = require('sequelize');

const lastSent = new Map(); // fallback when Redis is down
let redis = null;
function getRedis() {
  if (redis) return redis;
  try {
    const Redis = require('ioredis');
    redis = new Redis();
    redis.on('error', () => {});
  } catch (e) {
    redis = null;
  }
  return redis;
}

async function firstTime(key, everyMinutes) {
  const ttl = Math.max(1, Math.round(everyMinutes * 60));
  try {
    const r = getRedis();
    if (r) return (await r.set(`opsalert:${key}`, '1', 'EX', ttl, 'NX')) === 'OK';
  } catch (_) {}
  const prev = lastSent.get(key) || 0;
  if (Date.now() - prev < ttl * 1000) return false;
  lastSent.set(key, Date.now());
  return true;
}

let transporter = null;
function mailer() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASSWORD) return null;
  try {
    const nodemailer = require('nodemailer');
    const port = parseInt(process.env.EMAIL_PORT, 10) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.EMAIL_USERNAME, pass: process.env.EMAIL_PASSWORD },
    });
  } catch (e) {
    transporter = null;
  }
  return transporter;
}

async function opsAlert(key, title, body, { everyMinutes = 60 } = {}) {
  try {
    if (!(await firstTime(key, everyMinutes))) return false;
    console.warn(`[ops-alert] ${title} — ${body}`);

    // Push to admins.
    try {
      const { User } = require('../models');
      const adminType = process.env.ADMIN || 'Admin';
      const admins = await User.findAll({
        where: { userType: adminType, deviceToken: { [Op.ne]: null } },
        attributes: ['deviceToken'],
      });
      const tokens = admins.map((a) => a.deviceToken).filter(Boolean);
      if (tokens.length) {
        const sendNotification = require('./notification');
        await sendNotification(tokens, { title, body }, { type: 'opsAlert' });
      }
    } catch (e) {
      console.error('[ops-alert] push failed:', e.message);
    }

    // Email.
    const to = String(process.env.ADMIN_ALERT_EMAIL || '').trim();
    const t = to ? mailer() : null;
    if (t) {
      try {
        await t.sendMail({
          from: `"Fit Her alerts" <${process.env.EMAIL_USERNAME}>`,
          to,
          subject: `[Fit Her] ${title}`,
          text: `${body}\n\nOpen the staff portal: Plans waiting / failed.`,
        });
      } catch (e) {
        console.error('[ops-alert] email failed:', e.message);
      }
    }
    return true;
  } catch (e) {
    console.error('[ops-alert]', e.message);
    return false;
  }
}

module.exports = { opsAlert };
