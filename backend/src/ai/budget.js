'use strict';

/** Batas biaya bulanan & panggilan harian per tenant/project. */

const { usageSummary } = require('./aiAudit');

async function checkBudget(db, scope, settings) {
  const usage = await usageSummary(db, scope);
  if (settings.daily_call_limit >= 0 && usage.today_calls >= settings.daily_call_limit) {
    return { allowed: false, reason: 'DAILY_LIMIT', usage };
  }
  if (settings.monthly_budget_usd >= 0 && usage.month_cost_usd >= settings.monthly_budget_usd && settings.monthly_budget_usd > 0) {
    return { allowed: false, reason: 'MONTHLY_BUDGET', usage };
  }
  if (settings.monthly_budget_usd === 0 && usage.month_cost_usd > 0) {
    return { allowed: false, reason: 'MONTHLY_BUDGET', usage };
  }
  const warn = settings.monthly_budget_usd > 0 && usage.month_cost_usd >= 0.8 * settings.monthly_budget_usd;
  return { allowed: true, warn, usage };
}

module.exports = { checkBudget };
