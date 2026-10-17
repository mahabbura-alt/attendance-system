(function initBreakdownReport(global) {
  'use strict';

  const BREAKDOWN_STATUS_META = {
    mechanic_progress: { label: 'Progres Mekanik', color: '#1559c7', bg: '#dbeafe', border: '#93c5fd' },
    waiting_part: { label: 'Waiting Part', color: '#c2410c', bg: '#ffedd5', border: '#fdba74' },
    waiting_tool: { label: 'Waiting Tool', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
    waiting_manpower: { label: 'Waiting Manpower', color: '#6d28d9', bg: '#ede9fe', border: '#ddd6fe' },
    waiting_vendor: { label: 'Waiting Vendor', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
    resolved: { label: 'Ready to Operate', color: '#15803d', bg: '#dcfce7', border: '#86efac' }
  };

  const MONTH_NAMES_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatHours(value, digits = 1) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0,0';
    return num.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // Tanggal aktif pelaporan untuk badge laporan, mis.
  // "Selasa, 9 Sep 2026, 12.02 PM". Bagian waktu dibangun manual agar selalu
  // memakai pemisah ":" dan penanda AM/PM seperti yang diminta.
  function formatReportGeneratedAt(date) {
    const datePart = date.toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
    });
    let hour = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const meridiem = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${datePart}, ${hour}:${minutes} ${meridiem}`;
  }

  function getStatusMeta(status) {
    return BREAKDOWN_STATUS_META[status] || {
      label: status || '—', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1'
    };
  }

  function isEventInReportMonth(log, year, month) {
    const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const operationalDate = String(log?.tanggal || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)) return operationalDate.startsWith(prefix);
    const instant = new Date(log?.start_time);
    if (Number.isNaN(instant.getTime())) return false;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit'
    }).formatToParts(instant);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}` === prefix;
  }

  function partSummaryHtml(parts) {
    if (!Array.isArray(parts) || !parts.length) return '<span style="color:#94a3b8;font-size:10px;">—</span>';
    return parts.map(part => {
      const poText = part.po_number ? 'PO: ' + escapeHtml(part.po_number) : 'PO belum terbit';
      return '<div class="br-part-chip"><strong>' + escapeHtml(part.part_detail || 'Part') + '</strong><small>' + poText + '</small></div>';
    }).join('');
  }

  function buildUnitStatusGroups(unitStatus, equipmentList, activeLogs) {
    const byType = new Map();
    const add = (type, cls, isBd) => {
      const typeName = String(type || 'Lainnya').trim() || 'Lainnya';
      const className = String(cls || 'Tanpa Class').trim() || 'Tanpa Class';
      if (!byType.has(typeName)) byType.set(typeName, new Map());
      const classes = byType.get(typeName);
      if (!classes.has(className)) classes.set(className, { className: className, ready: 0, bd: 0 });
      const cell = classes.get(className);
      if (isBd) cell.bd += 1; else cell.ready += 1;
    };
    const groups = unitStatus && Array.isArray(unitStatus.groups) ? unitStatus.groups : null;
    if (groups && groups.length) {
      groups.forEach(group => {
        (group.units || []).forEach(unit => {
          add(group.equipmentType, unit.equipmentClass || unit.model, String(unit.status) === 'BD');
        });
      });
    } else {
      const bdIds = new Set((activeLogs || []).map(log => String(log.equipment_id || '')));
      (equipmentList || []).forEach(unit => {
        if (!unit || !unit.id) return;
        add(unit.kelas_alat, unit.class_unit || unit.tipe_alat, bdIds.has(String(unit.id)));
      });
    }
    return Array.from(byType.entries())
      .map(([equipmentType, classes]) => {
        const rows = Array.from(classes.values()).sort((a, b) => a.className.localeCompare(b.className, 'id-ID', { numeric: true }));
        const ready = rows.reduce((sum, row) => sum + row.ready, 0);
        const bd = rows.reduce((sum, row) => sum + row.bd, 0);
        return { equipmentType: equipmentType, total: ready + bd, ready: ready, breakdown: bd, classes: rows };
      })
      .sort((a, b) => a.equipmentType.localeCompare(b.equipmentType, 'id-ID'));
  }

  function buildReportModel(rawLogs, equipmentList, metrics, year, month, unitStatus) {
    const unitMap = new Map();
    (equipmentList || []).forEach(u => {
      if (u && u.id) unitMap.set(String(u.id), u);
      if (u && u.kode_alat) unitMap.set(String(u.kode_alat).trim().toUpperCase(), u);
    });

    const resolveUnit = (log) => {
      let found = log && log.equipment_id ? unitMap.get(String(log.equipment_id)) : null;
      if (!found && log && log.kode_alat) found = unitMap.get(String(log.kode_alat).trim().toUpperCase());
      return found || {
        id: log ? log.equipment_id : null,
        kode_alat: (log && log.kode_alat) || 'Unit',
        kelas_alat: (log && log.kelas_alat) || 'Lainnya',
        tipe_alat: (log && log.tipe_alat) || ''
      };
    };

    const activeLogs = [];
    const resolvedLogs = [];

    (rawLogs || []).forEach(log => {
      const unit = resolveUnit(log);
      const isResolved = log.current_status === 'resolved';
      const hours = Number(log.elapsed_breakdown_hours || 0);
      const enhanced = Object.assign({}, log, {
        unit: unit,
        hours: hours,
        statusMeta: getStatusMeta(log.current_status)
      });

      if (isResolved) {
        resolvedLogs.push(enhanced);
      } else {
        activeLogs.push(enhanced);
      }
    });

    activeLogs.sort((a, b) => b.hours - a.hours);
    resolvedLogs.sort((a, b) => new Date(b.finish_time || b.start_time) - new Date(a.finish_time || a.start_time));

    // Update Status Unit: dikelompokkan per jenis equipment, baris per Class
    // Unit, kolom angka Ready/BD. Sumber utama data board Update Status Unit
    // (unit-status/current); fallback jujur dari equipment + log aktif bila
    // sumber tidak tersedia.
    const statusGroups = buildUnitStatusGroups(unitStatus, equipmentList, activeLogs);

    const categoryEventMap = new Map();
    (rawLogs || []).forEach((log, index) => {
      // Planned PS tetap masuk total downtime/PA pada metrics API, tetapi bukan
      // failure mode sehingga tidak boleh mencemari Pareto kerusakan.
      if (log.is_planned_maintenance === true || log.counts_as_function_failure === false) return;
      // Endpoint juga mengirim incident carry-over agar status aktif tetap
      // terlihat. Pareto event hanya menghitung incident yang dilaporkan pada
      // bulan laporan terpilih, bukan carry-over dari bulan sebelumnya.
      if (!isEventInReportMonth(log, year, month)) return;
      const catName = String(log.kategori_breakdown || log.kode_breakdown || 'Lain-lain').trim();
      if (!categoryEventMap.has(catName)) categoryEventMap.set(catName, new Set());
      categoryEventMap.get(catName).add(log.id == null ? `row:${index}` : String(log.id));
    });

    const totalParetoEvents = Array.from(categoryEventMap.values()).reduce((sum, events) => sum + events.size, 0);
    const paretoCategories = Array.from(categoryEventMap.entries())
      .map(([name, eventIds]) => ({
        name: name,
        events: eventIds.size,
        pct: totalParetoEvents > 0 ? (eventIds.size / totalParetoEvents) * 100 : 0
      }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, 'id-ID', { numeric: true }))
      .slice(0, 5);

    const m = metrics || {};
    const totalIncidents = Number.isFinite(Number(m.functionalFailures))
      ? Number(m.functionalFailures)
      : rawLogs.filter(log => log.counts_as_function_failure !== false).length;
    const openCount = activeLogs.length;
    const mttr = Number(m.mttrHours || 0);
    const mtbf = Number(m.mtbfHours || 0);
    const pa = Number(m.calendarPa || 0);

    const now = new Date();
    const monthName = MONTH_NAMES_ID[Number(month) - 1] || 'Semua Bulan';
    const reportId = 'OMOS-BD-' + year + String(month).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');

    return {
      year: year,
      month: month,
      monthName: monthName,
      reportId: reportId,
      timestamp: now.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB',
      generatedAt: formatReportGeneratedAt(now),
      metrics: {
        totalIncidents: totalIncidents,
        openCount: openCount,
        mttr: mttr,
        mtbf: mtbf,
        pa: pa
      },
      activeLogs: activeLogs,
      resolvedLogs: resolvedLogs,
      statusGroups: statusGroups,
      statusTotal: statusGroups.reduce((sum, group) => sum + group.total, 0),
      paretoCategories: paretoCategories,
      totalParetoEvents: totalParetoEvents
    };
  }

  function reportMarkup(model) {
    const year = model.year;
    const monthName = model.monthName;
    const reportId = model.reportId;
    const timestamp = model.timestamp;
    const generatedAt = model.generatedAt;
    const metrics = model.metrics;
    const activeLogs = model.activeLogs;
    const statusGroups = model.statusGroups || [];
    const statusTotal = model.statusTotal || 0;
    const paretoCategories = model.paretoCategories;

    const kpiSection = `
      <div class="br-kpi-grid">
        <div class="br-kpi-card is-blue">
          <span class="br-kpi-label">TOTAL BD</span>
          <strong class="br-kpi-value">${metrics.totalIncidents}</strong>
          <small class="br-kpi-sub">${monthName} ${year}</small>
        </div>
        <div class="br-kpi-card ${metrics.openCount > 0 ? 'is-red' : 'is-green'}">
          <span class="br-kpi-label">AKTIF SAAT INI</span>
          <strong class="br-kpi-value">${metrics.openCount}</strong>
          <small class="br-kpi-sub">${metrics.openCount > 0 ? 'Sedang / Menunggu Perbaikan' : 'Semua Unit Ready'}</small>
        </div>
        <div class="br-kpi-card is-orange">
          <span class="br-kpi-label">MTTR RATA-RATA</span>
          <strong class="br-kpi-value">${formatHours(metrics.mttr)}</strong>
          <small class="br-kpi-sub">Jam / BD</small>
        </div>
        <div class="br-kpi-card is-green">
          <span class="br-kpi-label">MTBF RATA-RATA</span>
          <strong class="br-kpi-value">${formatHours(metrics.mtbf)}</strong>
          <small class="br-kpi-sub">Jam Antar Breakdown</small>
        </div>
        <div class="br-kpi-card is-blue">
          <span class="br-kpi-label">CALENDAR PA</span>
          <strong class="br-kpi-value ${metrics.pa >= 85 ? 'text-green' : 'text-orange'}">${formatHours(metrics.pa, 1)}%</strong>
          <small class="br-kpi-sub">Physical Availability</small>
        </div>
      </div>
    `;

    let activeRowsHtml = '';
    if (activeLogs.length > 0) {
      activeRowsHtml = activeLogs.map((log, idx) => {
        const isWaitingPart = log.current_status === 'waiting_part';
        const isCritical = log.hours >= 24;
        const rowBg = isWaitingPart ? 'background:#fff7ed;' : (idx % 2 === 1 ? 'background:#f8fafc;' : 'background:#ffffff;');
        const durationDisplay = isCritical
          ? '<strong style="color:#b91c1c;font-size:13px;">' + formatHours(log.hours) + ' JAM</strong><br/><small style="color:#b91c1c;font-weight:700;font-size:8px;">⚠️ &gt;24 Jam Kritis</small>'
          : '<strong>' + formatHours(log.hours) + '</strong> <small style="color:#64748b;">Jam</small>';

        return `
          <tr style="${rowBg}">
            <td style="text-align:center;font-weight:700;color:#64748b;">${idx + 1}</td>
            <td>
              <strong style="color:#0f172a;font-size:13px;">${escapeHtml(log.unit.kode_alat)}</strong>
            </td>
            <td>
              <span style="font-weight:600;color:#334155;">${escapeHtml(log.unit.kelas_alat || 'Unit')}</span>
              ${log.unit.tipe_alat ? '<small style="display:block;color:#64748b;font-size:9px;">' + escapeHtml(log.unit.tipe_alat) + '</small>' : ''}
            </td>
            <td>
              <strong style="color:#0369a1;">${escapeHtml(log.kode_breakdown || '')}</strong>
              <span style="color:#334155;">${escapeHtml(log.kategori_breakdown || 'Breakdown')}</span>
              ${log.description ? '<small style="display:block;color:#64748b;font-size:9px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(log.description) + '">' + escapeHtml(log.description) + '</small>' : ''}
            </td>
            <td>
              <span style="font-size:11px;font-weight:600;color:#334155;">${formatDateTime(log.start_time)}</span>
              ${log.nama_shift ? '<small style="display:block;color:#64748b;font-size:9px;">' + escapeHtml(log.nama_shift) + '</small>' : ''}
            </td>
            <td style="text-align:center;">
              ${durationDisplay}
            </td>
            <td style="text-align:center;">
              <span class="br-status-badge" style="background:${log.statusMeta.bg};color:${log.statusMeta.color};border:1px solid ${log.statusMeta.border};">
                ${escapeHtml(log.statusMeta.label)}
              </span>
            </td>
            <td>
              <span style="font-weight:600;color:#0f172a;font-size:11px;">${escapeHtml(log.pic_name || '—')}</span>
            </td>
            <td>
              ${partSummaryHtml(log.parts)}
            </td>
          </tr>
        `;
      }).join('');
    } else {
      activeRowsHtml = `
        <tr>
          <td colspan="9" style="text-align:center;padding:24px;color:#15803d;font-weight:700;background:#f0fdf4;">
            ✅ Tidak ada unit yang sedang breakdown saat ini. Seluruh armada dalam kondisi Siap Beroperasi (Ready).
          </td>
        </tr>
      `;
    }

    let statusGroupsHtml = '';
    if (statusGroups.length > 0) {
      statusGroupsHtml = statusGroups.map(group => {
        const classRows = group.classes.map(row => `
          <tr>
            <td>${escapeHtml(row.className)}</td>
            <td style="text-align:center;font-weight:800;color:#15803d;">${row.ready}</td>
            <td style="text-align:center;font-weight:800;color:#b91c1c;">${row.bd}</td>
          </tr>
        `).join('');

        return `
          <div class="br-usu-card">
            <div class="br-usu-card-head">
              <strong>${escapeHtml(group.equipmentType.toUpperCase())}</strong>
              <span>${group.total} Unit</span>
            </div>
            <table class="br-usu-table">
              <thead>
                <tr><th>Class Unit</th><th style="text-align:center;">✅ Ready</th><th style="text-align:center;">🔴 BD</th></tr>
              </thead>
              <tbody>
                ${classRows}
                <tr class="br-usu-total">
                  <td>Total</td>
                  <td style="text-align:center;">${group.ready}</td>
                  <td style="text-align:center;">${group.breakdown}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
      }).join('');
    } else {
      statusGroupsHtml = `
        <div style="grid-column:1/-1;text-align:center;padding:18px;background:#f8fafc;border-radius:8px;color:#64748b;font-size:12px;border:1px dashed #cbd5e1;">
          Tidak ada data status unit pada periode ini.
        </div>
      `;
    }

    let paretoBarsHtml = '';
    if (paretoCategories.length > 0) {
      paretoBarsHtml = paretoCategories.map((item, idx) => {
        const colors = ['#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea'];
        const barColor = colors[idx % colors.length];
        return `
          <div class="br-pareto-row">
            <div class="br-pareto-label">
              <span>${idx + 1}. ${escapeHtml(item.name)}</span>
              <strong>${item.events.toLocaleString('id-ID')} Event (${item.pct.toFixed(1)}%)</strong>
            </div>
            <div class="br-pareto-track">
              <div class="br-pareto-fill" style="width:${Math.max(4, Math.min(100, item.pct))}%;background:${barColor};"></div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      paretoBarsHtml = '<div style="color:#64748b;font-size:11px;text-align:center;padding:12px;">Tidak ada event breakdown pada periode ini</div>';
    }

    return `
      <style>
        .br-page {
          width: 1600px;
          min-height: 1060px;
          box-sizing: border-box;
          background: #f8fafc;
          color: #0f172a;
          padding: 20px 24px;
          font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          position: relative;
        }
        .br-page * { box-sizing: border-box; }

        .br-header {
          display: grid;
          grid-template-columns: 280px 1fr 240px;
          gap: 16px;
          align-items: center;
          margin: -20px -24px 16px;
          padding: 12px 24px;
          background: linear-gradient(110deg, #062a53 0%, #0a447d 100%);
          color: #ffffff;
          border-bottom: 3px solid #0284c7;
        }
        .br-client-logo {
          height: 52px;
          max-width: 260px;
          object-fit: contain;
          background: #ffffff;
          border-radius: 6px;
          padding: 4px 10px;
          display: block;
        }
        .br-title { text-align: center; }
        .br-title h1 {
          font-family: "Space Grotesk", Arial, sans-serif;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: 0.03em;
          margin: 0;
          color: #ffffff;
          text-transform: uppercase;
        }
        .br-title p {
          font-size: 14px;
          font-weight: 700;
          color: #bae6fd;
          margin: 4px 0 0;
        }
        .br-title .br-badge-live {
          display: inline-block;
          background: #10b981;
          color: #ffffff;
          font-size: 9px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 10px;
          margin-top: 4px;
          letter-spacing: 0.05em;
        }
        .br-brand-box {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }
        .br-brand-box img {
          height: 48px;
          max-width: 100px;
          object-fit: contain;
          background: #ffffff;
          border-radius: 6px;
          padding: 3px;
        }
        .br-brand-text {
          text-align: right;
          color: #ffffff;
        }
        .br-brand-text strong {
          display: block;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.05em;
          line-height: 1;
        }
        .br-brand-text small {
          font-size: 9px;
          color: #93c5fd;
          font-weight: 600;
        }

        .br-kpi-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        .br-kpi-card {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 10px 14px;
          text-align: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          border-top: 4px solid #0284c7;
        }
        .br-kpi-card.is-blue { border-top-color: #0284c7; }
        .br-kpi-card.is-red { border-top-color: #dc2626; }
        .br-kpi-card.is-orange { border-top-color: #ea580c; }
        .br-kpi-card.is-green { border-top-color: #16a34a; }
        .br-kpi-label {
          display: block;
          font-size: 10px;
          font-weight: 800;
          color: #64748b;
          letter-spacing: 0.04em;
        }
        .br-kpi-value {
          display: block;
          font-size: 26px;
          font-weight: 900;
          color: #0f172a;
          margin: 2px 0;
          font-family: "Space Grotesk", Arial, sans-serif;
        }
        .br-kpi-value.text-green { color: #16a34a; }
        .br-kpi-value.text-orange { color: #ea580c; }
        .br-kpi-sub {
          display: block;
          font-size: 10px;
          color: #64748b;
          font-weight: 600;
        }

        .br-section {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .br-section-head {
          padding: 8px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 800;
          font-size: 13px;
        }
        .br-section-head.is-danger {
          background: #fee2e2;
          color: #991b1b;
          border-bottom: 1px solid #fca5a5;
        }
        .br-section-head.is-success {
          background: #dcfce7;
          color: #166534;
          border-bottom: 1px solid #86efac;
        }
        .br-section-head.is-navy {
          background: #0f172a;
          color: #ffffff;
        }

        .br-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .br-table th {
          background: #f1f5f9;
          color: #334155;
          font-weight: 800;
          text-align: left;
          padding: 7px 10px;
          border-bottom: 1px solid #cbd5e1;
          border-right: 1px solid #e2e8f0;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .br-table td {
          padding: 6px 10px;
          border-bottom: 1px solid #e2e8f0;
          border-right: 1px solid #f1f5f9;
          vertical-align: middle;
        }
        .br-status-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }
        .br-part-chip {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 2px 6px;
          margin-bottom: 2px;
          font-size: 10px;
          line-height: 1.2;
        }
        .br-part-chip strong { display: block; color: #0f172a; }
        .br-part-chip small { color: #0284c7; font-weight: 700; font-size: 8px; }

        .br-bottom-grid {
          display: grid;
          grid-template-columns: 1.45fr 1fr;
          gap: 14px;
        }

        .br-usu-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          padding: 12px;
        }
        .br-usu-card {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 6px;
          overflow: hidden;
        }
        .br-usu-card-head {
          background: #dcfce7;
          padding: 5px 10px;
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #166534;
          border-bottom: 1px solid #bbf7d0;
        }
        .br-usu-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
          background: #ffffff;
        }
        .br-usu-table th {
          background: #f1f5f9;
          color: #334155;
          font-size: 9px;
          text-transform: uppercase;
          padding: 4px 8px;
          border-bottom: 1px solid #cbd5e1;
        }
        .br-usu-table td {
          padding: 4px 8px;
          border-bottom: 1px solid #e2e8f0;
          color: #0f172a;
        }
        .br-usu-total td {
          font-weight: 800;
          background: #f0fdf4;
          border-top: 1px solid #86efac;
        }

        .br-pareto-box {
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .br-pareto-row { margin-bottom: 4px; }
        .br-pareto-label {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          color: #334155;
          margin-bottom: 2px;
        }
        .br-pareto-track {
          background: #e2e8f0;
          height: 10px;
          border-radius: 5px;
          overflow: hidden;
        }
        .br-pareto-fill {
          height: 100%;
          border-radius: 5px;
        }

        .br-footer {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          border-top: 1px solid #cbd5e1;
          margin-top: 12px;
          padding-top: 8px;
          font-size: 10px;
          color: #64748b;
          font-weight: 600;
        }
        .br-footer span:nth-child(2) { text-align: center; font-family: monospace; font-weight: 700; color: #0f172a; }
        .br-footer span:last-child { text-align: right; }
      </style>

      <div class="br-page">
        <header class="br-header">
          <div class="br-client">
            <img src="assets/reports/prima-company-logo.jpg" alt="PT. Prima Indojaya Mandiri" class="br-client-logo" />
          </div>
          <div class="br-title">
            <h1>BREAKDOWN STATUS REPORT</h1>
            <p>${escapeHtml(monthName.toUpperCase())} ${year} • PERIODE BULANAN</p>
            <span class="br-badge-live">${escapeHtml(generatedAt)}</span>
          </div>
          <div class="br-brand-box">
            <img src="assets/reports/omos-one-path.png" alt="OMOS" onerror="this.style.display='none'" />
            <div class="br-brand-text">
              <strong>OMOS</strong>
              <small>One Mining, One System</small>
            </div>
          </div>
        </header>

        ${kpiSection}

        <section class="br-section">
          <div class="br-section-head is-danger">
            <span>🔴 UNIT BREAKDOWN AKTIF — ${activeLogs.length} BD Dalam Penanganan</span>
            <small style="font-weight:600;">Diurutkan dari durasi breakdown terlama</small>
          </div>
          <table class="br-table">
            <thead>
              <tr>
                <th style="width:30px;text-align:center;">No</th>
                <th style="width:90px;">Kode Unit</th>
                <th style="width:130px;">Jenis / Tipe</th>
                <th style="width:230px;">Kategori Breakdown</th>
                <th style="width:110px;">Mulai Breakdown</th>
                <th style="width:90px;text-align:center;">Durasi</th>
                <th style="width:130px;text-align:center;">Status Progres</th>
                <th style="width:120px;">PIC Mekanik</th>
                <th>Outstanding Spare Part / PO</th>
              </tr>
            </thead>
            <tbody>
              ${activeRowsHtml}
            </tbody>
          </table>
        </section>

        <div class="br-bottom-grid">
          <section class="br-section" style="margin-bottom:0;">
            <div class="br-section-head is-success">
              <span>📋 UPDATE STATUS UNIT — ${statusTotal} Unit List Equipment</span>
              <small style="font-weight:600;">Dikelompokkan Berdasarkan Jenis Equipment</small>
            </div>
            <div class="br-usu-grid">
              ${statusGroupsHtml}
            </div>
          </section>

          <section class="br-section" style="margin-bottom:0;">
            <div class="br-section-head is-navy">
              <span>📊 Top 5 Penyebab Breakdown (Akumulasi Event)</span>
              <small style="font-weight:600;color:#94a3b8;">Pareto Analysis</small>
            </div>
            <div class="br-pareto-box">
              ${paretoBarsHtml}
            </div>
          </section>
        </div>

        <footer class="br-footer">
          <span>System Generated Report • OMOS Breakdown Module</span>
          <span>Report ID: ${reportId}</span>
          <span>Generated: ${timestamp}</span>
        </footer>
      </div>
    `;
  }

  async function waitForImages(root) {
    const images = Array.from(root.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  async function generateBreakdownJpeg(model) {
    if (typeof global.OMOSLoadLibrary === 'function') {
      await global.OMOSLoadLibrary('html2canvas');
    }
    if (typeof global.html2canvas !== 'function') {
      throw new Error('Library html2canvas belum tersedia. Muat ulang halaman.');
    }

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:0;top:0;z-index:-2147483647;pointer-events:none;';
    container.innerHTML = reportMarkup(model);
    document.body.appendChild(container);

    await waitForImages(container);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      // reportMarkup mengembalikan blok <style> sebelum elemen visual .br-page.
      // Elemen pertama container adalah <style> (tanpa konten visual), sehingga
      // html2canvas akan menghasilkan JPEG kosong bila menargetkan anak pertama.
      // Tangkap elemen .br-page secara eksplisit.
      const pageEl = container.querySelector('.br-page') || container;
      const canvas = await global.html2canvas(pageEl, {
        scale: 1.5,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#f8fafc',
        logging: false,
        width: 1600,
        height: Math.ceil(pageEl.scrollHeight || 1060),
        windowWidth: 1600,
        windowHeight: Math.max(1060, Math.ceil(pageEl.scrollHeight || 1060)),
        scrollX: 0,
        scrollY: 0
      });

      if (!canvas.width || !canvas.height) {
        throw new Error('Canvas laporan tidak valid (' + canvas.width + 'x' + canvas.height + ').');
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Gagal mengonversi canvas ke JPEG.')), 'image/jpeg', 0.95);
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeMonth = String(model.monthName).replace(/[^a-z0-9_-]+/gi, '_');
      link.href = url;
      link.download = 'OMOS_Breakdown_Report_' + model.year + '_' + String(model.month).padStart(2, '0') + '_' + safeMonth + '.jpg';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      console.error('[OMOS Breakdown Report] Generate JPEG failed:', err);
      throw err;
    } finally {
      container.remove();
    }
  }

  async function bukaLaporanBreakdown() {
    if (typeof global.muatProdBreakdown === 'function') {
      await global.muatProdBreakdown();
    }

    const yearVal = document.getElementById('slicerBreakdownTahun') ? document.getElementById('slicerBreakdownTahun').value : new Date().getFullYear();
    const monthVal = document.getElementById('slicerBreakdownBulan') ? document.getElementById('slicerBreakdownBulan').value : (new Date().getMonth() + 1);

    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalKonten');
    if (!overlay || !content) return;

    content.innerHTML = `
      <div style="width:min(520px,94vw);font-family:'IBM Plex Sans',Arial,sans-serif;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:24px;">📄</span>
          <div>
            <h3 style="margin:0;color:#0f172a;font-size:18px;font-weight:800;">Laporan Breakdown &amp; Ready Unit</h3>
            <p style="margin:2px 0 0;color:#64748b;font-size:12px;">Generate resume visual status breakdown armada ke format JPEG Enterprise.</p>
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:14px 0;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;">Tahun Periode</label>
              <input type="number" id="repBdYear" class="input-filter" value="${escapeHtml(yearVal)}" style="width:100%;font-weight:700;" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;">Bulan Periode</label>
              <select id="repBdMonth" class="input-filter" style="width:100%;font-weight:700;">
                ${MONTH_NAMES_ID.map((name, i) => '<option value="' + (i + 1) + '" ' + (Number(monthVal) === (i + 1) ? 'selected' : '') + '>' + name + '</option>').join('')}
              </select>
            </div>
          </div>
          <div style="font-size:11px;color:#0369a1;font-weight:600;display:flex;align-items:center;gap:6px;">
            <span>ℹ️</span> Termasuk rincian unit aktif, status spare part, update status unit, dan Pareto chart.
          </div>
        </div>

        <div id="repBdProgress" style="min-height:20px;font-size:12px;font-weight:700;color:#0d9488;margin-bottom:12px;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
          <button id="btnExecuteGenerateBdReport" type="button" class="tombol tombol--utama" style="background:#0284c7;border-color:#0284c7;font-weight:700;">
            📥 Download Report JPEG
          </button>
        </div>
      </div>
    `;

    overlay.hidden = false;

    document.getElementById('btnExecuteGenerateBdReport').addEventListener('click', async () => {
      const btn = document.getElementById('btnExecuteGenerateBdReport');
      const prog = document.getElementById('repBdProgress');
      const y = document.getElementById('repBdYear').value;
      const m = document.getElementById('repBdMonth').value;

      btn.disabled = true;
      prog.style.color = '#0d9488';
      prog.textContent = '⏳ Mengambil data dan menyiapkan dokumen visual...';

      try {
        const response = await fetch(getProdApiUrl('/api/admin/production/breakdown?year=' + encodeURIComponent(y) + '&month=' + encodeURIComponent(m)), {
          headers: Object.assign({}, getProdAuthHeaders())
        });
        const data = await readBreakdownResponse(response);
        const logs = Array.isArray(data.logs) ? data.logs : [];
        const metrics = data.metrics || {};
        const equipment = (global.masterProdData && global.masterProdData.equipment) ? global.masterProdData.equipment : [];
        let unitStatus = null;
        try {
          const statusResponse = await fetch(getProdApiUrl('/api/admin/production/breakdown/unit-status/current'), {
            headers: Object.assign({}, getProdAuthHeaders())
          });
          const statusData = await readBreakdownResponse(statusResponse);
          if (statusData && Array.isArray(statusData.groups)) unitStatus = statusData;
        } catch (statusErr) {
          console.warn('[OMOS Breakdown Report] Unit status tidak tersedia, memakai fallback equipment + log:', statusErr.message);
        }

        prog.textContent = '🎨 Merender canvas grafik dan menyusun JPEG...';
        const model = buildReportModel(logs, equipment, metrics, y, m, unitStatus);
        await generateBreakdownJpeg(model);

        prog.style.color = '#15803d';
        prog.textContent = '✅ Laporan JPEG berhasil diunduh!';
        setTimeout(() => {
          if (typeof global.tutupModalGenerik === 'function') global.tutupModalGenerik();
        }, 1200);
      } catch (err) {
        prog.style.color = '#b91c1c';
        prog.textContent = '❌ Gagal membuat laporan: ' + err.message;
        btn.disabled = false;
      }
    });
  }

  const api = {
    buildReportModel: buildReportModel,
    reportMarkup: reportMarkup,
    generateBreakdownJpeg: generateBreakdownJpeg,
    bukaLaporanBreakdown: bukaLaporanBreakdown
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.bukaLaporanBreakdown = bukaLaporanBreakdown;
  global.OMOSBreakdownReport = api;

})(typeof window !== 'undefined' ? window : globalThis);
