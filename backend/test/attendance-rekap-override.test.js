'use strict';

// Regression test untuk aturan mutlak presensi: data presensi bersumber dari
// Rekap Performa. Keterangan manual admin (hadir_manual, off, cuti, izin,
// alpa, sakit) MENIMPA presensi kamera — kamera hanya jadi sumber saat tidak
// ada keterangan manual.
//
// Latar belakang: sebelumnya resolveDailyCategory memprioritaskan kamera di
// atas manual, sehingga admin tidak bisa menimpa data presensi presensi kamera
// melalui Rekap Performa. Halaman absensi (admin & portal) sudah memakai
// COALESCE(kp.kategori, a.status_datang) yang manual-first; aturan ini
// menyelaraskan Rekap Performa + Payroll ke sumber yang sama.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveDailyCategory } = require('../src/services/roster');

test('keterangan manual alpa menimpa presensi kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: 'alpa',
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'alpa');
  assert.equal(r.source, 'manual');
  assert.equal(r.expectedWork, true);
});

test('keterangan manual cuti menimpa presensi kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: 'cuti',
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'cuti');
  assert.equal(r.source, 'manual');
});

test('keterangan manual off menimpa presensi kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: 'off',
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'off');
  assert.equal(r.source, 'manual');
});

test('keterangan manual izin menimpa presensi kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: 'izin',
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'izin');
  assert.equal(r.source, 'manual');
});

test('keterangan manual hadir_manual menimpa presensi kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: 'hadir_manual',
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'hadir_manual');
  assert.equal(r.source, 'manual');
  assert.equal(r.expectedWork, true);
});

test('tanpa keterangan manual, presensi kamera tetap hadir_kamera', () => {
  const r = resolveDailyCategory({
    hasAttendance: true,
    manualCategory: null,
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'hadir_kamera');
  assert.equal(r.source, 'camera');
  assert.equal(r.expectedWork, true);
});

test('tanpa manual dan tanpa kamera, roster S menjadi alpa', () => {
  const r = resolveDailyCategory({
    hasAttendance: false,
    manualCategory: null,
    rosterStatus: 'S',
  });
  assert.equal(r.category, 'alpa');
  assert.equal(r.source, 'roster');
  assert.equal(r.expectedWork, true);
});

test('tanpa manual dan tanpa kamera, roster C menjadi cuti', () => {
  const r = resolveDailyCategory({
    hasAttendance: false,
    manualCategory: null,
    rosterStatus: 'C',
  });
  assert.equal(r.category, 'cuti');
  assert.equal(r.source, 'roster');
  assert.equal(r.expectedWork, false);
});