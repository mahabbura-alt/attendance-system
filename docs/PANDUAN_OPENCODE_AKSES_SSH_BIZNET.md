# Panduan OpenCode — Akses dan Troubleshooting SSH Server Biznet OMOS

Status: **OPERASIONAL / SECURITY-SENSITIVE**  
Tanggal pembaruan: **2026-10-07 WIB**  
Target pembaca: **OpenCode dan agen coding OMOS**  
Repository authoritative: `D:\OneDrive\Desktop\OMOS`

## 1. Tujuan

Panduan ini mencegah agen menebak endpoint, username, key, lokasi project,
atau langkah pemulihan akses SSH server OMOS.

Panduan ini tidak menyimpan password, token, passphrase, atau isi private key.
Secret tetap dibaca dari sumber credential lokal yang ditentukan owner.

## 2. Konfigurasi yang Sudah Dikonfirmasi

| Parameter | Nilai authoritative |
|---|---|
| Provider | Biznet Gio |
| Public IPv4 | `103.58.101.240` |
| SSH username | `adminbiznet` |
| Default SSH port | `22` |
| Server project root | `/opt/omos` |
| Local project root | `D:\OneDrive\Desktop\OMOS` |
| Local credential authority | `D:\OneDrive\Desktop\OMOS\biznet server.txt` |
| SSH key name yang pernah digunakan | `omos-key.pem` |

Nilai host dan username bukan secret. Isi private key, password, passphrase,
token, serta credential database adalah secret dan tidak boleh disalin ke file
Markdown, source code, log, prompt publik, commit, atau chat output.

## 3. Aturan Wajib untuk Agen

1. Baca `AGENTS.md` dan `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md` sebelum
   melakukan pekerjaan deployment atau server.
2. Baca `D:\OneDrive\Desktop\OMOS\biznet server.txt` hanya untuk memperoleh
   credential yang diperlukan.
3. Jangan pernah menampilkan isi file credential dengan `type`, `cat`,
   `Get-Content`, logging, atau output tool yang terlihat pengguna.
4. Jangan menyalin isi private key atau password ke repository.
5. Jangan mengubah firewall, SSH config, Fail2Ban, Docker, database, atau
   deployment sebelum target dan dampaknya terverifikasi.
6. Gunakan read-only checks terlebih dahulu.
7. Jangan memakai `StrictHostKeyChecking=no` sebagai default.
8. Jangan menghapus entri `known_hosts` kecuali host key benar-benar berubah dan
   fingerprint baru telah diverifikasi melalui Biznet Console.
9. Jangan membuka port 22 ke `0.0.0.0/0` secara permanen. Batasi ke public IP
   admin bila firewall Biznet mendukungnya.
10. Jangan menyatakan server pulih sebelum koneksi SSH, health aplikasi, dan
    container diperiksa.

## 4. Menyiapkan Credential Tanpa Menyalin Secret

### 4.1 Temukan key dari sumber authority

Agen harus memperoleh path key dari:

```text
D:\OneDrive\Desktop\OMOS\biznet server.txt
```

Jika file hanya menyebut `omos-key.pem`, resolve path secara lokal tanpa
menampilkan isi key. Contoh PowerShell untuk memeriksa keberadaan file:

```powershell
Test-Path -LiteralPath "D:\OneDrive\Desktop\OMOS\omos-key.pem"
```

Jika hasil `False`, jangan menebak lokasi. Cari nama file secara terbatas pada
folder project atau lokasi yang disebut credential authority, tanpa membaca
isinya:

```powershell
Get-ChildItem -LiteralPath "D:\OneDrive\Desktop\OMOS" `
  -Filter "omos-key.pem" -File -Recurse -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
```

### 4.2 Variabel sesi PowerShell

Gunakan variabel hanya dalam sesi terminal saat ini:

```powershell
$omosBiznetHost = "103.58.101.240"
$omosBiznetUser = "adminbiznet"
$omosSshKey = "D:\OneDrive\Desktop\OMOS\omos-key.pem"
```

Jangan memakai `$HOME`, `$home`, atau `$CODEX_HOME` sebagai variabel kerja.

## 5. Preflight dari Komputer Lokal

Jalankan dari PowerShell lokal, bukan dari Biznet Console.

### 5.1 Pastikan server dan port dapat dijangkau

```powershell
Test-NetConnection 103.58.101.240 -Port 22
Test-NetConnection 103.58.101.240 -Port 80
Test-NetConnection 103.58.101.240 -Port 443
```

Interpretasi:

| Hasil | Makna utama |
|---|---|
| Ping sukses, 80/443 sukses, 22 timeout | server/web hidup; SSH diblokir atau tidak reachable |
| Port 22 `TcpTestSucceeded=True` | jalur TCP siap; lanjut autentikasi |
| Port 22 `Connection refused` | host tercapai tetapi tidak ada listener atau reject aktif |
| Semua port timeout | VM mati, public IP/routing berubah, atau firewall luas |

### 5.2 Cek public IP admin

Jika firewall atau Fail2Ban memakai allowlist, dapatkan public IP saat ini:

```powershell
(Invoke-RestMethod -Uri "https://api.ipify.org").Trim()
```

Jangan menganggap IP lama masih berlaku karena koneksi internet admin dapat
menggunakan IP dinamis.

## 6. Perintah SSH yang Benar

PowerShell tidak menggunakan backslash untuk escape `@`. Jangan menulis
`adminbiznet\@103.58.101.240`.

### 6.1 Tes autentikasi non-interaktif

```powershell
ssh -i $omosSshKey `
  -o IdentitiesOnly=yes `
  -o BatchMode=yes `
  -o ConnectTimeout=10 `
  adminbiznet@103.58.101.240 `
  "echo SSH_OK; hostname; whoami"
```

### 6.2 Pemeriksaan server OMOS

Setelah SSH berhasil:

```powershell
ssh -i $omosSshKey `
  -o IdentitiesOnly=yes `
  -o BatchMode=yes `
  -o ConnectTimeout=10 `
  adminbiznet@103.58.101.240 `
  "echo SSH_OK; hostname; df -h /opt/omos 2>/dev/null | tail -1; docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | head -5"
```

### 6.3 Debug autentikasi

Gunakan hanya setelah port 22 terbukti terbuka:

```powershell
ssh -vvv -i $omosSshKey -o IdentitiesOnly=yes `
  adminbiznet@103.58.101.240 "true"
```

Sebelum membagikan output `-vvv`, hapus informasi sensitif dan path personal.

## 7. Diagnosis Berdasarkan Error

### 7.1 `Connection timed out`

Koneksi gagal sebelum autentikasi. Private key dan password belum dinilai.

Kemungkinan:

1. inbound port 22 diblokir firewall Biznet;
2. UFW/nftables/iptables melakukan DROP;
3. Fail2Ban memblokir public IP admin;
4. SSH daemon tidak listening dan firewall melakukan silent drop;
5. SSH dipindahkan ke port lain;
6. public IP/routing VM berubah.

### 7.2 `Connection refused`

Host dapat dicapai, tetapi port tidak menerima koneksi. Periksa service dan
listener SSH.

### 7.3 `Permission denied (publickey)`

TCP dan SSH daemon normal. Periksa username, key, permission key,
`authorized_keys`, dan algoritma key. Jangan mengubah firewall untuk error ini.

### 7.4 `Host key verification failed`

Jangan langsung menghapus known host. Cocokkan fingerprint melalui Biznet
Console:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Hanya setelah fingerprint terverifikasi, perbarui entri lokal secara spesifik.

## 8. Pemeriksaan melalui Biznet Open Console

Gunakan Open Console ketika port 22 tidak dapat dijangkau.

### 8.1 Status SSH

```bash
sudo systemctl is-active ssh
sudo systemctl status ssh --no-pager
sudo ss -lntp | grep ':22'
sudo journalctl -u ssh -n 100 --no-pager
```

Kondisi normal:

```text
active
LISTEN ... 0.0.0.0:22
LISTEN ... [::]:22
```

Jika SSH tidak aktif:

```bash
sudo systemctl enable --now ssh
sudo systemctl restart ssh
```

Setelah restart, cek kembali status dan listener. Jangan menganggap restart
berhasil tanpa verifikasi.

### 8.2 Validasi konfigurasi SSH

```bash
sudo sshd -t
sudo sshd -T | grep -E '^(port|listenaddress|passwordauthentication|pubkeyauthentication) '
```

`sudo sshd -t` harus selesai tanpa output dan exit code 0.

Jika port yang tampil bukan 22, gunakan `ssh -p <port>` dan pastikan firewall
mengizinkan port tersebut. Jangan mengganti port tanpa change plan.

### 8.3 UFW

```bash
sudo ufw status verbose
```

Jika UFW aktif dan port 22 belum diizinkan:

```bash
sudo ufw allow 22/tcp
sudo ufw reload
sudo ufw status numbered
```

Batasi source IP jika kebijakan site mengharuskannya.

### 8.4 nftables dan iptables

Read-only checks:

```bash
sudo nft list ruleset
sudo iptables -S
sudo iptables -L -n -v
```

Jangan flush ruleset dan jangan menjalankan `iptables -F`.

## 9. Fail2Ban

### 9.1 Cek jail SSH

```bash
sudo fail2ban-client status sshd
```

Contoh kondisi tanpa blokir aktif:

```text
Currently banned: 0
Banned IP list:
```

`Total banned` adalah riwayat total, bukan jumlah IP yang sedang diblokir.

### 9.2 Unban yang benar

Hanya lakukan jika public IP admin muncul pada `Banned IP list`:

```bash
sudo fail2ban-client set sshd unbanip <PUBLIC_IP_ADMIN>
sudo fail2ban-client status sshd
```

Sintaks berikut salah:

```text
fail2ban-client unban <ip>
```

### 9.3 Jangan whitelist IP dinamis permanen

Tambahkan `ignoreip` hanya jika IP admin benar-benar statis dan owner telah
menyetujui. IP dinamis dapat berpindah ke pihak lain.

## 10. Firewall Biznet

Jika kondisi berikut terpenuhi:

- service SSH `active`;
- `ss` menunjukkan listener pada public interface;
- Fail2Ban tidak memblokir;
- UFW/nftables/iptables tidak memblokir;
- tetapi `Test-NetConnection ... -Port 22` tetap gagal;

maka periksa firewall/security rule di panel Biznet:

| Field | Nilai |
|---|---|
| Direction | Inbound |
| Protocol | TCP |
| Destination port | 22 atau port SSH hasil `sshd -T` |
| Source | Public IP admin saat ini |
| Action | Allow |

Jangan membuka akses global permanen. Jika akses sementara global benar-benar
diperlukan untuk recovery, owner harus menyetujui dan rule harus dipersempit
kembali segera setelah akses pulih.

## 11. Membuktikan Lokasi Blokir

Di Biznet Console jalankan:

```bash
sudo journalctl -u ssh -f
```

Lalu coba SSH dari komputer lokal.

- Jika log SSH muncul: trafik mencapai daemon; fokus pada autentikasi atau
  kebijakan sshd.
- Jika tidak ada log: trafik berhenti sebelum daemon; fokus pada firewall,
  Fail2Ban, network ACL, routing, atau port yang salah.

Untuk diagnosis jaringan yang lebih pasti dan singkat:

```bash
sudo timeout 30 tcpdump -ni any tcp port 22
```

Selama 30 detik tersebut lakukan satu percobaan SSH. Jangan menjalankan capture
tanpa batas waktu dan jangan menyimpan packet capture yang tidak diperlukan.

## 12. Verifikasi Setelah Akses Pulih

Jalankan dari komputer lokal:

```powershell
Test-NetConnection 103.58.101.240 -Port 22

ssh -i $omosSshKey `
  -o IdentitiesOnly=yes `
  -o BatchMode=yes `
  -o ConnectTimeout=10 `
  adminbiznet@103.58.101.240 `
  "echo SSH_OK; hostname; whoami; uptime"
```

Lalu verifikasi OMOS secara read-only:

```powershell
ssh -i $omosSshKey -o IdentitiesOnly=yes `
  adminbiznet@103.58.101.240 `
  "df -h /opt/omos; docker ps --format '{{.Names}} {{.Image}} {{.Status}}'; curl -fsS http://127.0.0.1/health"
```

Expected:

- `TcpTestSucceeded: True`;
- output `SSH_OK`;
- `whoami` adalah `adminbiznet`;
- filesystem `/opt/omos` tersedia;
- container OMOS berstatus healthy/running;
- health endpoint sukses.

## 13. Decision Tree Singkat

```text
Port 22 reachable?
├─ Tidak
│  ├─ VM/web juga mati → cek VM, IP, routing Biznet
│  └─ Web hidup
│     ├─ ssh inactive/tidak listen → pulihkan ssh service
│     ├─ IP ada di Fail2Ban → unban IP yang tepat
│     ├─ firewall OS drop → perbaiki rule minimal
│     └─ OS normal → perbaiki inbound rule Biznet
└─ Ya
   ├─ Permission denied → user/key/authorized_keys
   ├─ Host key failed → verifikasi fingerprint
   └─ Login berhasil → cek /opt/omos, Docker, dan health
```

## 14. Laporan yang Wajib Diberikan Agen

Setelah diagnosis, agen harus melaporkan tanpa menampilkan secret:

1. IP/host dan port yang diuji.
2. Hasil TCP port 22, 80, dan 443.
3. Status service SSH dan listener.
4. Status Fail2Ban saat ini, bukan hanya total historis.
5. Status firewall OS dan firewall Biznet.
6. Perubahan yang dilakukan, jika ada.
7. Hasil verifikasi SSH setelah perbaikan.
8. Status Docker dan `/health` OMOS.
9. Risiko/limitasi yang masih tersisa.

## 15. Larangan Operasional

Jangan menjalankan:

```text
iptables -F
nft flush ruleset
ufw disable
rm -rf
docker system prune -a
docker volume prune
```

Jangan memodifikasi `authorized_keys`, mengganti password, merotasi key,
menonaktifkan Fail2Ban, atau membuka firewall global tanpa persetujuan eksplisit
owner dan rollback plan.

