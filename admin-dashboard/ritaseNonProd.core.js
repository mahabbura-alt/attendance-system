(function initRitaseNonProd(global) {
  'use strict';

  function integer(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new Error(`${label} harus berupa bilangan bulat 0 atau lebih.`);
    return number;
  }

  function normalize(grossValue, nonprodValue) {
    const gross = integer(grossValue, 'Ritase bruto');
    const nonprod = integer(nonprodValue == null ? 0 : nonprodValue, 'Ritase Non Prod / Inpit');
    if (nonprod > gross) throw new Error('Ritase Non Prod / Inpit tidak boleh melebihi ritase bruto.');
    return { gross, nonprod, productive: gross - nonprod };
  }

  function productive(grossValue, nonprodValue) {
    return normalize(grossValue, nonprodValue).productive;
  }

  const api = { normalize, productive };
  global.OMOSRitaseNonProd = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
