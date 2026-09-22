# OMOS Mining Intelligence — Smart Text Waterfall

## 1. Tujuan

Dokumen ini mendefinisikan rancangan **Smart Text / Mining Intelligence** pada modul Waterfall OMOS.

Smart Text tidak hanya menjelaskan nilai deviasi atribut Waterfall, tetapi juga mencari **event penyebab terbesar berdasarkan Pareto** dari sumber data operasional yang terkait.

Analisis wajib mengikuti konteks yang sedang dipilih user:

- Project
- Periode
- Job
- Kode Unit
- Attribute Waterfall

Sumber Pareto utama:

| Attribute Waterfall | Sumber Event | Halaman |
|---|---|---|
| PA | Breakdown Event | 3. Breakdown |
| UA | Standby Event | 4. Standby |
| Productivity | Problem Productivity | 5. Input Ritase |

Smart Text hanya melakukan Root Cause Analysis / Pareto apabila atribut Waterfall memberikan **impact negatif**.

---

# 2. Konsep Dasar

```text
WATERFALL MINUS
      │
      ├── PA (-)
      │     └── Event source: 3. Breakdown
      │
      ├── UA (-)
      │     └── Event source: 4. Standby
      │
      └── Productivity (-)
            └── Event source:
                5. Input Ritase
                → Problem Productivity
```

Semua pencarian dilakukan berdasarkan:

```text
PROJECT
+ PERIODE TERPILIH
+ JOB
+ KODE UNIT
+ ATTRIBUTE
```

Contoh:

```text
Periode:
01–20 September 2026

Job:
OB Removal

Unit:
EXC-01
```

Mining Intelligence hanya boleh menjelaskan data:

```text
EXC-01
+ OB Removal
+ 01–20 September 2026
```

Data dari unit, job, atau periode lain tidak boleh masuk ke analisis.

---

# 3. Prinsip Mining Intelligence

Misalnya Waterfall menghasilkan:

```text
PA            -3.8%
UA            -5.2%
Productivity  -7.4%
```

Sistem tidak cukup hanya menampilkan:

> UA mengalami penurunan 5,2%.

Sistem harus mencari event penyebab terbesar dan menghasilkan informasi seperti:

> UA mengalami deviasi -5,2%. Kontributor terbesar berasal dari Standby Waiting Front sebesar 18,4 jam atau 42% dari total standby, terutama pada unit DT-012 dan DT-018. Event berikutnya adalah Waiting Excavator sebesar 10,2 jam atau 23%. Kedua event tersebut menyumbang 65% terhadap total standby pada periode terpilih.

Dengan demikian Smart Text bekerja sebagai **Mining Intelligence**, bukan sekadar generator kalimat.

---

# 4. Arsitektur Utama

```text
OMOS WATERFALL
      ↓
NEGATIVE ATTRIBUTE
      ↓
ATTRIBUTE ROUTER
 ┌────┼──────────────┐
PA    UA        PRODUCTIVITY
│     │              │
BD    STB          RITASE
│     │              │
└─────┼──────────────┘
      ↓
 MI_EVENT_FACT
      ↓
 PARETO ENGINE
      ↓
 EVENT DICTIONARY
      ↓
 SMART TEXT RULE
      ↓
 MINING INTELLIGENCE
```

Keterangan:

- **Attribute Router** menentukan sumber event sesuai atribut.
- **MI Event Fact** menjadi layer normalisasi event.
- **Pareto Engine** menghitung penyebab dominan.
- **Event Dictionary** menyimpan pengetahuan tentang event.
- **Smart Text Rule** menyusun fakta menjadi narasi.
- **Mining Intelligence** menampilkan interpretasi ke user.

---

# 5. Tabel Konfigurasi Attribute

Nama tabel:

```text
mi_attribute_config
```

Tujuan:

Menentukan hubungan antara atribut Waterfall dengan sumber event.

```sql
CREATE TABLE mi_attribute_config (
    id BIGSERIAL PRIMARY KEY,

    attribute_code VARCHAR(30) UNIQUE NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,

    source_module VARCHAR(100) NOT NULL,
    source_page VARCHAR(100),

    event_type VARCHAR(50) NOT NULL,

    pareto_method VARCHAR(50) DEFAULT 'duration',

    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Seed awal:

```sql
INSERT INTO mi_attribute_config
(
    attribute_code,
    attribute_name,
    source_module,
    source_page,
    event_type,
    pareto_method
)
VALUES
(
    'PA',
    'Physical Availability',
    'breakdown',
    '3. Breakdown',
    'BREAKDOWN',
    'duration'
),
(
    'UA',
    'Use of Availability',
    'standby',
    '4. Standby',
    'STANDBY',
    'duration'
),
(
    'PRODUCTIVITY',
    'Productivity',
    'ritase',
    '5. Input Ritase - Problem Productivity',
    'PRODUCTIVITY_PROBLEM',
    'production_loss'
);
```

Dengan desain ini hubungan:

```text
PA → Breakdown
UA → Standby
Productivity → Problem Productivity
```

tidak perlu di-hard-code di frontend.

---

# 6. Master Event Intelligence

Nama tabel:

```text
mi_event_dictionary
```

Tabel ini menjadi kamus pengetahuan Mining Intelligence.

```sql
CREATE TABLE mi_event_dictionary (
    id BIGSERIAL PRIMARY KEY,

    attribute_code VARCHAR(30) NOT NULL,

    event_code VARCHAR(50) NOT NULL,
    event_name VARCHAR(150) NOT NULL,

    event_category VARCHAR(100),

    severity VARCHAR(20),

    cause_text TEXT,
    impact_text TEXT,
    recommendation_text TEXT,

    is_active BOOLEAN DEFAULT TRUE,

    UNIQUE(attribute_code, event_code)
);
```

## Contoh PA

```text
attribute       : PA
event_code      : ENG
event_name      : Engine Problem
category        : Power Train / Engine

cause_text:
Gangguan engine menyebabkan unit tidak available
untuk kegiatan produksi.

impact_text:
Meningkatkan breakdown hours dan menurunkan
Physical Availability unit.

recommendation_text:
Evaluasi repetitive failure, MTBF, histori maintenance
dan ketersediaan spare part.
```

## Contoh UA

```text
attribute       : UA
event_code      : WF
event_name      : Waiting Front
category        : Operational Standby

cause_text:
Unit tersedia secara mekanis tetapi tidak dapat
beroperasi karena front kerja belum tersedia.

impact_text:
Meningkatkan standby hours sehingga menurunkan UA.

recommendation_text:
Evaluasi kesiapan front dan sinkronisasi sequence
fleet dengan mine plan.
```

## Contoh Productivity

```text
attribute       : PRODUCTIVITY
event_code      : QUEUE
event_name      : Queue
category        : Hauling Constraint

cause_text:
Terjadi antrean unit yang meningkatkan cycle time.

impact_text:
Mengurangi ritase per jam dan productivity fleet.

recommendation_text:
Evaluasi match factor, jumlah truck dan distribusi fleet.
```

---

# 7. Event Fact Layer

Nama tabel:

```text
mi_event_fact
```

Disarankan Smart Text tidak melakukan query langsung ke seluruh tabel Breakdown, Standby, dan Ritase setiap kali halaman dibuka.

Semua event dinormalisasi terlebih dahulu ke satu layer.

```sql
CREATE TABLE mi_event_fact (
    id BIGSERIAL PRIMARY KEY,

    project_id BIGINT NOT NULL,

    event_date DATE NOT NULL,

    shift_code VARCHAR(20),

    job_code VARCHAR(50),

    unit_code VARCHAR(50) NOT NULL,

    fleet_code VARCHAR(50),

    attribute_code VARCHAR(30) NOT NULL,

    event_code VARCHAR(50),
    event_name VARCHAR(150),

    duration_minutes NUMERIC(12,2) DEFAULT 0,

    lost_ritase NUMERIC(12,2) DEFAULT 0,

    lost_tonnage NUMERIC(14,2) DEFAULT 0,

    production_loss NUMERIC(14,2) DEFAULT 0,

    source_table VARCHAR(100),
    source_id BIGINT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Arsitektur normalisasi:

```text
                  MI_EVENT_FACT
                       │
       ┌───────────────┼────────────────┐
       │               │                │
   BREAKDOWN         STANDBY       PRODUCTIVITY
       │               │                │
      PA              UA           Productivity
```

---

# 8. Filtering Wajib

Setiap analisis Pareto wajib mengikuti filter aktif pada halaman Waterfall.

Filter minimum:

```text
project_id
period_start
period_end
job_code
unit_code
```

Contoh query:

```sql
WHERE project_id = :project_id

AND event_date BETWEEN
    :start_date
    AND :end_date

AND (
    :job_code IS NULL
    OR job_code = :job_code
)

AND (
    :unit_code IS NULL
    OR unit_code = :unit_code
)
```

Prinsip:

```text
Waterfall Context
        ↓
Project
Period
Job
Unit
        ↓
Pareto Context
```

Pareto tidak boleh membaca data di luar konteks tersebut.

---

# 9. Pareto PA

Trigger:

```text
Waterfall PA < 0
```

Sumber data:

```text
Halaman 3. Breakdown
```

Filter:

```text
attribute_code = PA
```

Contoh query:

```sql
SELECT
    event_code,
    event_name,

    SUM(duration_minutes) / 60.0 AS hours,

    COUNT(*) AS frequency

FROM mi_event_fact

WHERE attribute_code = 'PA'

GROUP BY
    event_code,
    event_name

ORDER BY hours DESC;
```

Contoh hasil:

| Breakdown Event | Hours | Contribution |
|---|---:|---:|
| Engine | 24 | 40% |
| Hydraulic | 15 | 25% |
| Electrical | 9 | 15% |
| Tyre | 7 | 12% |
| Others | 5 | 8% |

Total Breakdown:

```text
60 jam
```

Pareto cumulative:

```text
Engine
   ↓
40%

Engine + Hydraulic
   ↓
65%

Engine + Hydraulic + Electrical
   ↓
80%
```

Smart Text dapat memprioritaskan event sampai cumulative contribution mencapai sekitar 80%.

---

# 10. Pareto UA

Trigger:

```text
Waterfall UA < 0
```

Sumber:

```text
Halaman 4. Standby
```

Filter:

```text
attribute_code = UA
```

Contoh hasil:

| Standby Event | Hours | Contribution |
|---|---:|---:|
| Waiting Front | 20 | 38% |
| Waiting Excavator | 14 | 27% |
| Rain | 8 | 15% |
| No Operator | 6 | 12% |
| Others | 4 | 8% |

Contoh Smart Text:

> UA mengalami deviasi negatif. Penyumbang standby terbesar adalah Waiting Front sebesar 20 jam atau 38%, diikuti Waiting Excavator sebesar 14 jam atau 27%. Kedua event tersebut menyumbang sekitar 65% dari total standby pada periode terpilih.

---

# 11. Pareto Productivity

Trigger:

```text
Waterfall Productivity < 0
```

Sumber:

```text
5. Input Ritase
        ↓
Problem Productivity
```

Basis pencarian:

```text
unit_code
job_code
periode
problem_productivity
```

Contoh:

| Problem | Lost Ritase | Lost Ton | Contribution |
|---|---:|---:|---:|
| Queue | 45 | 1.350 | 35% |
| Road Condition | 38 | 1.140 | 29% |
| Loading Delay | 22 | 660 | 17% |
| Fueling | 14 | 420 | 11% |
| Others | 10 | 300 | 8% |

Untuk Productivity, Pareto sebaiknya menggunakan:

```text
Production Loss
```

bukan hanya:

```text
Jumlah Kejadian
```

Alasannya:

```text
1 kejadian × 2 jam
```

dapat memberikan impact yang jauh lebih besar dibanding:

```text
10 kejadian × 2 menit
```

---

# 12. Smart Text Rule

Nama tabel:

```text
mi_text_rule
```

```sql
CREATE TABLE mi_text_rule (
    id BIGSERIAL PRIMARY KEY,

    attribute_code VARCHAR(30) NOT NULL,

    rule_code VARCHAR(50) NOT NULL,

    condition_type VARCHAR(30),

    priority INTEGER DEFAULT 100,

    template_text TEXT NOT NULL,

    is_active BOOLEAN DEFAULT TRUE,

    UNIQUE(attribute_code, rule_code)
);
```

## Template PA

```text
Physical Availability mengalami deviasi {variance}% terhadap target.

Kontributor breakdown terbesar adalah {pareto_1}
sebesar {value_1} jam ({percent_1}%),
diikuti {pareto_2} sebesar {value_2} jam
({percent_2}%).

Kedua event tersebut menyumbang
{cumulative_percent}% dari total breakdown.
```

## Template UA

```text
Use of Availability mengalami deviasi {variance}%.

Standby terbesar berasal dari {pareto_1}
sebesar {value_1} jam ({percent_1}%),
diikuti {pareto_2} sebesar {value_2} jam
({percent_2}%).
```

## Template Productivity

```text
Productivity berada {variance}% di bawah target.

Production loss terbesar berasal dari
{pareto_1} dengan estimasi kehilangan
{lost_ritase_1} ritase / {lost_tonnage_1} ton,
diikuti {pareto_2}.

Kedua problem tersebut berkontribusi
{cumulative_percent}% terhadap total
productivity loss.
```

---

# 13. Level Analisis Mining Intelligence

Smart Text disarankan menggunakan enam level analisis.

```text
LEVEL 1
WHAT HAPPENED
↓
UA -5.2%

LEVEL 2
WHY
↓
Waiting Front 42%

LEVEL 3
WHERE
↓
DT-012 / DT-018

LEVEL 4
WHEN
↓
Shift 1 / 14 Sept 2026

LEVEL 5
IMPACT
↓
18.4 standby hours

LEVEL 6
ACTION
↓
Evaluasi kesiapan front
```

Dengan pola tersebut Mining Intelligence tidak hanya menjawab:

```text
Apa yang terjadi?
```

tetapi juga:

```text
Mengapa?
Di mana?
Kapan?
Berapa impact?
Apa area tindakan utama?
```

---

# 14. Contoh Smart Text Final

Contoh output UA:

> UA berada 5,2% di bawah target. Analisis Pareto menunjukkan Waiting Front merupakan kontributor terbesar sebesar 42%, dengan akumulasi 18,4 jam standby. Event paling dominan terjadi pada DT-012 dan DT-018, khususnya pada Shift 1. Waiting Front bersama Waiting Excavator berkontribusi 65% terhadap total standby, sehingga kedua event tersebut menjadi area utama yang perlu dianalisis lebih lanjut.

---

# 15. Alur Waterfall Intelligence

```text
Actual Production
       │
       ▼
Waterfall Calculation
       │
       ├──── PA +
       │       └── Tidak perlu RCA
       │
       ├──── PA -
       │       ▼
       │    Breakdown Pareto
       │
       ├──── UA -
       │       ▼
       │     Standby Pareto
       │
       └──── Productivity -
               ▼
         Productivity Problem
               │
               ▼
          Pareto Analysis
               │
               ▼
       Smart Text Generator
```

Prinsip utama:

```text
Positive Attribute
→ Tidak perlu Root Cause Analysis

Negative Attribute
→ Jalankan Event Analysis
→ Hitung Pareto
→ Generate Smart Text
```

---

# 16. Struktur Output API

Backend dapat mengirim satu struktur universal ke frontend.

Contoh:

```json
{
  "attribute": "UA",
  "variance": -5.2,
  "status": "negative",

  "source": "standby",

  "filters": {
    "projectId": 1,
    "startDate": "2026-09-01",
    "endDate": "2026-09-20",
    "jobCode": "OB",
    "unitCode": null
  },

  "pareto": [
    {
      "rank": 1,
      "event": "Waiting Front",
      "hours": 18.4,
      "contribution": 42.0
    },
    {
      "rank": 2,
      "event": "Waiting Excavator",
      "hours": 10.2,
      "contribution": 23.0
    }
  ],

  "cumulativeContribution": 65.0,

  "smartText":
    "UA mengalami deviasi -5,2%. Kontributor utama berasal dari Waiting Front sebesar 18,4 jam (42%), diikuti Waiting Excavator sebesar 10,2 jam (23%). Kedua event tersebut menyumbang 65% dari total standby pada periode terpilih."
}
```

Dengan struktur ini frontend tidak perlu memahami seluruh algoritma Pareto.

Frontend cukup membaca:

```text
attribute
variance
pareto
smartText
```

---

# 17. Rule Engine vs LLM

Untuk implementasi awal, Smart Text tidak disarankan langsung menggunakan LLM sebagai sumber penentuan penyebab.

Gunakan:

```text
DATA EVENT
     ↓
PARETO ENGINE
     ↓
RULE ENGINE
     ↓
SMART TEXT
```

Jika AI/LLM digunakan di tahap berikutnya, arsitekturnya:

```text
DATA
 ↓
SQL Calculation
 ↓
Pareto
 ↓
Facts
 ↓
LLM
 ↓
Natural Language / Recommendation
```

LLM hanya boleh:

- Menjelaskan fakta.
- Merangkum hasil Pareto.
- Menghubungkan event dengan knowledge dictionary.
- Membuat rekomendasi berdasarkan rule yang tersedia.

LLM tidak boleh:

- Mengarang event.
- Mengarang root cause.
- Mengubah nilai Pareto.
- Menggunakan unit di luar filter.
- Menggunakan periode di luar filter.
- Menyimpulkan penyebab yang tidak tersedia di database.

Contoh:

```text
Breakdown Database
Engine     42%
Hydraulic  23%
```

AI hanya boleh menginterpretasikan angka tersebut.

AI tidak boleh menambahkan:

```text
Operator salah mengoperasikan unit
```

apabila tidak ada data yang mendukung kesimpulan tersebut.

---

# 18. Struktur Intelligence yang Disarankan

```text
OMOS Core Data
      ↓
Operational Event
      ↓
MI_EVENT_FACT
      ↓
Attribute Mapping
      ↓
Negative Waterfall Detection
      ↓
Pareto Calculation
      ↓
Event Knowledge
      ↓
Smart Text Rule
      ↓
Mining Intelligence
```

---

# 19. Skalabilitas

Dengan arsitektur ini Mining Intelligence dapat dikembangkan ke atribut lain tanpa mengubah core engine.

Contoh pengembangan berikutnya:

```text
Fuel
Payload
Speed
Cycle Time
Rain
Road Condition
Operator Performance
Cost
SR
Hauling Distance
Queue
Match Factor
Fuel Ratio
Maintenance
Delay
Road Geometry
```

Cukup menambahkan:

```text
mi_attribute_config
+
mi_event_dictionary
+
mi_text_rule
```

tanpa perlu membuat algoritma Smart Text baru dari awal.

---

# 20. Kesimpulan Arsitektur

Struktur final:

```text
OMOS WATERFALL
      ↓
NEGATIVE ATTRIBUTE
      ↓
ATTRIBUTE ROUTER
 ┌────┼──────────────┐
PA    UA        PRODUCTIVITY
│     │              │
BD    STB          RITASE
│     │              │
└─────┼──────────────┘
      ↓
 MI_EVENT_FACT
      ↓
 PARETO ENGINE
      ↓
 EVENT DICTIONARY
      ↓
 SMART TEXT RULE
      ↓
 MINING INTELLIGENCE
```

Core design principle:

> **Data menentukan fakta, Pareto menentukan prioritas, Knowledge Dictionary memberikan konteks, dan Smart Text menjelaskan hasilnya kepada user.**

Dengan pola ini OMOS Mining Intelligence tetap:

- Data-driven
- Traceable
- Auditable
- Multi-project
- Multi-client
- Configurable
- Scalable
- Tidak bergantung pada tebakan AI
