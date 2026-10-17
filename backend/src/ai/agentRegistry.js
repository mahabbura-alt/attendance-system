'use strict';

/** Daftar agen AI OMOS. Versi prompt baru = berkas baru (v2), versi lama tetap untuk audit. */

const hazardDuplicateV1 = require('./agents/hse/hazardDuplicate.v1');
const hazardTriageV1 = require('./agents/hse/hazardTriage.v1');
const askPlannerV1 = require('./agents/hse/askPlanner.v1');
const askAnswerV1 = require('./agents/hse/askAnswer.v1');

const AGENTS = {
  [hazardDuplicateV1.id]: hazardDuplicateV1,
  [hazardTriageV1.id]: hazardTriageV1,
  [askPlannerV1.id]: askPlannerV1,
  [askAnswerV1.id]: askAnswerV1,
};

function getAgent(id) {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`Agen AI tidak dikenal: ${id}`);
  return agent;
}

function listAgents() {
  return Object.values(AGENTS).map(a => ({ id: a.id, version: a.version, alias: a.alias }));
}

module.exports = { getAgent, listAgents, AGENTS };
