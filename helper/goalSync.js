'use strict';
/**
 * One weight goal (Oct 2026).
 *
 * Home's "Set target weight" saved only User.targetWeightKg, while the
 * Progress tab reads the Goal table, so Progress kept saying "Set a goal
 * to start tracking". Now every target save also creates / updates her
 * active Goal row, and Progress self-heals users who only have the old
 * User.targetWeightKg.
 *
 *   syncGoalFromTarget(userId)  call after User.targetWeightKg changes
 *   currentWeightKg(userId)     her latest weigh-in, else profile weight
 */
const { Op } = require('sequelize');
const { deriveExpectedPace } = require('./PaceEngine');

// Healthy pace used to pick a target date: 0.5 kg a week, 4..52 weeks.
const PACE_KG_PER_WEEK = 0.5;

function toIsoDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function classifyGoalType(startKg, targetKg) {
  if (Math.abs(startKg - targetKg) < 0.5) return 'maintain';
  return targetKg < startKg ? 'weight_loss' : 'weight_gain';
}

async function currentWeightKg(userId) {
  const { WeeklyCheckin, User } = require('../models');
  const newest = await WeeklyCheckin.findOne({
    where: { userId, weightKg: { [Op.not]: null } },
    order: [['weekDate', 'DESC']],
    attributes: ['weightKg'],
  });
  if (newest && Number(newest.weightKg) > 0) return Number(newest.weightKg);
  const u = await User.findByPk(userId, { attributes: ['weight'] });
  const w = u ? Number(u.weight) : NaN;
  return Number.isFinite(w) && w > 0 ? w : null;
}

async function syncGoalFromTarget(userId) {
  const { User, Goal } = require('../models');
  if (!Goal) return null;
  const user = await User.findByPk(userId, { attributes: ['id', 'targetWeightKg'] });
  if (!user) return null;
  const active = await Goal.findOne({
    where: { userId, status: 'active' },
    order: [['updatedAt', 'DESC']],
  });

  // Goal cleared: close the active one.
  if (user.targetWeightKg == null) {
    if (active) await active.update({ status: 'abandoned' });
    return null;
  }

  const target = Number(user.targetWeightKg);
  const now = await currentWeightKg(userId);
  const start = now != null ? now : target;
  const weeks = Math.min(52, Math.max(4, Math.ceil(Math.abs(start - target) / PACE_KG_PER_WEEK)));
  const startDate = toIsoDate(new Date());
  const targetDate = toIsoDate(new Date(Date.now() + weeks * 7 * 86400000));

  // Same target as before: keep her start and dates.
  if (active && Math.abs(Number(active.targetValueKg) - target) < 0.05) {
    if (now != null) await active.update({ currentValueKg: now });
    return active;
  }

  // New / changed target: a fresh goal from where she is today.
  const payload = {
    type: classifyGoalType(start, target),
    startValueKg: start,
    targetValueKg: target,
    currentValueKg: start,
    startDate,
    targetDate,
    expectedPaceKgPerWeek: deriveExpectedPace(start, target, startDate, targetDate),
    status: 'active',
  };
  if (active) {
    await active.update(payload);
    return active;
  }
  return Goal.create({ userId, weeklyClassTarget: 4, ...payload });
}

module.exports = { syncGoalFromTarget, currentWeightKg };
