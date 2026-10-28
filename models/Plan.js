module.exports = (sequelize, DataTypes) => {
  const Plan = sequelize.define("Plan", {
    title: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    shortDescription: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    longDescription: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    // duration: {
    //   type: DataTypes.STRING(),
    //   allowNull: true,
    // },
    // price: {
    //   type: DataTypes.INTEGER,
    //   allowNull: true,
    // },

    status: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    dietitianId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    image: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    // Single authoritative source for "diet" / "workout" / "combined".
    // Replaces four previously-inconsistent ways of guessing this
    // (Category.title lookups with mismatched casing, substring
    // matching on this same title field, and an unverified client
    // value in day7ReviewController). See migration
    // 20260902000001-add-plan-type-to-plans and
    // scripts/list_plans_for_labeling.js for the backfill.
    planType: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
  });

  // Keep planType in step with the category (Oct 2026): new plans get it,
  // and changing a plan's category updates it. Admins never set planType
  // directly, so the category is the real choice.
  const syncPlanType = async (plan) => {
    if (plan.planType && !plan.changed("CategoryId")) return;
    const { typeFromWords } = require("../helper/planKind");
    let type = null;
    if (plan.CategoryId && sequelize.models.Category) {
      const cat = await sequelize.models.Category.findByPk(plan.CategoryId, { attributes: ["title"] });
      const t = String((cat && cat.title) || "").toLowerCase();
      type = t.includes("both") || t.includes("combined") ? "combined" : typeFromWords(t);
    }
    plan.planType = type || plan.planType || typeFromWords(plan.title);
  };
  Plan.beforeCreate(syncPlanType);
  Plan.beforeUpdate(syncPlanType);

  // Each user can have one email verification code
  Plan.associate = (models) => {
    Plan.hasMany(models.UserPlan);
    models.UserPlan.belongsTo(Plan);
    
    Plan.hasMany(models.Review);
    models.Review.belongsTo(Plan);
    
    Plan.hasOne(models.PlanImage);
    models.PlanImage.belongsTo(Plan);


    // Plan.hasMany(models.Time);
    // models.Time.belongsTo(Plan);

    Plan.hasMany(models.AssignedPlan);
    models.AssignedPlan.belongsTo(Plan);
    Plan.hasMany(models.Price, { foreignKey: 'planId' }); // A plan can have multiple prices
    models.Price.belongsTo(Plan, { foreignKey: 'planId' }); 
  };

  return Plan;
};
