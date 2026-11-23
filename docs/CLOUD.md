# MIKROTAL Cloud: layanan berlangganan

Dokumen ini menjelaskan cara MIKROTAL dijalankan sebagai layanan online berlangganan: arsitektur, **aturan dan cara koneksi router**, aturan langganan dan pembayaran, serta langkah memasang di server.

MIKROTAL tetap bisa dipasang sendiri seperti biasa (lihat [INSTALL.md](../INSTALL.md)). Mode cloud aktif bila `MIKROTAL_MODE=cloud`.

---

## 1. Gambaran

```
                       Internet
   Pemilik usaha ──https──►  mikrotal.id            (daftar, harga, admin platform)
                  ──https──►  rtrw-jaya.mikrotal.id  (aplikasi MIKROTAL milik satu pelanggan)
                                   │
                         ┌─────────┴──────────┐
                         │  Server aplikasi   │  Caddy (HTTPS) + MIKROTAL Cloud (satu proses)
                         │  (VPS Linux)       │  data/platform  : langganan semua pelanggan
                         │                    │  data/tenants/* : data usaha tiap pelanggan
                         └─────────┬──────────┘
                                   │ WireGuard pribadi (10.199.0.0/30)
                         ┌─────────┴──────────┐
                         │  MikroTik CHR      │  pusat VPN: WireGuard, L2TP/IPsec, SSTP
                         │  vpn.mikrotal.id   │  jaringan tunnel 10.200.0.0/16
                         └─────────┬──────────┘
                VPN keluar dari    │    router pelanggan (tanpa IP publik)
          ┌──────────────┬─────────┴──────┬──────────────┐
      Router A (v7)  Router B (v6)   Router C (v7)   ...
      10.200.1.1     10.200.1.2      10.200.1.3
```

- **Satu proses melayani semua pelanggan.** Domain utama menampilkan halaman daftar dan panel admin platform. Setiap pelanggan mendapat subdomain sendiri (`<alamat>.mikrotal.id`) berisi aplikasi MIKROTAL lengkap.
- **Data tiap pelanggan terpisah:** database sendiri (`data/tenants/<alamat>/mikrotal.db`), kunci login (JWT) sendiri, dan kunci enkripsi password router sendiri. Semua kunci diturunkan dari `APP_SECRET` server, jadi token login pelanggan A tidak berlaku di pelanggan B.
- **Router pelanggan tidak perlu IP publik.** Router membuat sambungan VPN keluar ke CHR. MIKROTAL lalu mengatur router lewat API melalui tunnel itu.

---

## 2. Aturan dan cara koneksi router

### 2.1 Langkah pelanggan

1. Daftar di `https://mikrotal.id`, pilih alamat (mis. `rtrw-jaya`).
2. Login di `https://rtrw-jaya.mikrotal.id`, buka **Langganan & VPN → Hubungkan Router (VPN)**.
3. Klik **Hubungkan router**, isi nama, pilih versi RouterOS:

   | Versi router | Jenis VPN | Port yang harus bisa keluar dari router |
   |---|---|---|
   | RouterOS v7 | WireGuard (disarankan) | UDP 13231 |
   | RouterOS v6 | L2TP/IPsec | UDP 500, 4500, 1701 |
   | v6 atau v7, bila L2TP diblokir | SSTP | TCP 443 |

4. Salin skrip, tempel di **New Terminal** Winbox/WebFig, tekan Enter.
5. Dalam 1 menit status VPN menjadi **Tersambung** dan router muncul online di MIKROTAL. Router langsung terdaftar dengan IP tunnel-nya; tidak perlu menambah router manual.

### 2.2 Yang dilakukan skrip di router

Skrip berupa satu blok `{ ... }`, aman dijalankan ulang (konfigurasi lama berkomentar `MIKROTAL Cloud` dihapus dulu), dan hanya membuat:

| Item | Isi |
|---|---|
| Interface VPN | `mikrotal-cloud` (WireGuard, L2TP client, atau SSTP client), **tanpa default route** |
| IP tunnel | Satu alamat /32, mis. `10.200.1.7`, dengan lawan `10.200.0.1` |
| Rule firewall | `input` dari `10.200.0.1` lewat `mikrotal-cloud` diterima (ditaruh paling atas) |
| User API | `mtcloud-xxxxx`, group full, **hanya bisa login dari 10.200.0.1** |
| Service API | Diaktifkan. Bila sebelumnya dibatasi alamat tertentu, `10.200.0.1/32` ditambahkan ke daftar (bukan diganti) |

Skrip **tidak** mengubah internet pelanggan, NAT, DNS, hotspot, atau PPPoE. Lalu lintas internet pelanggan tidak lewat server MIKROTAL. Untuk berhenti: putuskan di halaman VPN, lalu hapus semua item berkomentar `MIKROTAL Cloud` di router.

### 2.3 Aturan jaringan (keamanan)

1. **Arah koneksi:** router → CHR (keluar). Tidak ada port yang dibuka di router pelanggan ke internet.
2. **Satu IP tunnel per router**, dari `10.200.0.0/16`. Blok `10.200.0.x` untuk server; pelanggan mulai `10.200.1.1`.
3. **MIKROTAL tampil sebagai 10.200.0.1.** CHR melakukan src-nat untuk semua lalu lintas dari server aplikasi ke jaringan tunnel, sehingga user API router cukup mengizinkan satu alamat.
4. **Isolasi antar pelanggan di CHR:** lalu lintas dari tunnel ke tunnel ditolak (`forward drop`), dan router pelanggan tidak bisa mengakses layanan CHR (`input drop`, kecuali ping).
5. **Isolasi di aplikasi:** aplikasi satu pelanggan hanya boleh tersambung ke:
   - IP tunnel **miliknya sendiri**, atau
   - **IP publik** (langsung, atau nama domain/DDNS yang mengarah ke IP publik).

   Alamat lokal/internal (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64.x, IPv6 lokal) dan IP tunnel pelanggan lain ditolak. Nama domain di-resolve setiap kali tersambung, dan IP hasil resolve itulah yang dipakai, jadi DNS tidak bisa diarahkan ke jaringan internal server.
6. **Kredensial:** password API dan kunci WireGuard router dibuat acak, disimpan terenkripsi di database platform, dan hanya ditampilkan di skrip kepada pemilik akun yang login.
7. **Kuota router:** jumlah router asli dan jumlah koneksi VPN mengikuti paket. Satu router simulasi (untuk mencoba fitur) tidak dihitung.

### 2.4 Alternatif tanpa VPN

Router yang punya **IP publik** boleh ditambahkan langsung di menu Router dengan IP publik atau nama DDNS (mis. `xxxx.sn.mynetname.net`). Dalam hal ini pelanggan wajib membatasi service API di routernya hanya untuk IP server MIKROTAL dan sebaiknya memakai API-SSL (8729). Cara VPN tetap disarankan.

### 2.5 Batasan di mode cloud

- **Halaman isolir PPPoE** di instalasi sendiri bekerja dengan dst-nat dari router ke server MIKROTAL di LAN. Di cloud, arahkan pelanggan terisolir dengan web proxy RouterOS (`/ip proxy access ... action=redirect action-data=<alamat>.mikrotal.id/isolir`) atau walled garden hotspot ke `https://<alamat>.mikrotal.id/isolir`.
- **Portal login hotspot** dipasang router dengan `/tool fetch` dari `https://<alamat>.mikrotal.id`, atau diunggah lewat FTP melalui tunnel bila fetch gagal.

---

## 3. Aturan langganan dan pembayaran

### 3.1 Paket

Paket diatur admin platform (menu **Paket**). Bawaan:

| Paket | Harga/bulan | Router |
|---|---|---|
| Starter | Rp 50.000 | 1 |
| Bisnis | Rp 100.000 | 3 |
| Pro | Rp 200.000 | 10 |

Pendaftar baru mendapat **uji coba 14 hari, 1 router** (bisa diubah di Pengaturan).

### 3.2 Tahap langganan

| Tahap | Kapan | Yang bisa dipakai |
|---|---|---|
| Uji coba / Aktif | Sebelum tanggal berakhir | Semua fitur |
| Masa tenggang | 3 hari setelah berakhir (bisa diubah) | Semua fitur, dengan peringatan |
| Berhenti | Setelah masa tenggang | Hanya login dan halaman **Langganan & VPN**. Sinkronisasi voucher, isolir otomatis, monitoring, dan backup terjadwal **berhenti**. Data tidak dihapus. |
| Dihentikan admin | Diatur admin (mis. pelanggaran) | Sama seperti Berhenti |

Pengingat dikirim ke notifikasi aplikasi pelanggan (dan Telegram bila diatur) pada H-7, H-3, H-1, saat masa tenggang, dan saat berhenti. Router pelanggan tetap jalan seperti biasa; hanya pengaturan otomatis dari MIKROTAL yang berhenti. Akibatnya, selama berhenti voucher yang habis tidak dinonaktifkan dan pelanggan PPPoE tidak diisolir otomatis.

### 3.3 Transfer manual

1. Pelanggan memilih paket dan lama (1, 3, 6, atau 12 bulan), lalu **Buat tagihan**.
2. Tagihan berisi nominal + **3 digit kode unik** (mis. Rp 100.265) dan daftar rekening. Tagihan yang tidak dibayar dibatalkan otomatis setelah 3 hari.
3. Pelanggan transfer tepat sesuai nominal, lalu **unggah bukti** (JPG/PNG/WEBP/PDF, maks 2 MB; isi berkas diperiksa).
4. Admin platform membuka **Pembayaran → Perlu diperiksa**, mencocokkan nominal dengan mutasi rekening, lalu **Konfirmasi lunas** atau **Tolak** dengan alasan.
5. Setelah dikonfirmasi: paket diganti sesuai tagihan, masa aktif ditambah sejak akhir masa lama (atau sejak hari ini bila sudah habis; sisa uji coba tidak ditambahkan), dan pelanggan mendapat notifikasi.

Payment gateway (Tripay/Midtrans/Xendit) bisa ditambahkan kemudian tanpa mengubah alur ini: cukup panggil konfirmasi otomatis saat callback pembayaran diterima.

### 3.4 Tugas admin platform

- **Pelanggan:** lihat status, tambah hari (kompensasi atau pembayaran di luar sistem), ganti paket, hentikan/aktifkan, reset password pemilik, hapus akun (VPN diputus, data tetap di `data/tenants/<alamat>`).
- **Paket:** ubah harga dan batas router. Harga baru berlaku untuk tagihan berikutnya.
- **Pengaturan:** nama layanan, kontak bantuan, rekening, lama uji coba, masa tenggang, buka/tutup pendaftaran, dan server VPN (CHR).

---

## 4. Memasang di server

### 4.1 Kebutuhan

| Komponen | Saran |
|---|---|
| Server aplikasi | VPS Linux (Ubuntu 22.04/24.04), IP publik. 2 vCPU / 4 GB cukup untuk ±100 pelanggan |
| CHR | VPS kecil terpisah (1 vCPU / 512 MB) dengan image MikroTik CHR, IP publik. Lisensi **P1** (± US$45 sekali bayar). Lisensi gratis dibatasi 1 Mbps per interface, terlalu lambat untuk banyak router |
| Domain | Mis. `mikrotal.id` |
| Docker | Docker Engine + Compose plugin di server aplikasi |

CHR juga bisa dijalankan sebagai VM (KVM) di server aplikasi bila VPS mendukung virtualisasi bertingkat. Prinsipnya sama: server aplikasi harus punya rute ke `10.200.0.0/16` lewat CHR.

### 4.2 DNS

| Nama | Tipe | Mengarah ke |
|---|---|---|
| `mikrotal.id` | A | IP server aplikasi |
| `*.mikrotal.id` | A | IP server aplikasi |
| `vpn.mikrotal.id` | A | IP CHR |

### 4.3 Langkah

1. **Siapkan CHR dan sambungkan ke server aplikasi:** ikuti [deploy/cloud/chr-link.md](../deploy/cloud/chr-link.md).
2. **Jalankan aplikasi di server aplikasi:**

   ```bash
   git clone https://github.com/nezzconstruction-cloud/MIKROTAL.git
   ```

   ```bash
   cd MIKROTAL/deploy/cloud
   ```

   ```bash
   cp env.example .env
   ```

   Isi `.env` (`CLOUD_BASE_DOMAIN`, `APP_SECRET` dari `openssl rand -hex 32`, `PLATFORM_ADMIN_PASSWORD`, `ACME_EMAIL`), lalu:

   ```bash
   docker compose up -d --build
   ```

   Caddy menerbitkan sertifikat HTTPS otomatis untuk domain utama dan setiap subdomain pelanggan saat pertama dibuka (hanya untuk alamat yang terdaftar). Port 80 dan 443 server harus terbuka.
3. **Atur platform:** buka `https://mikrotal.id/admin`, login dengan `PLATFORM_ADMIN_USERNAME`/`PLATFORM_ADMIN_PASSWORD`, lalu di **Pengaturan & VPN**:
   - isi rekening transfer dan kontak bantuan,
   - isi data CHR, klik **Uji koneksi** lalu **Siapkan CHR**.

   "Siapkan CHR" membuat (dan aman diulang): interface WireGuard `mikrotal-wg` + IP `10.200.0.1/16`, profil PPP `mikrotal-cloud`, server L2TP dengan IPsec wajib (secret dibuat acak), server SSTP (bila sertifikat sudah ada), rule isolasi antar pelanggan, dan src-nat dari server aplikasi.
4. **Coba sendiri:** daftar sebagai pelanggan di halaman depan, hubungkan satu router uji, lalu buat dan konfirmasi satu tagihan.

### 4.4 Cadangan dan update

- Cadangkan seluruh folder `deploy/cloud/data` setiap hari (berisi `platform/` dan `tenants/`). Simpan juga `.env`: tanpa `APP_SECRET` yang sama, password router dan kunci VPN di cadangan tidak bisa dibuka.
- Update:

  ```bash
  git pull
  ```

  ```bash
  docker compose up -d --build
  ```

  Migrasi database pelanggan dan platform berjalan otomatis saat aplikasi menyala.

### 4.5 Uji lokal tanpa domain

```bash
MIKROTAL_MODE=cloud CLOUD_BASE_DOMAIN=localhost CLOUD_PUBLIC_SCHEME=http npm start
```

Buka `http://localhost:8080` (halaman daftar & `/admin`, login `admin`/`admin123`) dan `http://<alamat>.localhost:8080` untuk pelanggan. Untuk mencoba VPN tanpa CHR, aktifkan **CHR simulasi** di Pengaturan & VPN.

---

## 5. Variabel lingkungan mode cloud

| Variabel | Keterangan |
|---|---|
| `MIKROTAL_MODE` | `cloud` untuk mode berlangganan |
| `CLOUD_BASE_DOMAIN` | Domain utama, mis. `mikrotal.id` |
| `CLOUD_PUBLIC_SCHEME` | `https` (bawaan) atau `http` untuk uji lokal |
| `CLOUD_PUBLIC_PORT` | Port di URL publik bila bukan 80/443 |
| `APP_SECRET` | Rahasia utama, minimal 32 karakter. Jangan diganti setelah ada pelanggan |
| `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` | Akun admin platform pertama |
| `DATA_DIR` | Folder data (bawaan `data`) |

Saat `NODE_ENV=production`, aplikasi menolak menyala bila `APP_SECRET`, password admin platform, atau domain masih bawaan.
