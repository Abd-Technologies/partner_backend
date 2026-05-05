module.exports = (sequelize, DataTypes) => {
  const TrialToken = sequelize.define(
    "TrialToken",
    {
      token: {
        type: DataTypes.STRING(191),
        allowNull: false,
        unique: true,
      },
      issuedForPhone: {
        type: DataTypes.STRING(72),
        allowNull: true,
      },
      issuedForEmail: {
        type: DataTypes.STRING(191),
        allowNull: true,
      },
      referrerUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      usedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("issued", "used", "expired", "revoked"),
        allowNull: false,
        defaultValue: "issued",
      },
    },
    {
      tableName: "TrialTokens",
      timestamps: true,
    }
  );

  TrialToken.associate = (models) => {
    TrialToken.belongsTo(models.User, {
      foreignKey: "referrerUserId",
      as: "referrer",
    });
    TrialToken.belongsTo(models.User, {
      foreignKey: "usedByUserId",
      as: "usedBy",
    });
    TrialToken.hasMany(models.TrialJourney, {
      foreignKey: "trialTokenId",
      as: "journeys",
    });
  };

  return TrialToken;
};
