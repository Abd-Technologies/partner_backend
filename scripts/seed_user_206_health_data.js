const {
  User,
  Goal,
  WeeklyCheckin,
  UserCycleData,
  DailyCheckin,
  ClassAttendance,
  WaterLog,
  sequelize,
} = require('../models');

async function seedUser206() {
  const userId = 206;
  console.log(`Starting health data seeding for User ${userId}...`);

  const t = await sequelize.transaction();

  try {
    // 1. Update User flags
    await User.update(
      {
        useNewProgressHub: true,
        targetWeightKg: 52.0,
        weight: '55',
        height: '5.4',
        bmiResult: '20.30',
        mainGoal: 'Lose weight',
        status: true,
      },
      { where: { id: userId }, transaction: t }
    );
    console.log('1. User profile updated.');

    // 2. UserCycleData
    const existingCycle = await UserCycleData.findOne({
      where: { userId },
      transaction: t,
    });
    const cyclePayload = {
      userId,
      lastPeriodDate: '2026-09-04',
      averageCycleLength: 28,
      isRegular: 'yes',
      periodDuration: '5',
      flowType: 'medium',
      currentCycleDay: 10,
      currentPhase: 'follicular',
      dataProvided: 1,
    };
    if (existingCycle) {
      await existingCycle.update(cyclePayload, { transaction: t });
    } else {
      await UserCycleData.create(cyclePayload, { transaction: t });
    }
    console.log('2. UserCycleData updated.');

    // 3. Goal
    await Goal.destroy({ where: { userId }, transaction: t });
    await Goal.create(
      {
        userId,
        type: 'weight_loss',
        startValueKg: 57.5,
        targetValueKg: 52.0,
        currentValueKg: 55.0,
        startDate: '2026-08-14',
        targetDate: '2026-11-14',
        weeklyClassTarget: 4,
        expectedPaceKgPerWeek: 0.42,
        status: 'active',
      },
      { transaction: t }
    );
    console.log('3. Goal created.');

    // 4. WeeklyCheckins (5 weeks of gradual weight loss)
    await WeeklyCheckin.destroy({ where: { userId }, transaction: t });
    const weeklyRows = [
      { weekDate: '2026-08-17', weightKg: 57.2, waistCm: 74, hipCm: 97, weekRating: 4 },
      { weekDate: '2026-08-24', weightKg: 56.6, waistCm: 73, hipCm: 96, weekRating: 4 },
      { weekDate: '2026-08-31', weightKg: 56.0, waistCm: 72, hipCm: 95, weekRating: 5 },
      { weekDate: '2026-09-07', weightKg: 55.4, waistCm: 71, hipCm: 94, weekRating: 4 },
      { weekDate: '2026-09-13', weightKg: 55.0, waistCm: 70, hipCm: 94, weekRating: 5 },
    ];
    for (const w of weeklyRows) {
      await WeeklyCheckin.create({ userId, ...w }, { transaction: t });
    }
    console.log(`4. WeeklyCheckins seeded (${weeklyRows.length} weeks).`);

    // 5. DailyCheckins (25 days of check-ins across the last 28 days)
    await DailyCheckin.destroy({ where: { userId }, transaction: t });
    const checkinDays = [];
    const baseDate = new Date('2026-09-13T12:00:00Z');

    for (let offset = 27; offset >= 0; offset--) {
      // Skip a couple days for realistic check-in gaps
      if (offset === 19 || offset === 8 || offset === 2) continue;

      const d = new Date(baseDate);
      d.setUTCDate(d.getUTCDate() - offset);
      const dateStr = d.toISOString().split('T')[0];

      // Calculate cycle day relative to last period (Sept 4 = day 1)
      const periodAnchor = new Date('2026-09-04T12:00:00Z');
      const diffDays = Math.round((d - periodAnchor) / (1000 * 60 * 60 * 24));
      let cycleDay = ((diffDays % 28) + 28) % 28 + 1;

      let cyclePhase = 'follicular';
      if (cycleDay <= 5) cyclePhase = 'menstrual';
      else if (cycleDay <= 13) cyclePhase = 'follicular';
      else if (cycleDay <= 16) cyclePhase = 'ovulatory';
      else cyclePhase = 'luteal';

      const energy = 7 + Math.floor(Math.random() * 3); // 7, 8, 9
      const mood = 7 + Math.floor(Math.random() * 3);   // 7, 8, 9
      const sleepH = 7.0 + Math.round(Math.random() * 14) / 10; // 7.0 - 8.4
      const sleepQ = 7 + Math.floor(Math.random() * 3);
      const bloating = cyclePhase === 'menstrual' ? 4 : (cyclePhase === 'luteal' ? 3 : 1);
      const cramp = cyclePhase === 'menstrual' ? 3 : 0;

      checkinDays.push({
        userId,
        date: dateStr,
        energyLevel: energy,
        moodLevel: mood,
        sleepHours: sleepH,
        sleepQuality: sleepQ,
        bloatingSeverity: bloating,
        crampSeverity: cramp,
        cycleDay,
        cyclePhase,
        note: offset === 0 ? 'Consistent energy and great stamina!' : 'Completed full daily routine',
      });
    }

    for (const row of checkinDays) {
      await DailyCheckin.create(row, { transaction: t });
    }
    console.log(`5. DailyCheckins seeded (${checkinDays.length} days).`);

    // 6. WaterLogs (26 days of hydration)
    await WaterLog.destroy({ where: { userId }, transaction: t });
    let waterCount = 0;
    for (let offset = 27; offset >= 0; offset--) {
      if (offset === 15 || offset === 3) continue;
      const d = new Date(baseDate);
      d.setUTCDate(d.getUTCDate() - offset);
      const dateStr = d.toISOString().split('T')[0];
      const ml = 1900 + Math.floor(Math.random() * 600); // 1900 - 2500 ml
      await WaterLog.create(
        { userId, date: dateStr, amountMl: ml },
        { transaction: t }
      );
      waterCount++;
    }
    console.log(`6. WaterLogs seeded (${waterCount} days).`);

    // 7. ClassAttendance (16 attended classes, ending in a 5-day active streak)
    await ClassAttendance.destroy({ where: { user_id: userId }, transaction: t });
    const attendanceOffsets = [26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 3, 2, 1, 0];
    for (const off of attendanceOffsets) {
      const d = new Date(baseDate);
      d.setUTCDate(d.getUTCDate() - off);
      const dateStr = d.toISOString().split('T')[0];
      await ClassAttendance.create(
        {
          user_id: userId,
          slot_id: null,
          attended_at: dateStr,
        },
        { transaction: t }
      );
    }
    console.log(`7. ClassAttendance seeded (${attendanceOffsets.length} classes, 5-day streak).`);

    await t.commit();
    console.log('SUCCESS: All health and progress data seeded successfully for user 206!');
  } catch (err) {
    await t.rollback();
    console.error('ERROR SEEDING DATA:', err);
    process.exit(1);
  }

  process.exit(0);
}

seedUser206();
