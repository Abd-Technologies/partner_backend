module.exports = (sequelize, DataTypes) => {
  const DailyCheckin = sequelize.define('DailyCheckin', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    date: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    energyLevel: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    moodLevel: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sleepHours: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    cravingType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    note: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cycleDay: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    cyclePhase: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    predictedEnergy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    predictedMood: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Phase A — Progress Screen symptom card. 0–10 severity scales matching
    // existing energyLevel / moodLevel. NULL on historical rows is correct;
    // SymptomDelta returns notEnoughData until ≥5 non-null rows exist per
    // period.
    bloatingSeverity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    crampSeverity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Sleep quality score (separate from sleepHours which is duration).
    // Used by the Sleep ring on the glance card.
    sleepQuality: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Reserved for future cycle insights. Not surfaced on the v1 Progress
    // hub but captured now so we don't have to migrate again later.
    periodFlow: {
      type: DataTypes.ENUM('spotting', 'light', 'medium', 'heavy'),
      allowNull: true,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['userId', 'date'],
      },
    ],
  });

  DailyCheckin.associate = (models) => {
    DailyCheckin.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return DailyCheckin;
};
