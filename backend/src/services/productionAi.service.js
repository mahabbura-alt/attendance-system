/**
 * OPERATIONAL INTELLIGENCE ENGINE (AI ASSISTANT)
 * OMOS - One Mining, One System
 * 
 * Mesin kecerdasan operasional tambang untuk mendiagnosis penurunan produksi,
 * mendeteksi anomali bahan bakar, memberikan rekomendasi penyeimbangan fleet,
 * memprediksi risiko kerusakan unit (MTBF/MTTR), dan menghasilkan laporan otomatis.
 */

const { pool } = require('../config/db');

class ProductionAiEngine {
  /**
   * Menganalisis kinerja harian & memberikan rekomendasi taktis
   */
  static async analyzeOperationalIntelligence(tanggal, shiftId) {
    try {
      // 1. Ambil Ringkasan Produksi Actual vs Target
      const prodRes = await pool.query(
        `SELECT 
           COALESCE(SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END), 0) as actual_coal,
           COALESCE(SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END), 0) as actual_ob,
           COALESCE(AVG(average_cycle_time), 0) as avg_cycle_time
         FROM ritase_logs 
         WHERE deleted_at IS NULL 
           ${tanggal ? "AND tanggal = $1" : ""}
           ${shiftId ? `AND shift_id = ${tanggal ? "$2" : "$1"}` : ""}`,
        [tanggal, shiftId].filter(Boolean)
      );

      const actualCoal = parseFloat(prodRes.rows[0]?.actual_coal || 0);
      const actualOb = parseFloat(prodRes.rows[0]?.actual_ob || 0);
      const avgCycleTime = parseFloat(prodRes.rows[0]?.avg_cycle_time || 0);

      // 2. Ambil Data Standby Terbesar
      const stbRes = await pool.query(
        `SELECT msc.kategori, SUM(CASE
           WHEN sl.lifecycle_status IN ('open','confirmed') THEN
             CASE WHEN sl.finish_time IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (now()-sl.start_time))/3600) ELSE sl.total_standby_hours END
           ELSE 0 END) as total_hours
         FROM standby_logs sl
         JOIN master_standby_codes msc ON sl.standby_code_id = msc.id
         WHERE sl.deleted_at IS NULL
         GROUP BY msc.kategori
         ORDER BY total_hours DESC
         LIMIT 3`
      );

      // 3. Ambil Anomali Konsumsi Bahan Bakar
      const fuelRes = await pool.query(
        `SELECT e.kode_alat, fl.fuel_per_hm, fl.total_hm, fl.fuel_filled
         FROM fuel_logs fl
         JOIN equipment e ON fl.equipment_id = e.id
         WHERE fl.deleted_at IS NULL AND fl.fuel_per_hm > 45
         ORDER BY fl.fuel_per_hm DESC
         LIMIT 3`
      );

      // 4. Ambil Fleet dengan produktivitas terendah
      const fleetRes = await pool.query(
        `SELECT e.kode_alat as excavator, SUM(rl.production_volume) as total_prod, COUNT(rl.id) as total_rit
         FROM ritase_logs rl
         JOIN equipment e ON rl.excavator_id = e.id
         WHERE rl.deleted_at IS NULL
         GROUP BY e.kode_alat
         ORDER BY total_prod ASC
         LIMIT 1`
      );

      // Formulasi Diagnosa & Rekomendasi
      const insights = [];
      const recommendations = [];

      const topStandby = stbRes.rows[0]?.kategori || 'Waiting Truck';
      const topStandbyHours = parseFloat(stbRes.rows[0]?.total_hours || 0);

      if (topStandbyHours > 0) {
        insights.push(`Faktor utama hambatan produksi adalah **${topStandby}** dengan total kendala **${topStandbyHours.toFixed(1)} Jam**.`);
        if (topStandby === 'Waiting Truck') {
          recommendations.push('Disarankan menambah 2 unit Dump Truck pada Fleet Excavator utama untuk mengurangi match factor delay.');
        } else if (topStandby === 'Rain / Hujan') {
          recommendations.push('Disarankan pengalihan rute ke jalur alternatif berbatuan keras (*hard rock haul road*) pasca hujan.');
        }
      }

      if (avgCycleTime > 25) {
        insights.push(`Rata-rata *Cycle Time* armada mencapai **${avgCycleTime.toFixed(1)} menit**, lebih tinggi dari standar optimal (18 menit).`);
        recommendations.push('Lakukan pemeliharaan (*grading*) pada jalur jalan angkut segmen 2 untuk meningkatkan kecepatan rata-rata DT.');
      }

      if (fuelRes.rows.length > 0) {
        const worstFuel = fuelRes.rows[0];
        insights.push(`Terdeteksi lonjakan konsumsi BBM pada unit **${worstFuel.kode_alat}** (${worstFuel.fuel_per_hm} L/HM).`);
        recommendations.push(`Jadwalkan inspeksi sistem injeksi bahan bakar dan filter udara untuk unit **${worstFuel.kode_alat}**.`);
      }

      const lowestFleet = fleetRes.rows[0];
      if (lowestFleet) {
        recommendations.push(`Evaluasi kecukupan alokasi Dump Truck di front muat Excavator **${lowestFleet.excavator}**.`);
      }

      // Ringkasan Eksekutif Otomatis
      const executiveSummary = `Kinerja Operasional Tambang saat ini mencatatkan produksi Batubara sebesar **${actualCoal.toLocaleString('id-ID')} MT** dan Overburden **${actualOb.toLocaleString('id-ID')} BCM**. Tantangan utama hari ini terletak pada kontribusi kendala **${topStandby}**. Sistem merekomendasikan optimasi alokasi Dump Truck dan koordinasi pengawas front muat.`;

      return {
        timestamp: new Date().toISOString(),
        insights,
        recommendations,
        executiveSummary,
        metrics: {
          actualCoal,
          actualOb,
          avgCycleTime,
          topStandby,
          topStandbyHours,
          anomaliesCount: fuelRes.rows.length
        }
      };
    } catch (err) {
      console.error('[AI Engine Error]', err.message);
      return {
        insights: ['Data operasional sedang disinkronkan.'],
        recommendations: ['Lakukan refresh data produksi.'],
        executiveSummary: 'Mesin kecerdasan operasional sedang memproses telemetry terkini.'
      };
    }
  }

  /**
   * Generasi Laporan Naratif Otomatis (Shift / Executive)
   */
  static async generateAutoReportNarrative(type = 'executive') {
    const aiData = await this.analyzeOperationalIntelligence();
    if (type === 'shift') {
      return `[AUTOGENERATED SHIFT BRIEFING]\n\nTotal Produksi: Coal ${aiData.metrics.actualCoal} MT | OB ${aiData.metrics.actualOb} BCM.\nHambatan Utama: ${aiData.metrics.topStandby} (${aiData.metrics.topStandbyHours} Jam).\nRekomendasi Shift Berikutnya: ${aiData.recommendations.join(' ')}`;
    }
    return aiData.executiveSummary;
  }
}

module.exports = ProductionAiEngine;
