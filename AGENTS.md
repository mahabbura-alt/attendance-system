# OMOS — Memori & Aturan Kerja Agent

Project: **OMOS (One Mining Operating System)** — root: `D:\OneDrive\Desktop\ONE MINING`.

Dua aturan tetap berlaku untuk **setiap tugas** dalam project ini:

## 1. Setiap Tugas Wajib Selaras dengan Scope Master Milestone

Sebelum memulai tugas apa pun, verifikasi keselarasan tugas dengan scope project di:
`OMOS_MASTER_PROJECT_MILESTONE_V2.6.md`

- Tugas harus berada dalam batas arsitektur v2.6: Core Platform, Mining Modules, Intelligence Layer, Control Plane, dan Client Data Plane.
- Tugas tidak boleh menyimpang dari prioritas P0/P1/P2 (§78), Thin Vertical Slice (§77), dan keputusan arsitektur yang sudah ditetapkan (freeze criteria §80).
- Bila tugas tampak di luar scope, mengubah keputusan yang sudah di-freeze, atau menambah boundary sistem baru, berhenti dan konfirmasi ke pemilik project terlebih dahulu.

## 2. Analisa Kebutuhan Skill Sebelum Coding

Sebelum menulis atau mengubah kode, periksa katalog skill di:
`OMOS-skill/` — indeks: `OMOS-skill/README.md`

- Pilih skill yang relevan dengan tugas, misalnya: `omos-mining-validation` untuk perubahan rumus/unit/density/rate produksi, `tdd` untuk pengembangan test-first, `code-review` untuk review perubahan, `domain-modeling` untuk pemodelan domain.
- Baca `OMOS-skill/<nama-skill>/SKILL.md` dan terapkan instruksinya sebelum mulai coding.
- Bila tidak ada skill yang cocok, lanjutkan dengan pendekatan standar dan catat alasan singkat pada hasil kerja.
