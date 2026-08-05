# Keamanan dan Privasi Data Biometrik

Data foto wajah, lokasi, dan absensi adalah data pribadi sensitif. Sebelum digunakan secara operasional:

1. Dapatkan dasar hukum/persetujuan dan beri pemberitahuan yang jelas kepada karyawan tentang tujuan pemrosesan.
2. Tetapkan masa retensi untuk foto referensi, foto absensi, log, dan backup; hapus atau anonimisasi saat berakhir.
3. Terapkan akses berbasis peran, MFA untuk admin infrastruktur, serta audit akses ke PostgreSQL dan MinIO.
4. Rotasi segera seluruh secret yang pernah tersimpan dalam arsip lama: `JWT_SECRET`, kredensial PostgreSQL, MinIO, dan API key CompreFace.
5. Gunakan HTTPS di semua jalur. Jangan mencatat token, password, foto, atau koordinat presisi di log aplikasi.
6. Tinjau ambang kecocokan wajah dan lakukan uji false-accept/false-reject dengan data yang disetujui sebelum kebijakan absensi diberlakukan.

Implementasi liveness berbasis kedipan hanya mengurangi spoofing sederhana; ini bukan jaminan anti-spoofing tingkat tinggi. Risiko tersebut harus diterima secara eksplisit atau dimitigasi dengan solusi liveness yang lebih kuat.
