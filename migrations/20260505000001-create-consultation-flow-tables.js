'use strict';

// Phase 1A — Consultation flow schema. Creates 7 new tables and adds 4
// columns to UserPlans. All adds are additive; no existing column is
// renamed or dropped, so this migration runs on production with no
// downtime (every ADD COLUMN is INSTANT on MySQL 8 / fast inplace on 5.7).
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── PreConsultationProfiles ─────────────────────────────────────
    await queryInterface.createTable('PreConsultationProfiles', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      goals: { type: Sequelize.STRING(64), allowNull: true },
      allergies: { type: Sequelize.TEXT, allowNull: true },
      pregnancyMenstrualStatus: { type: Sequelize.STRING(64), allowNull: true },
      dietaryPreferences: { type: Sequelize.JSON, allowNull: true },
      medicalConditions: { type: Sequelize.TEXT, allowNull: true },
      familyHistory: { type: Sequelize.TEXT, allowNull: true },
      lifestyle: { type: Sequelize.JSON, allowNull: true },
      fastingHabits: { type: Sequelize.TEXT, allowNull: true },
      surgeries: { type: Sequelize.TEXT, allowNull: true },
      currentMedications: { type: Sequelize.TEXT, allowNull: true },
      workoutSection: { type: Sequelize.JSON, allowNull: true },
      dietitianComments: { type: Sequelize.JSON, allowNull: true },
      stepsCompleted: { type: Sequelize.JSON, allowNull: true },
      isComplete: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      lastUserUpdate: { type: Sequelize.DATE, allowNull: true },
      lastDietitianEdit: { type: Sequelize.DATE, allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('PreConsultationProfiles', ['userId'], {
      name: 'pre_consult_profile_user_idx',
      unique: true,
    });

    // ── MealLogs ─────────────────────────────────────────────────────
    await queryInterface.createTable('MealLogs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      mealType: {
        type: Sequelize.ENUM('breakfast', 'lunch', 'dinner'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'followed', 'alternative', 'skipped'),
        allowNull: false,
        defaultValue: 'pending',
      },
      reasonCode: { type: Sequelize.STRING(32), allowNull: true },
      alternativeText: { type: Sequelize.STRING(255), allowNull: true },
      firstLoggedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      editCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('MealLogs', ['userId', 'date'], {
      name: 'meal_logs_user_date_idx',
    });
    await queryInterface.addIndex(
      'MealLogs',
      ['userId', 'date', 'mealType'],
      { name: 'meal_logs_user_date_meal_unique', unique: true }
    );

    // ── Day7Reviews ─────────────────────────────────────────────────
    await queryInterface.createTable('Day7Reviews', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userPlanId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'UserPlans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cycle: { type: Sequelize.INTEGER, allowNull: false },
      planType: {
        type: Sequelize.ENUM('diet', 'workout', 'combined'),
        allowNull: false,
      },
      adherencePct: { type: Sequelize.INTEGER, allowNull: true },
      mealsStruggled: { type: Sequelize.JSON, allowNull: true },
      hungerLevel: {
        type: Sequelize.ENUM('always_hungry', 'just_right', 'too_full'),
        allowNull: true,
      },
      sideEffects: { type: Sequelize.JSON, allowNull: true },
      difficultyLevel: {
        type: Sequelize.ENUM('too_easy', 'just_right', 'too_hard'),
        allowNull: true,
      },
      sessionTimingIssues: { type: Sequelize.BOOLEAN, allowNull: true },
      painReported: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      painLocation: { type: Sequelize.STRING(255), allowNull: true },
      severeSideEffectsReported: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      satisfaction: { type: Sequelize.INTEGER, allowNull: true },
      flagged: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      flagReasons: { type: Sequelize.JSON, allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex(
      'Day7Reviews',
      ['userId', 'userPlanId', 'cycle'],
      { name: 'day7_reviews_user_plan_cycle_idx' }
    );
    await queryInterface.addIndex('Day7Reviews', ['flagged'], {
      name: 'day7_reviews_flagged_idx',
    });

    // ── ProgressSubmissions ─────────────────────────────────────────
    await queryInterface.createTable('ProgressSubmissions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userPlanId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'UserPlans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cycle: { type: Sequelize.INTEGER, allowNull: false },
      weightKg: { type: Sequelize.FLOAT, allowNull: true },
      waistCm: { type: Sequelize.FLOAT, allowNull: true },
      hipsCm: { type: Sequelize.FLOAT, allowNull: true },
      chestCm: { type: Sequelize.FLOAT, allowNull: true },
      armsCm: { type: Sequelize.FLOAT, allowNull: true },
      thighsCm: { type: Sequelize.FLOAT, allowNull: true },
      clothesFit: {
        type: Sequelize.ENUM('tighter', 'same', 'looser'),
        allowNull: true,
      },
      sleepQuality: { type: Sequelize.INTEGER, allowNull: true },
      satisfaction: { type: Sequelize.INTEGER, allowNull: true },
      strengthNotes: { type: Sequelize.TEXT, allowNull: true },
      submittedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex(
      'ProgressSubmissions',
      ['userId', 'submittedAt'],
      { name: 'progress_submissions_user_date_idx' }
    );
    await queryInterface.addIndex(
      'ProgressSubmissions',
      ['userPlanId', 'cycle'],
      { name: 'progress_submissions_plan_cycle_unique', unique: true }
    );

    // ── Appointments extension (consolidating ConsultationBooking into
    // the existing Appointment model). The team's 5/3 migration already
    // added `In Progress` to status + completed_by + status_changed_at.
    // We add the two consultation-flow specific columns:
    //   • kind — initial vs followup (drives Day-15 follow-up booking flow)
    //   • noShowReportedAt — user reported the dietitian didn't join
    await queryInterface.addColumn('Appointments', 'kind', {
      type: Sequelize.ENUM('initial', 'followup'),
      allowNull: true, // nullable so legacy rows aren't forced to backfill
    });
    await queryInterface.addColumn('Appointments', 'noShowReportedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // ── EscalationTickets ───────────────────────────────────────────
    await queryInterface.createTable('EscalationTickets', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      dietitianId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      trigger: {
        type: Sequelize.ENUM(
          'PLAN_DELAYED',
          'CONSULT_NO_SHOW',
          'INACTIVITY',
          'MEDICAL',
          'REVIEW_FLAG',
          'BOOKING_REMINDER_5X',
          'SYSTEM_ISSUE'
        ),
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('low', 'medium', 'high'),
        allowNull: false,
        defaultValue: 'medium',
      },
      status: {
        type: Sequelize.ENUM('open', 'acknowledged', 'resolved'),
        allowNull: false,
        defaultValue: 'open',
      },
      payload: { type: Sequelize.JSON, allowNull: true },
      notifiedDietitian: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notifiedAdmin: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      openedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      resolvedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      resolutionNote: { type: Sequelize.STRING(500), allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('EscalationTickets', ['status'], {
      name: 'escalations_status_idx',
    });
    await queryInterface.addIndex('EscalationTickets', ['trigger'], {
      name: 'escalations_trigger_idx',
    });
    await queryInterface.addIndex('EscalationTickets', ['userId'], {
      name: 'escalations_user_idx',
    });
    await queryInterface.addIndex('EscalationTickets', ['dietitianId'], {
      name: 'escalations_dietitian_idx',
    });

    // ── PendingPopupStates ──────────────────────────────────────────
    await queryInterface.createTable('PendingPopupStates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      popupVariable: { type: Sequelize.STRING(64), allowNull: false },
      eligibleAt: { type: Sequelize.DATE, allowNull: true },
      lastShownAt: { type: Sequelize.DATE, allowNull: true },
      dismissCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex(
      'PendingPopupStates',
      ['userId', 'eligibleAt'],
      { name: 'pending_popups_user_eligible_idx' }
    );
    await queryInterface.addIndex(
      'PendingPopupStates',
      ['userId', 'popupVariable', 'completedAt'],
      { name: 'pending_popups_user_var_completed_idx' }
    );

    // ── UserPlans extension (4 new columns) ─────────────────────────
    await queryInterface.addColumn('UserPlans', 'firstPlanDeliveredAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'latestPlanDeliveredAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'cycle1StartedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'cycle2StartedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    // Reverse order — child tables first, parent extensions last.
    await queryInterface.removeColumn('UserPlans', 'cycle2StartedAt');
    await queryInterface.removeColumn('UserPlans', 'cycle1StartedAt');
    await queryInterface.removeColumn('UserPlans', 'latestPlanDeliveredAt');
    await queryInterface.removeColumn('UserPlans', 'firstPlanDeliveredAt');

    const dropIfExists = async (name) => {
      await queryInterface.dropTable(name).catch(() => {});
    };
    await dropIfExists('PendingPopupStates');
    await dropIfExists('EscalationTickets');
    await queryInterface
      .removeColumn('Appointments', 'noShowReportedAt')
      .catch(() => {});
    await queryInterface
      .removeColumn('Appointments', 'kind')
      .catch(() => {});
    await dropIfExists('ProgressSubmissions');
    await dropIfExists('Day7Reviews');
    await dropIfExists('MealLogs');
    await dropIfExists('PreConsultationProfiles');
    // MySQL: ENUM types are column-scoped; dropping the table cleans them
    // up. Postgres would need DROP TYPE separately — not relevant here.
  },
};
