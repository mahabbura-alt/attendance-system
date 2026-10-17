'use strict';

const FORMULA_VERSION = 'productive-ritase-v1';

function asRitaseInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    const error = new Error(`${label} harus berupa bilangan bulat 0 atau lebih.`);
    error.status = 422;
    throw error;
  }
  return number;
}

function normalizeRitase(grossValue, nonprodValue = 0) {
  const gross = asRitaseInteger(grossValue, 'Ritase bruto');
  const nonprod = asRitaseInteger(nonprodValue == null ? 0 : nonprodValue, 'Ritase Non Prod / Inpit');
  if (nonprod > gross) {
    const error = new Error('Ritase Non Prod / Inpit tidak boleh melebihi ritase bruto.');
    error.status = 422;
    throw error;
  }
  return { gross, nonprod, productive: gross - nonprod, formulaVersion: FORMULA_VERSION };
}

function productiveRitase(grossValue, nonprodValue = 0) {
  return normalizeRitase(grossValue, nonprodValue).productive;
}

function productionFromRitase(grossValue, nonprodValue, factorValue) {
  const factor = Number(factorValue);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return productiveRitase(grossValue, nonprodValue) * factor;
}

module.exports = { FORMULA_VERSION, normalizeRitase, productiveRitase, productionFromRitase };
