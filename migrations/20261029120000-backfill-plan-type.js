'use strict';
// Plan.planType backfill (Oct 2026). planType was added in Sept but never
// filled, and new plans never set it, so code fell back to guessing from
// the title. This fills every empty planType from the plan's category
// (Diet / Workout / Both), or from the title when there's no category.
// Only empty values are touched; anything already set is left alone.
// Idempotent — safe on every start (app.js runs it after sync()).
const { typeFromWords, PLAN_TYPES } = require('../helper/planKind');

function typeFromCategoryTitle(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('both') || t.includes('combined')) return 'combined';
  return typeFromWords(t);
}

module.exports = {
  async up(queryInterface, Sequelize, db) {
    const { Plan, Category } = db;
    const cats = await Category.findAll({ attributes: ['id', 'title'] });
    const byCat = new Map(cats.map((c) => [c.id, typeFromCategoryTitle(c.title)]));
    const plans = await Plan.findAll({ attributes: ['id', 'title', 'CategoryId', 'planType'] });
    const changed = [];
    const unknown = [];
    for (const p of plans) {
      if (PLAN_TYPES.includes(p.planType)) continue;
      const type = byCat.get(p.CategoryId) || typeFromWords(p.title);
      if (!type) {
        unknown.push(`${p.id} "${p.title}"`);
        continue;
      }
      // hooks: false so the Plan model hook doesn't run a second lookup.
      await Plan.update({ planType: type }, { where: { id: p.id }, hooks: false });
      changed.push(`${p.id} "${p.title}" -> ${type}`);
    }
    return { changed, unknown };
  },
  async down() {},
};
