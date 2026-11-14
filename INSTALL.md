# Panduan Instal & Update MIKROTAL

Panduan ini untuk versi terbaru yang memuat fitur RT/RW Net: pelanggan PPPoE, voucher isi ulang, isolir, topologi ODC/ODP dengan peta, dan Troubleshoot Jalur.

> **Versi terbaru ada di branch `claude/relaxed-johnson-3ibhie`** selama pull request-nya belum digabung ke `main`. Setelah digabung, ganti nama branch di perintah di bawah menjadi `main`.

## Yang dibutuhkan

| Kebutuhan | Keterangan |
|---|---|
| Komputer/server | Windows, Linux, atau macOS. Untuk dipakai sungguhan, harus menyala 24 jam dan bisa menjangkau IP MikroTik |
| Node.js | Versi **22.13 atau lebih baru** (unduh dari nodejs.org, pilih LTS) |
| Git | Untuk mengambil dan memperbarui kode |
| Internet | Saat instal (mengunduh paket) dan di browser pengguna untuk latar peta OpenStreetMap |

Cek versi yang terpasang:

```bash
node -v
```

```bash
git --version
```

---

## A. Instal baru

### 1. Ambil kode

```bash
git clone https://github.com/nezzconstruction-cloud/MIKROTAL.git
```

```bash
cd MIKROTAL
```

```bash
git checkout claude/relaxed-johnson-3ibhie
```

### 2. Buat file pengaturan `.env`

Linux/macOS:

```bash
cp .env.example .env
```

Windows (Command Prompt):

```bash
copy .env.example .env
```

Buka `.env` dengan editor teks, lalu ubah minimal dua baris ini **sebelum pertama kali menjalankan**:

```
APP_SECRET=isi-dengan-teks-acak-panjang-minimal-32-karakter
ADMIN_PASSWORD=password-admin-anda
```

- `APP_SECRET` dipakai untuk mengenkripsi password router. **Jangan diubah lagi setelah ada router tersimpan**, karena password router tidak akan bisa dibuka.
- `ADMIN_PASSWORD` hanya dipakai saat database masih kosong. Setelah itu, ganti password lewat menu **Akun saya**.
- `SEED_DEMO=true` membuat router simulasi dengan data contoh. Isi `false` bila tidak ingin data contoh.

### 3. Pasang paket dan build

```bash
npm install
```

```bash
npm run build
```

### 4. Jalankan

```bash
npm start
```

Buka `http://localhost:8080` di komputer yang sama, atau `http://IP-KOMPUTER:8080` dari perangkat lain di jaringan. Login dengan `admin` dan password yang Anda isi di `.env` (bawaan: `admin123`).

Aplikasi berjalan selama jendela terminal itu terbuka. Tekan `Ctrl+C` untuk menghentikan.

### 5. Setelah login pertama

1. **Router → Tambah router**: hubungkan MikroTik asli (lihat bagian *Menghubungkan MikroTik asli* di `README.md`).
2. **Pelanggan PPPoE → Paket & Harga**: buat paket yang menunjuk ke PPP profile di router.
3. **Pelanggan PPPoE → Pelanggan → Impor dari router**: tarik akun PPPoE yang sudah ada, lalu atur paket dan masa aktifnya.
4. **Topologi ODC / ODP**: catat ODC dan ODP beserta titik lokasinya, isi **Lokasi server**, lalu tempatkan tiap pelanggan di port ODP-nya.
5. **Pengaturan → PPPoE & isolir**: isi IP server MIKROTAL, simpan, lalu pasang aturan isolir.
6. Hapus **Demo Router (Simulasi)** bila sudah tidak diperlukan.

---

## B. Update dari versi sebelumnya

Database tidak perlu diubah manual: tabel dan kolom baru dibuat otomatis saat aplikasi dijalankan. Data lama (router, voucher hotspot, reseller, pengguna) tetap ada.

### 1. Hentikan aplikasi

Tekan `Ctrl+C` di terminal yang menjalankan `npm start` (atau hentikan layanannya bila memakai systemd).

### 2. Cadangkan data

Seluruh data ada di folder `data` (database `mikrotal.db`). Salin folder itu ke tempat aman.

Linux/macOS:

```bash
cp -r data data-backup-$(date +%Y%m%d)
```

Windows (Command Prompt):

```bash
xcopy data data-backup /E /I
```

### 3. Ambil kode terbaru

```bash
git fetch origin
```

```bash
git checkout claude/relaxed-johnson-3ibhie
```

```bash
git pull
```

### 4. Pasang paket dan build ulang

```bash
npm install
```

```bash
npm run build
```

### 5. Jalankan lagi

```bash
npm start
```

**Jangan ubah `.env`**, terutama `APP_SECRET`.

### 6. Setelah update

- Data contoh PPPoE (paket, ODC/ODP, pelanggan contoh) hanya dibuat pada instalasi baru. Pada instalasi yang di-update, mulai dari **Paket & Harga**, lalu **Impor dari router** di menu Pelanggan.
- Peran **Operator** sekarang bisa membuka menu pelanggan dan topologi. Reseller tidak.
- Bila perlu kembali ke versi lama: hentikan aplikasi, kembalikan folder `data` dari cadangan, `git checkout` ke versi sebelumnya, lalu `npm install`, `npm run build`, `npm start`. Database yang sudah dibuka versi baru jangan dipakai lagi oleh versi lama.

---

## C. Instal dengan Docker (alternatif untuk server/VPS)

```bash
git clone https://github.com/nezzconstruction-cloud/MIKROTAL.git
```

```bash
cd MIKROTAL
```

```bash
git checkout claude/relaxed-johnson-3ibhie
```

```bash
cp .env.example .env
```

Ubah `APP_SECRET` dan `ADMIN_PASSWORD` di `.env`, lalu:

```bash
docker compose up -d --build
```

Update pada instalasi Docker: cadangkan folder `data`, lalu

```bash
git pull
```

```bash
docker compose up -d --build
```

---

## D. Menjalankan otomatis saat server menyala (Linux, opsional)

Contoh layanan systemd. Sesuaikan `User` dan `WorkingDirectory` dengan lokasi instalasi Anda, simpan sebagai `/etc/systemd/system/mikrotal.service`:

```ini
[Unit]
Description=MIKROTAL
After=network-online.target
Wants=network-online.target

[Service]
User=mikrotal
WorkingDirectory=/opt/MIKROTAL
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now mikrotal
```

Melihat log:

```bash
journalctl -u mikrotal -f
```

---

## Masalah yang sering muncul

| Gejala | Penyebab dan solusi |
|---|---|
| `npm start` gagal dengan error `node:sqlite` | Node.js terlalu lama. Pasang versi 22.13 atau lebih baru |
| Halaman tidak bisa dibuka dari perangkat lain | Firewall komputer memblokir port 8080. Izinkan port itu, atau ganti `PORT` di `.env` |
| `EADDRINUSE` saat menjalankan | Port 8080 sudah dipakai aplikasi lain atau MIKROTAL masih berjalan. Hentikan yang lama atau ganti `PORT` |
| Router "password salah" setelah pindah server | `APP_SECRET` berbeda dari instalasi lama. Pakai `APP_SECRET` yang sama, atau isi ulang password router di menu Router |
| Tombol **Lokasi saya** tidak bekerja | Browser hanya memberi lokasi lewat HTTPS atau `localhost`. Ketik koordinat, tempel tautan Google Maps, atau klik di peta |
| Latar peta kosong (abu-abu) | Browser tidak bisa menjangkau `tile.openstreetmap.org`. Titik dan garis tetap tampil |
| Pelanggan terisolir melihat halaman login admin | **IP server MIKROTAL** di Pengaturan belum diisi, atau trafik isolir melewati masquerade sehingga IP asli pelanggan tidak terlihat |
