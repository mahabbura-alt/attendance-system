(function initRitaseReport(global) {
  'use strict';

  const THRESHOLDS = Object.freeze({ achieved: 95, near: 85 });
  const COLORS = ['#1559c7', '#dc2626', '#f97316', '#15803d'];

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatNumber(value, digits = 0) {
    if (!Number.isFinite(Number(value))) return '&mdash;';
    return Number(value).toLocaleString('id-ID', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatDateId(dateOnly) {
    const match = String(dateOnly || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(dateOnly || '');
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  function shiftSlots(fleet) {
    const start = Number(String(fleet?.operational_start || (fleet?.lintas_hari ? '18:00' : '06:00')).slice(0, 2));
    const end = Number(String(fleet?.operational_end || (fleet?.lintas_hari ? '06:00' : '18:00')).slice(0, 2));
    const result = [];
    let hour = start;
    let guard = 0;
    while (hour !== end && guard < 24) {
      result.push(hour);
      hour = (hour + 1) % 24;
      guard += 1;
    }
    return result;
  }

  // Cutoff bersifat eksklusif: cutoff 14:00 membaca slot 06..13.
  function elapsedSlotsBeforeCutoff(fleet, cutoffHour) {
    const slots = shiftSlots(fleet);
    if (!slots.length || !Number.isInteger(cutoffHour)) return [];
    const start = slots[0];
    const elapsed = (cutoffHour - start + 24) % 24;
    if (elapsed < 1 || elapsed > slots.length) return [];
    return slots.slice(0, elapsed);
  }

  function timeMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes < 1440 ? minutes : null;
  }

  function hourInWindow(hour, startValue, endValue) {
    const start = timeMinutes(startValue);
    const end = timeMinutes(endValue);
    if (start == null || end == null || start === end) return false;
    const minute = Number(hour) * 60;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  function plannedNonProductiveReason(fleet, hour) {
    const shiftStart = Number(String(fleet?.operational_start || '').slice(0, 2));
    const standardDay = shiftStart === 6;
    const standardNight = shiftStart === 18;
    const changeStart = fleet?.change_shift_start || (standardDay ? '06:00' : standardNight ? '18:00' : null);
    const changeEnd = fleet?.change_shift_end || (standardDay ? '07:00' : standardNight ? '19:00' : null);
    const breakStart = fleet?.break_start || (standardDay ? '12:00' : standardNight ? '00:00' : null);
    const breakEnd = fleet?.break_end || (standardDay ? '13:00' : standardNight ? '01:00' : null);
    if (hourInWindow(hour, changeStart, changeEnd)) return { key: 'change-shift', label: 'CHANGE SHIFT' };
    if (hourInWindow(hour, breakStart, breakEnd)) return { key: 'break', label: 'ISTIRAHAT' };
    return null;
  }

  function productivityUnit(fleet) {
    return /ton/i.test(String(fleet?.plan_productivity_unit || '')) ? 'Ton' : 'BCM';
  }

  function scopeKey(fleet) {
    return [String(fleet?.pit_area || 'Belum ada area').trim(), String(fleet?.job_code || 'Belum ada JOB').trim(), productivityUnit(fleet)].join('|');
  }

  function buildScopes(fleets) {
    const map = new Map();
    (fleets || []).forEach(fleet => {
      const key = scopeKey(fleet);
      if (!map.has(key)) map.set(key, {
        key,
        pitArea: String(fleet.pit_area || 'Belum ada area'),
        jobCode: String(fleet.job_code || 'Belum ada JOB'),
        jobDescription: String(fleet.job_desc || ''),
        unit: productivityUnit(fleet),
        fleets: []
      });
      map.get(key).fleets.push(fleet);
    });
    return [...map.values()];
  }

  function factorFor(snapshot, fleet, truck) {
    const category = fleet.material_type === 'Coal' ? 'Coal' : 'OB';
    // Endpoint Truck Factor mengembalikan material dalam huruf besar. Nilai
    // efektif pada baris truck berasal dari query backend yang sama.
    if (truck.factor_value != null && truck.factor_value !== '') return number(truck.factor_value);
    const key = `${category}|${truck.tipe_alat}|${String(fleet.material_detail || '').trim().toUpperCase()}`;
    const value = snapshot.truckFactors?.[key];
    return value == null || value === '' ? null : number(value);
  }

  function statusForAchievement(achievement, actual) {
    if (!Number.isFinite(achievement)) return { key: 'incomplete', label: 'Data belum lengkap', color: '#64748b', bg: '#f1f5f9' };
    if (actual === 0) return { key: 'inactive', label: 'Tidak beroperasi', color: '#64748b', bg: '#f1f5f9' };
    if (achievement >= THRESHOLDS.achieved) return { key: 'achieved', label: 'Tercapai', color: '#15803d', bg: '#dcfce7' };
    if (achievement >= THRESHOLDS.near) return { key: 'near', label: 'Mendekati', color: '#b45309', bg: '#fef3c7' };
    return { key: 'below', label: 'Di bawah target', color: '#b91c1c', bg: '#fee2e2' };
  }

  function hourlyPerformanceTone(actual, target) {
    if (actual == null || actual === '' || target == null || target === '') return 'neutral';
    const actualValue = number(actual);
    const targetValue = number(target);
    if (actualValue == null || !(targetValue > 0)) return 'neutral';
    const achievement = actualValue / targetValue * 100;
    if (achievement >= 100) return 'achieved';
    if (achievement >= 80) return 'near';
    return 'below';
  }

  function buildReportModel(snapshot, selectedScopeKey, cutoffHour) {
    if (!snapshot || !Array.isArray(snapshot.fleets) || !snapshot.fleets.length) throw new Error('Belum ada fleet untuk dilaporkan.');
    const scope = buildScopes(snapshot.fleets).find(item => item.key === selectedScopeKey);
    if (!scope) throw new Error('Scope laporan tidak tersedia.');

    const shiftIds = [...new Set(scope.fleets.map(fleet => String(fleet.shift_id || '')))];
    if (shiftIds.length !== 1) throw new Error('Pilih satu Shift pada filter Input Ritase sebelum membuat laporan.');

    const invalidPlan = scope.fleets.filter(fleet => fleet.plan_status !== 'synced' || !(number(fleet.plan_productivity) > 0));
    if (invalidPlan.length) throw new Error(`Target Loader Productivity belum valid untuk: ${invalidPlan.map(fleet => fleet.excavator_kode || fleet.nama_fleet).join(', ')}.`);

    const fleets = scope.fleets.map((fleet, fleetIndex) => {
      const slots = elapsedSlotsBeforeCutoff(fleet, cutoffHour);
      if (!slots.length) throw new Error(`Jam cutoff tidak berada setelah awal dan sebelum/tepat akhir ${fleet.nama_shift || 'shift'}.`);
      const trucks = fleet.trucks || [];
      if (!trucks.length) throw new Error(`Fleet ${fleet.excavator_kode || fleet.nama_fleet} belum memiliki Dump Truck.`);
      const missingFactors = trucks.filter(truck => factorFor(snapshot, fleet, truck) == null);
      if (missingFactors.length) throw new Error(`Truck Factor belum lengkap untuk fleet ${fleet.excavator_kode || fleet.nama_fleet}.`);

      const hourly = slots.map(hour => {
        let ritase = 0;
        let grossRitase = 0;
        let nonprodRitase = 0;
        let actual = 0;
        const incompleteTrucks = [];
        const nonProductive = plannedNonProductiveReason(fleet, hour);
        trucks.forEach(truck => {
          const hasValue = Object.prototype.hasOwnProperty.call(truck.hours || {}, hour);
          if (!hasValue && !nonProductive) incompleteTrucks.push(truck.kode_alat);
          const gross = hasValue ? Math.max(0, number(truck.hours[hour]) || 0) : 0;
          const nonprod = hasValue ? Math.max(0, number(truck.nonprod_hours?.[hour]) || 0) : 0;
          if (nonprod > gross) throw new Error(`Non Prod fleet ${fleet.excavator_kode || fleet.nama_fleet}, ${truck.kode_alat}, jam ${String(hour).padStart(2, '0')}:00 melebihi ritase bruto.`);
          const count = gross - nonprod;
          grossRitase += gross;
          nonprodRitase += nonprod;
          ritase += count;
          actual += count * factorFor(snapshot, fleet, truck);
        });
        return {
          hour,
          ritase,
          grossRitase,
          nonprodRitase,
          actual,
          target: nonProductive ? 0 : number(fleet.plan_productivity),
          nonProductiveReason: nonProductive?.label || null,
          complete: incompleteTrucks.length === 0,
          incompleteTrucks
        };
      });
      const incomplete = hourly.flatMap(item => item.incompleteTrucks);
      if (incomplete.length) throw new Error(`Data ritase sampai cutoff belum lengkap untuk fleet ${fleet.excavator_kode || fleet.nama_fleet}. Simpan nilai 0 jika unit tidak melakukan ritase.`);

      const planRate = number(fleet.plan_productivity);
      const productiveHours = hourly.filter(item => !item.nonProductiveReason).length;
      const target = planRate * productiveHours;
      const actual = hourly.reduce((sum, item) => sum + item.actual, 0);
      const ritase = hourly.reduce((sum, item) => sum + item.ritase, 0);
      const grossRitase = hourly.reduce((sum, item) => sum + item.grossRitase, 0);
      const nonprodRitase = hourly.reduce((sum, item) => sum + item.nonprodRitase, 0);
      const achievement = target > 0 ? actual / target * 100 : null;
      const averageProductivity = productiveHours > 0 ? actual / productiveHours : null;
      const reportedHour = slots[slots.length - 1];
      const truckTotals = trucks.map(truck => ({
        code: truck.kode_alat,
        // Panel rincian DT adalah snapshot jam laporan, bukan akumulasi
        // sejak awal shift. Cutoff 16:00 berarti slot 15:00-15:59.
        ritase: Math.max(0, (number(truck.hours?.[reportedHour]) || 0) - (number(truck.nonprod_hours?.[reportedHour]) || 0)),
        grossRitase: Math.max(0, number(truck.hours?.[reportedHour]) || 0),
        nonprodRitase: Math.max(0, number(truck.nonprod_hours?.[reportedHour]) || 0)
      }));
      const exceptions = (fleet.productivity_exceptions || []).filter(item => slots.includes(Number(item.period_hour)));
      return {
        raw: fleet,
        color: COLORS[fleetIndex % COLORS.length],
        code: fleet.excavator_kode || fleet.nama_fleet || `Fleet ${fleetIndex + 1}`,
        material: fleet.material_detail || fleet.material_type || '-',
        planRate, slots, displaySlots: shiftSlots(fleet), hourly, productiveHours, target, actual, ritase, grossRitase, nonprodRitase, achievement, averageProductivity, reportedHour,
        status: statusForAchievement(achievement, actual), truckTotals, exceptions,
        finalDistanceKm: fleet.distance_summary?.complete ? number(fleet.distance_summary.finalDistanceKm) : null
      };
    });

    const elapsedHours = fleets[0].slots.length;
    const productiveHours = fleets[0].productiveHours;
    const target = fleets.reduce((sum, fleet) => sum + fleet.target, 0);
    const actual = fleets.reduce((sum, fleet) => sum + fleet.actual, 0);
    const ritase = fleets.reduce((sum, fleet) => sum + fleet.ritase, 0);
    const grossRitase = fleets.reduce((sum, fleet) => sum + fleet.grossRitase, 0);
    const nonprodRitase = fleets.reduce((sum, fleet) => sum + fleet.nonprodRitase, 0);
    const achievement = target > 0 ? actual / target * 100 : null;
    const deviation = target - actual;
    const hours = fleets[0].slots;
    const hourlyTotals = hours.map(hour => ({
      hour,
      actual: fleets.reduce((sum, fleet) => sum + (fleet.hourly.find(item => item.hour === hour)?.actual || 0), 0),
      ritase: fleets.reduce((sum, fleet) => sum + (fleet.hourly.find(item => item.hour === hour)?.ritase || 0), 0),
      grossRitase: fleets.reduce((sum, fleet) => sum + (fleet.hourly.find(item => item.hour === hour)?.grossRitase || 0), 0),
      nonprodRitase: fleets.reduce((sum, fleet) => sum + (fleet.hourly.find(item => item.hour === hour)?.nonprodRitase || 0), 0),
      target: fleets.reduce((sum, fleet) => sum + (fleet.hourly.find(item => item.hour === hour)?.target || 0), 0),
      nonProductiveReason: fleets.map(fleet => fleet.hourly.find(item => item.hour === hour)?.nonProductiveReason).find(Boolean) || null
    }));
    const problemMap = new Map();
    fleets.forEach(fleet => fleet.exceptions.forEach(exception => (exception.problems || []).forEach(problem => {
      const label = problem.problem || problem.code || 'Problem lain';
      problemMap.set(label, (problemMap.get(label) || 0) + (number(problem.impact_minutes) || 0));
    })));
    const problems = [...problemMap.entries()].map(([label, minutes]) => ({ label, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);

    return {
      tanggal: snapshot.tanggal,
      cutoffHour,
      cutoffLabel: `${String(cutoffHour).padStart(2, '0')}:00`,
      reportedHour: fleets[0].reportedHour,
      reportedHourLabel: `${String(fleets[0].reportedHour).padStart(2, '0')}:00-${String(fleets[0].reportedHour).padStart(2, '0')}:59`,
      shiftName: fleets[0].raw.nama_shift || 'Shift',
      scope, fleets, elapsedHours, productiveHours, target, actual, ritase, grossRitase, nonprodRitase, achievement, deviation,
      activeFleet: fleets.filter(fleet => fleet.actual > 0).length,
      displaySlots: fleets[0].displaySlots, hourlyTotals, problems
    };
  }

  function buildAreaReportModel(snapshot, selectedArea, cutoffHour) {
    const scopes = buildScopes(snapshot?.fleets || []).filter(scope => scope.pitArea === selectedArea);
    if (!scopes.length) throw new Error('Area laporan tidak tersedia.');
    const fleets = scopes.flatMap(scope => scope.fleets);
    const shiftIds = [...new Set(fleets.map(fleet => String(fleet.shift_id || '')))];
    if (shiftIds.length !== 1) throw new Error('Pilih satu Shift pada filter Input Ritase sebelum membuat laporan.');
    const sections = scopes.map(scope => buildReportModel(snapshot, scope.key, cutoffHour));
    return {
      tanggal: snapshot.tanggal,
      cutoffHour,
      cutoffLabel: sections[0].cutoffLabel,
      shiftName: sections[0].shiftName,
      pitArea: selectedArea,
      sections
    };
  }

  async function bukaLaporanRitase() {
    let snapshot = global.OMOSRitaseReportSnapshot;
    const selectedDate = document.getElementById('filterTanggalRitase')?.value || '';
    const selectedShift = document.getElementById('filterShiftRitase')?.value || '';
    if ((!snapshot || snapshot.tanggal !== selectedDate || String(snapshot.shiftId || '') !== selectedShift)
        && typeof global.muatProdRitase === 'function') {
      await global.muatProdRitase();
      snapshot = global.OMOSRitaseReportSnapshot;
    }
    if (!snapshot?.fleets?.length) return global.alert('Belum ada fleet pada tanggal dan shift yang dipilih.');

    const shiftIds = [...new Set(snapshot.fleets.map(fleet => String(fleet.shift_id || '')))];
    if (shiftIds.length > 1) return global.alert('Pilih satu Shift pada filter Input Ritase sebelum membuat laporan.');
    const areas = [...new Set(buildScopes(snapshot.fleets).map(scope => scope.pitArea))];
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:00`;
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalKonten');
    if (!overlay || !content) return;
    content.innerHTML = `<div style="width:min(520px,92vw);">
      <h3 style="margin:0;color:#0f172a;">Laporan Produksi &amp; Productivity</h3>
      <p style="margin:6px 0 16px;color:#64748b;font-size:13px;line-height:1.5;">Satu JPEG memuat seluruh JOB pada area terpilih. OB (BCM) dan Coal Getting (Ton) ditampilkan dalam bagian terpisah. Data dihitung dari Ritase yang sudah disimpan sampai cutoff eksklusif; pilihan 14:00 berarti sampai 13:59.</p>
      <form id="formGenerateRitaseReport">
        <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:800;color:#334155;">PIT / Area laporan</label>
        <select id="ritaseReportArea" class="input-filter" style="width:100%;margin-bottom:12px;" required>${areas.map(area => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join('')}</select>
        <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:800;color:#334155;">Jam laporan (cutoff)</label>
        <input id="ritaseReportCutoff" type="time" step="3600" value="${defaultTime}" class="input-filter" style="width:100%;margin-bottom:5px;" required>
        <small style="display:block;color:#64748b;margin-bottom:16px;">Default mengikuti jam berjalan pada perangkat user.</small>
        <div id="ritaseReportProgress" style="min-height:18px;margin-bottom:9px;font-size:12px;font-weight:700;color:#0f766e;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button id="btnGenerateRitaseReport" type="submit" class="tombol ritase-report-button">Generate JPEG</button></div>
      </form>
    </div>`;
    overlay.hidden = false;
    document.getElementById('formGenerateRitaseReport').addEventListener('submit', async event => {
      event.preventDefault();
      const time = document.getElementById('ritaseReportCutoff').value;
      const match = String(time).match(/^(\d{2}):00$/);
      if (!match) return global.alert('Jam laporan harus menggunakan menit 00, contoh 14:00.');
      const button = document.getElementById('btnGenerateRitaseReport');
      const progress = document.getElementById('ritaseReportProgress');
      button.disabled = true;
      progress.textContent = 'Menyiapkan laporan JPEG...';
      try {
        const model = buildAreaReportModel(snapshot, document.getElementById('ritaseReportArea').value, Number(match[1]));
        await generateJpeg(model);
        progress.textContent = 'Laporan berhasil diunduh.';
      } catch (error) {
        progress.style.color = '#b91c1c';
        progress.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  function kpiCard(label, value, unit, tone, note = '') {
    return `<div class="rr-kpi rr-${tone}"><small>${label}</small><strong>${value}</strong><span>${unit}</span>${note ? `<em>${note}</em>` : ''}</div>`;
  }

  function reportMarkup(model, options = {}) {
    if (Array.isArray(model?.sections)) return combinedReportMarkup(model);
    const { sectionOnly = false } = options;
    const achievementTone = model.achievement >= 95 ? 'green' : model.achievement >= 85 ? 'amber' : 'red';
    const deviationNote = model.deviation > 0 ? 'di bawah target' : model.deviation < 0 ? 'di atas target' : 'sesuai target';
    const displaySlots = model.displaySlots || model.hourlyTotals.map(item => item.hour);
    const hourHeaders = displaySlots.map(hour => {
      const item = model.hourlyTotals.find(entry => entry.hour === hour);
      return `<th class="${item?.nonProductiveReason ? 'rr-excluded-head' : ''}">${String(hour).padStart(2, '0')}:00${item?.nonProductiveReason ? `<small>${escapeHtml(item.nonProductiveReason)}</small>` : ''}</th>`;
    }).join('');
    const fleetRows = model.fleets.map(fleet => `<tr><th><i style="background:${fleet.color}"></i>${escapeHtml(fleet.code)} (${escapeHtml(fleet.material)})</th>${displaySlots.map(hour => {
      const item = fleet.hourly.find(entry => entry.hour === hour);
      if (!item) return '<td class="rr-hour-pending"></td>';
      const tone = item.nonProductiveReason ? 'excluded' : hourlyPerformanceTone(item.actual, fleet.planRate);
      const achievement = fleet.planRate > 0 ? item.actual / fleet.planRate * 100 : null;
      const title = item.nonProductiveReason ? `${item.nonProductiveReason} — target 0` : `Achievement ${formatNumber(achievement, 2)}%`;
      return `<td class="rr-hour-cell rr-hour-${tone}" title="${escapeHtml(title)}"><strong>${formatNumber(item.actual, 2)}</strong>${item.nonProductiveReason ? `<small>${escapeHtml(item.nonProductiveReason)}</small>` : ''}</td>`;
    }).join('')}<td class="rr-fleet-total"><strong>${formatNumber(fleet.actual, 2)}</strong></td></tr>`).join('');
    const productionRow = displaySlots.map(hour => {
      const item = model.hourlyTotals.find(entry => entry.hour === hour);
      return item ? `<td class="${item.nonProductiveReason ? 'rr-total-excluded' : ''}">${formatNumber(item.actual, 2)}</td>` : '<td class="rr-hour-pending"></td>';
    }).join('');
    const maxProblem = Math.max(1, ...model.problems.map(problem => problem.minutes));
    const problemRows = model.problems.length ? model.problems.map((problem, index) => `<div class="rr-problem"><span>${escapeHtml(problem.label)}</span><b><i style="width:${problem.minutes / maxProblem * 100}%;background:${COLORS[index % COLORS.length]}"></i></b><strong>${formatNumber(problem.minutes, 0)} min</strong></div>`).join('') : '<p class="rr-empty">Tidak ada problem productivity yang dilaporkan sampai cutoff.</p>';
    const fleetCards = model.fleets.map(fleet => `<div class="rr-fleet" style="border-top-color:${fleet.color}"><h3><i style="background:${fleet.color}"></i>${escapeHtml(fleet.code)}</h3><small>${escapeHtml(fleet.material)}${fleet.finalDistanceKm ? ` · Jarak Final ${formatNumber(fleet.finalDistanceKm, 2)} km` : ''}</small><div><span>Target<strong>${formatNumber(fleet.planRate, 2)} ${model.scope.unit}/Hr</strong></span><span>Aktual<strong>${formatNumber(fleet.averageProductivity, 2)} ${model.scope.unit}/Hr</strong></span><b style="color:${fleet.status.color};background:${fleet.status.bg}">${formatNumber(fleet.achievement, 2)}%</b></div></div>`).join('');
    const truckColumns = model.fleets.map(fleet => `<div class="rr-truck-col"><h4>${escapeHtml(fleet.code)}</h4>${fleet.truckTotals.map(truck => `<div><span>${escapeHtml(truck.code)}</span><strong>${formatNumber(truck.ritase, 0)} rit</strong></div>`).join('')}</div>`).join('');
    const reportId = `OMOS-RIT-${String(model.tanggal || '').replace(/-/g, '')}-${String(model.cutoffHour).padStart(2, '0')}`;

    return `<style>
      .rr-page{width:1600px;min-height:1060px;box-sizing:border-box;background:#fff;color:#10213b;padding:18px 22px;font-family:"IBM Plex Sans",Arial,sans-serif}
      .rr-page *{box-sizing:border-box}.rr-header{height:94px;display:grid;grid-template-columns:235px 1fr 235px;gap:18px;align-items:center;margin:-18px -22px 0;padding:10px 22px;background:linear-gradient(110deg,#062a53,#0a447d);color:#fff}.rr-brand-main{height:70px;width:150px;display:block;object-fit:contain;object-position:left center;background:#fff;border-radius:7px;padding:4px}.rr-title{text-align:center}.rr-title h1{font-family:"Space Grotesk",Arial,sans-serif;font-size:29px;letter-spacing:.025em;margin:0;color:#fff}.rr-title p{font-size:17px;font-weight:800;color:#dbeafe;margin:5px 0 0}.rr-client{text-align:center}.rr-client img{height:50px;width:70px;object-fit:contain;display:block;margin:auto;background:#fff;border-radius:6px;padding:3px}.rr-client strong{display:block;font-size:10px;white-space:nowrap;margin-top:3px;color:#fff}
      .rr-meta{display:grid;grid-template-columns:1fr 1.25fr .8fr .7fr;margin-top:9px;border:1px solid #b9cce3;border-radius:7px;overflow:hidden;background:#f8fbff}.rr-meta span{padding:8px 15px;font-size:13px;font-weight:800;border-right:1px solid #cbd9eb}.rr-meta span:last-child{border:0}.rr-meta b{color:#1559c7;margin-right:7px}
      .rr-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:10px}.rr-kpi{height:88px;border:1px solid #b8cae3;border-top:4px solid #1559c7;border-radius:9px;padding:8px 12px;text-align:center;background:linear-gradient(145deg,#f8fbff,#eef5ff)}.rr-kpi small{display:block;font-size:10px;font-weight:900;color:#1559c7}.rr-kpi strong{display:block;font:800 27px "Space Grotesk",Arial;margin-top:2px}.rr-kpi span{font-size:12px;font-weight:800;color:#345}.rr-kpi em{display:block;font-size:9px;font-style:normal;color:#64748b}.rr-kpi.rr-green{border-top-color:#15803d;background:linear-gradient(145deg,#f0fdf4,#dcfce7)}.rr-kpi.rr-green small,.rr-kpi.rr-green strong{color:#15803d}.rr-kpi.rr-amber{border-top-color:#d97706;background:linear-gradient(145deg,#fffbeb,#fef3c7)}.rr-kpi.rr-amber small,.rr-kpi.rr-amber strong{color:#b45309}.rr-kpi.rr-red{border-top-color:#b91c1c;background:linear-gradient(145deg,#fff7f7,#fee2e2)}.rr-kpi.rr-red small,.rr-kpi.rr-red strong{color:#b91c1c}
      .rr-fleets{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}.rr-fleet{min-height:108px;border:1px solid #b8cae3;border-top:4px solid;border-radius:8px;padding:8px 12px}.rr-fleet h3{font-size:15px;margin:0;text-align:center}.rr-fleet h3 i,.rr-matrix th i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.rr-fleet>small{display:block;text-align:center;font-size:11px;font-weight:800;color:#64748b}.rr-fleet>div{display:grid;grid-template-columns:1fr 1fr 75px;gap:7px;align-items:center;margin-top:7px}.rr-fleet span{font-size:10px;text-align:center;border-right:1px solid #dbe3ee}.rr-fleet span strong{display:block;font-size:13px;color:#10213b;margin-top:2px}.rr-fleet b{padding:8px 4px;border-radius:18px;text-align:center;font-size:13px}
      .rr-visuals{display:grid;grid-template-columns:1.65fr .9fr;gap:10px;margin-top:10px}.rr-panel{border:1px solid #b8cae3;border-radius:8px;overflow:hidden;background:#fff}.rr-panel h2{font:800 17px "Space Grotesk",Arial;text-align:center;color:#fff;background:linear-gradient(90deg,#073b77,#0b4f8f);margin:0;padding:7px}.rr-chart{height:245px;padding:8px 10px}.rr-ranking{padding:10px 16px}.rr-rank{display:grid;grid-template-columns:145px 1fr 58px;gap:8px;align-items:center;margin:13px 0;font-size:11px}.rr-rank b{height:15px;background:#eef2f7}.rr-rank b i{display:block;height:100%}.rr-rank strong{text-align:right}
      .rr-matrix{margin-top:10px}.rr-matrix table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px}.rr-matrix th,.rr-matrix td{border:1px solid #b9cce3;padding:5px;text-align:center;overflow:hidden}.rr-matrix thead th{background:#dce9f7;color:#102a56;font-weight:900}.rr-matrix thead th small,.rr-hour-cell small{display:block;margin-top:2px;font-size:7px;font-weight:900;letter-spacing:.03em}.rr-matrix tbody th{text-align:left;background:#f8fafc}.rr-matrix td strong{font-size:11px;font-weight:900;color:#102a56}.rr-hour-achieved{background:#dcfce7}.rr-hour-near{background:#fef3c7}.rr-hour-below{background:#fee2e2}.rr-hour-neutral{background:#f1f5f9}.rr-hour-pending{background:#f8fafc}.rr-hour-excluded,.rr-excluded-head{background:#e2e8f0!important;color:#475569!important}.rr-hour-excluded strong{color:#475569!important}.rr-fleet-total{background:#edf5ff}.rr-matrix tr:last-child{font-weight:900;color:#0b4fa8;background:#dcecff}.rr-matrix tr:last-child td.rr-total-excluded{background:#e2e8f0;color:#475569}.rr-matrix-legend{display:flex;justify-content:flex-end;gap:14px;align-items:center;padding:6px 8px 2px;color:#334155;font-size:9px;font-weight:800}.rr-matrix-legend span{display:flex;align-items:center;gap:5px}.rr-matrix-legend i{display:inline-block;width:18px;height:10px;border:1px solid rgba(15,23,42,.12);border-radius:2px}
      .rr-bottom{display:grid;grid-template-columns:.95fr 1.05fr;gap:10px;margin-top:10px}.rr-bottom .rr-panel{min-height:140px}.rr-problems{padding:10px 14px}.rr-problem{display:grid;grid-template-columns:145px 1fr 55px;gap:8px;align-items:center;margin:8px 0;font-size:10px}.rr-problem b{height:12px;background:#eef2f7}.rr-problem b i{display:block;height:100%}.rr-problem strong{text-align:right}.rr-empty{font-size:11px;color:#64748b;text-align:center;margin:30px 0}.rr-trucks{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px}.rr-truck-col{background:#f5f9ff;border:1px solid #d3e0ef;border-radius:6px;padding:5px}.rr-truck-col h4{text-align:center;font-size:11px;margin:0 0 4px;color:#0b4fa8}.rr-truck-col div{display:flex;justify-content:space-between;gap:5px;background:#fff;border:1px solid #d8e2ee;border-radius:4px;padding:4px 6px;margin-top:3px;font-size:9px}.rr-footer{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #b8cae3;border-radius:7px;margin-top:10px;padding:8px 14px;font-size:11px;color:#123f75}.rr-footer span:nth-child(2){text-align:center}.rr-footer span:last-child{text-align:right}
    </style>
    ${sectionOnly ? `<section class="rr-job-section"><h2 class="rr-job-title">${escapeHtml(model.scope.jobCode)}${model.scope.jobDescription ? ' &middot; ' + escapeHtml(model.scope.jobDescription) : ''}<small>${escapeHtml(model.scope.unit)} &bull; ${model.fleets.length} fleet</small></h2>` : `<div class="rr-header"><img class="rr-brand-main" src="assets/reports/omos-one-path.png" alt="OMOS"><div class="rr-title"><h1>${model.fleets.length > 1 ? 'MULTI-FLEET ' : ''}PRODUCTION &amp; PRODUCTIVITY REPORT</h1><p>${escapeHtml(formatDateId(model.tanggal))} &bull; ${escapeHtml(model.shiftName)} &bull; Cutoff ${model.cutoffLabel}</p></div><div class="rr-client"><img src="assets/reports/prima-logo.png" alt="Prima"><strong>PT PRIMA INDOJAYA MANDIRI</strong></div></div><div class="rr-meta"><span><b>PIT / AREA:</b>${escapeHtml(model.scope.pitArea)}</span><span><b>JOB:</b>${escapeHtml(model.scope.jobCode)}${model.scope.jobDescription ? ' &middot; ' + escapeHtml(model.scope.jobDescription) : ''}</span><span><b>UNIT:</b>${model.scope.unit}</span><span><b>STATUS:</b>FINAL</span></div>`}
    <div class="rr-kpis">${kpiCard('TARGET JAM BERJALAN',formatNumber(model.target,0),model.scope.unit,'blue',`${model.productiveHours} jam produktif &bull; s.d. ${model.cutoffLabel}`)}${kpiCard('AKTUAL JAM BERJALAN',formatNumber(model.actual,0),model.scope.unit,'blue',`s.d. ${model.cutoffLabel}`)}${kpiCard('ACHIEVEMENT',formatNumber(model.achievement,2)+'%','',achievementTone)}${kpiCard('RITASE PRODUKTIF',formatNumber(model.ritase,0),'rit','amber',`Bruto ${formatNumber(model.grossRitase,0)} &bull; Non Prod ${formatNumber(model.nonprodRitase,0)}`)}${kpiCard('ACTIVE FLEET',model.activeFleet,`dari ${model.fleets.length}`,'blue')}${kpiCard('DEVIASI',formatNumber(Math.abs(model.deviation),0),model.scope.unit,model.deviation > 0 ? 'red' : 'green',deviationNote)}</div>
    <div class="rr-fleets">${fleetCards}</div>
    <div class="rr-visuals"><div class="rr-panel"><h2>Hourly Production Trend (${model.scope.unit})</h2><div class="rr-chart"><canvas data-ritase-report-chart></canvas></div></div><div class="rr-panel"><h2>Fleet Achievement Ranking</h2><div class="rr-ranking">${[...model.fleets].sort((a,b)=>b.achievement-a.achievement).map((fleet,index)=>`<div class="rr-rank"><span>${index+1}. ${escapeHtml(fleet.code)}</span><b><i style="width:${Math.min(100,fleet.achievement)}%;background:${fleet.color}"></i></b><strong>${formatNumber(fleet.achievement,2)}%</strong></div>`).join('')}</div></div></div>
    <div class="rr-panel rr-matrix"><h2>Hourly Fleet Performance (${model.scope.unit}/Hr)</h2><table><colgroup><col style="width:195px">${displaySlots.map(() => '<col>').join('')}<col style="width:105px"></colgroup><thead><tr><th>Fleet / Hour</th>${hourHeaders}<th>TOTAL</th></tr></thead><tbody>${fleetRows}<tr><th>TOTAL PRODUCTION (${model.scope.unit})</th>${productionRow}<td>${formatNumber(model.actual,2)}</td></tr></tbody></table><div class="rr-matrix-legend"><span><i style="background:#dcfce7"></i>Tercapai &ge;100%</span><span><i style="background:#fef3c7"></i>Mendekati 80&ndash;&lt;100%</span><span><i style="background:#fee2e2"></i>Di bawah 80%</span></div></div>
    <div class="rr-bottom"><div class="rr-panel"><h2>Top Productivity Problems</h2><div class="rr-problems">${problemRows}</div></div><div class="rr-panel"><h2>RITASE PER UNIT DUMP TRUCK &bull; ${model.reportedHourLabel}</h2><div class="rr-trucks">${truckColumns}</div></div></div>
    ${sectionOnly ? '</section>' : `<div class="rr-footer"><span>System Generated Report &bull; OMOS Input Ritase</span><span>Report ID: ${reportId}</span><span>Generated: ${escapeHtml(new Date().toLocaleString('id-ID'))}</span></div>`}`;
  }

  function combinedReportMarkup(model) {
    const sections = model.sections;
    const jobCodes = [...new Set(sections.map(section => section.scope.jobCode))];
    const units = [...new Set(sections.map(section => section.scope.unit))];
    const reportId = `OMOS-RIT-${String(model.tanggal || '').replace(/-/g, '')}-${String(model.cutoffHour).padStart(2, '0')}`;
    return `<style>
      .rr-job-section{margin-top:14px;padding-top:2px;border-top:2px solid #d5e2f2}
      .rr-job-title{display:flex;justify-content:space-between;align-items:center;margin:0 0 2px;padding:8px 12px;background:#073b77;color:#fff;font:800 17px "Space Grotesk",Arial}
      .rr-job-title small{font-size:11px;font-weight:800;color:#dbeafe}
    </style>
    <div class="rr-header"><img class="rr-brand-main" src="assets/reports/omos-one-path.png" alt="OMOS"><div class="rr-title"><h1>${sections.length > 1 ? 'MULTI-JOB ' : ''}PRODUCTION &amp; PRODUCTIVITY REPORT</h1><p>${escapeHtml(formatDateId(model.tanggal))} &bull; ${escapeHtml(model.shiftName)} &bull; Cutoff ${model.cutoffLabel}</p></div><div class="rr-client"><img src="assets/reports/prima-logo.png" alt="Prima"><strong>PT PRIMA INDOJAYA MANDIRI</strong></div></div>
    <div class="rr-meta"><span><b>PIT / AREA:</b>${escapeHtml(model.pitArea)}</span><span><b>JOB:</b>${escapeHtml(jobCodes.join(' + '))}</span><span><b>UNIT:</b>${escapeHtml(units.join(' / '))}${units.length > 1 ? ' (terpisah)' : ''}</span><span><b>STATUS:</b>FINAL</span></div>
    ${sections.map(section => reportMarkup(section, { sectionOnly: true })).join('')}
    <div class="rr-footer"><span>System Generated Report &bull; OMOS Input Ritase</span><span>Report ID: ${reportId}</span><span>Generated: ${escapeHtml(new Date().toLocaleString('id-ID'))}</span></div>`;
  }

  function chartSeriesFor(section) {
    const displaySlots = section.displaySlots || section.fleets[0].slots;
    const hourly = new Map(section.hourlyTotals.map(item => [item.hour, item]));
    return {
      labels: displaySlots.map(hour => `${String(hour).padStart(2, '0')}:00`),
      actual: displaySlots.map(hour => hourly.get(hour)?.actual ?? null),
      target: displaySlots.map(hour => hourly.get(hour)?.target ?? null)
    };
  }

  async function waitForImages(root) {
    await Promise.all([...root.querySelectorAll('img')].map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    })));
  }

  async function generateJpeg(model) {
    if (typeof global.OMOSLoadLibrary === 'function') {
      await Promise.all([global.OMOSLoadLibrary('chart'), global.OMOSLoadLibrary('html2canvas')]);
    }
    if (typeof global.Chart !== 'function' || typeof global.html2canvas !== 'function') throw new Error('Library generator laporan tidak tersedia. Muat ulang halaman lalu coba lagi.');
    const report = document.createElement('div');
    report.className = 'rr-page';
    // Renderer membutuhkan elemen dengan dimensi layout nyata. Meletakkannya
    // sangat jauh di luar viewport dapat menghasilkan canvas 0x0 di sebagian
    // browser/driver grafis, sehingga canvas.toBlob() mengembalikan null.
    report.style.cssText = 'position:absolute;left:0;top:0;z-index:-2147483647;pointer-events:none;';
    report.innerHTML = reportMarkup(model);
    document.body.appendChild(report);
    await waitForImages(report);

    const sections = model.sections || [model];
    const charts = [];
    try {
      const canvases = [...report.querySelectorAll('[data-ritase-report-chart]')];
      if (canvases.length !== sections.length) throw new Error('Panel grafik laporan tidak lengkap.');
      sections.forEach((section, index) => {
        const series = chartSeriesFor(section);
        charts.push(new global.Chart(canvases[index].getContext('2d'), {
          type: 'bar',
          data: {
            labels: series.labels,
            datasets: [
              {
                label: `Produksi Aktual (${section.scope.unit})`,
                data: series.actual,
                borderColor: '#0b4f8f',
                backgroundColor: '#1559c7',
                borderWidth: 1,
                borderRadius: 3
              },
              {
                type: 'line',
                label: `Target per jam (${section.scope.unit})`,
                data: series.target,
                borderColor: '#dc2626',
                backgroundColor: '#dc2626',
                borderDash: [7,5],
                pointRadius: 0,
                borderWidth: 1.5
              }
            ]
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } },
            scales: {
              y: { beginAtZero: true, title: { display: true, text: `Production (${section.scope.unit})` }, ticks: { font: { size: 9 } } },
              x: { ticks: { font: { size: 9 } } }
            }
          }
        }));
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await global.html2canvas(report, {
        scale: 1.5,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: 1600,
        height: Math.ceil(report.scrollHeight),
        windowWidth: 1600,
        windowHeight: Math.max(1060, Math.ceil(report.scrollHeight)),
        scrollX: 0,
        scrollY: 0
      });
      if (!canvas.width || !canvas.height) throw new Error(`Canvas laporan tidak valid (${canvas.width}x${canvas.height}).`);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(`JPEG gagal dibuat dari canvas ${canvas.width}x${canvas.height}.`)), 'image/jpeg', .96));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeScope = `${model.pitArea || model.scope.pitArea}_${sections.map(section => section.scope.jobCode).join('-')}`.replace(/[^a-z0-9_-]+/gi, '_');
      link.href = url;
      link.download = `OMOS_Production_Report_${model.tanggal}_${model.cutoffLabel.replace(':','')}_${safeScope}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      console.error('[OMOS Ritase Report] JPEG generation failed', {
        message: error?.message || String(error),
        scope: model?.pitArea || model?.scope?.key,
        cutoff: model?.cutoffLabel
      });
      throw error;
    } finally {
      charts.forEach(chart => chart.destroy());
      report.remove();
    }
  }

  const api = { shiftSlots, elapsedSlotsBeforeCutoff, plannedNonProductiveReason, buildScopes, buildReportModel, buildAreaReportModel, chartSeriesFor, statusForAchievement, hourlyPerformanceTone, reportMarkup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.bukaLaporanRitase = bukaLaporanRitase;
  global.OMOSRitaseReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
