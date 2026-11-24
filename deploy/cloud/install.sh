#!/usr/bin/env bash
# =============================================================================
#  Pemasang MIKROTAL Cloud untuk VPS Ubuntu/Debian.
#
#  Jalankan sebagai root di VPS:
#    curl -fsSL https://raw.githubusercontent.com/nezzconstruction-cloud/MIKROTAL/main/deploy/cloud/install.sh -o install.sh
#    bash install.sh
#
#  Aman dijalankan ulang: .env (termasuk APP_SECRET) yang sudah ada TIDAK diganti,
#  kode diperbarui, lalu aplikasi dibangun dan dinyalakan ulang.
#  Skrip tidak mengubah SSH dan tidak menyalakan firewall yang sedang mati.
# =============================================================================
set -euo pipefail

REPO_URL="${MIKROTAL_REPO:-https://github.com/nezzconstruction-cloud/MIKROTAL.git}"
BRANCH="${MIKROTAL_BRANCH:-main}"
DIR="${MIKROTAL_DIR:-/opt/mikrotal}"
APP="$DIR/deploy/cloud"

info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2
  exit 1
}
ask() { # ask "Pertanyaan" "bawaan" -> jawaban (dibaca dari terminal, juga saat skrip dipipe)
  local q="$1" def="${2:-}" ans=""
  if [ -r /dev/tty ]; then
    read -r -p "$q${def:+ [$def]}: " ans </dev/tty || true
  fi
  printf '%s' "${ans:-$def}"
}

[ "$(id -u)" = 0 ] || fail "Jalankan sebagai root (sudo -i lalu ulangi)."
. /etc/os-release 2>/dev/null || true
case "${ID:-}${ID_LIKE:-}" in
  *debian* | *ubuntu*) ;;
  *) fail "Skrip ini untuk Ubuntu/Debian. Sistem Anda: ${PRETTY_NAME:-tidak dikenal}" ;;
esac

# ---------------------------------------------------------------- 1. paket dasar
info "Memasang paket dasar (git, curl, openssl, wireguard-tools)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl iproute2 wireguard-tools >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  info "Memasang Docker..."
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin tidak tersedia. Pasang paket docker-compose-plugin lalu ulangi."
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------- 2. kode
if [ -d "$DIR/.git" ]; then
  info "Memperbarui kode di $DIR (cabang $BRANCH)..."
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  info "Mengambil kode ke $DIR (cabang $BRANCH)..."
  git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

# ---------------------------------------------------------------- 3. port 80/443
busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v -e caddy -e docker-proxy || true)
if [ -n "$busy" ]; then
  warn "Port 80/443 sudah dipakai program lain:"
  echo "$busy"
  fail "Hentikan program itu (mis. systemctl disable --now nginx apache2) lalu jalankan skrip ini lagi."
fi

# ---------------------------------------------------------------- 4. .env
PUBLIC_IP=$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
if [ -f "$APP/.env" ]; then
  info "Memakai $APP/.env yang sudah ada (APP_SECRET tidak diganti)."
else
  echo
  info "Pengaturan awal"
  echo "    Domain utama: halaman daftar & admin di https://DOMAIN, pelanggan di https://<alamat>.DOMAIN."
  echo "    Arahkan DNS  DOMAIN  dan  *.DOMAIN  (A record) ke $PUBLIC_IP sebelum melanjutkan."
  echo "    Belum punya domain? Tekan Enter untuk memakai domain uji gratis berbasis IP (sslip.io)."
  DEFAULT_DOMAIN="$(echo "$PUBLIC_IP" | tr . -).sslip.io"
  DOMAIN=$(ask "Domain utama" "$DEFAULT_DOMAIN")
  DOMAIN=$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##')
  EMAIL=$(ask "Email untuk sertifikat HTTPS (Let's Encrypt)" "admin@$DOMAIN")
  ADMIN_USER=$(ask "Username admin platform" "admin")
  ADMIN_PASS=""
  while [ "${#ADMIN_PASS}" -lt 10 ]; do
    if [ -r /dev/tty ]; then
      read -r -s -p "Password admin platform (min 10 karakter, kosong = dibuat acak): " ADMIN_PASS </dev/tty || true
      echo
    fi
    if [ -z "$ADMIN_PASS" ]; then
      ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
      GENERATED_PASS=1
    fi
    [ "${#ADMIN_PASS}" -ge 10 ] || warn "Terlalu pendek, ulangi."
  done
  umask 077
  cat >"$APP/.env" <<EOF
CLOUD_BASE_DOMAIN=$DOMAIN
CLOUD_PUBLIC_SCHEME=https
APP_SECRET=$(openssl rand -hex 32)
PLATFORM_ADMIN_USERNAME=$ADMIN_USER
PLATFORM_ADMIN_PASSWORD=$ADMIN_PASS
ACME_EMAIL=$EMAIL
LOG_LEVEL=info
EOF
  umask 022
  info "Tersimpan di $APP/.env (simpan salinannya: tanpa APP_SECRET yang sama, data tidak bisa dibuka)."
fi
DOMAIN=$(grep -E '^CLOUD_BASE_DOMAIN=' "$APP/.env" | cut -d= -f2-)

# ---------------------------------------------------------------- 5. firewall (hanya bila sudah aktif)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  info "ufw aktif: membuka port 80 dan 443/tcp..."
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  info "firewalld aktif: membuka http dan https..."
  firewall-cmd -q --permanent --add-service=http --add-service=https && firewall-cmd -q --reload
fi

# ---------------------------------------------------------------- 6. jalankan
info "Membangun dan menyalakan MIKROTAL Cloud (pertama kali bisa 3-10 menit)..."
cd "$APP"
docker compose up -d --build

info "Menunggu aplikasi siap..."
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
[ -n "$ok" ] || {
  docker compose logs --tail 50 mikrotal
  fail "Aplikasi belum merespons. Lihat log di atas."
}

# ---------------------------------------------------------------- 7. ringkasan
RESOLVED=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
KVM="tidak"
[ -e /dev/kvm ] && KVM="ya"
echo
info "MIKROTAL Cloud berjalan."
echo "    Halaman daftar : https://$DOMAIN"
echo "    Panel admin    : https://$DOMAIN/admin"
echo "    Username admin : $(grep -E '^PLATFORM_ADMIN_USERNAME=' .env | cut -d= -f2-)"
if [ "${GENERATED_PASS:-}" = 1 ]; then
  echo "    Password admin : $ADMIN_PASS   <- catat sekarang, tidak ditampilkan lagi"
else
  echo "    Password admin : (yang Anda isi; tersimpan di $APP/.env)"
fi
echo
[ "$RESOLVED" = "$PUBLIC_IP" ] || warn "DNS $DOMAIN mengarah ke '${RESOLVED:-tidak ada}', bukan $PUBLIC_IP. HTTPS baru jalan setelah DNS benar."
echo "    Info server untuk langkah VPN (kirimkan ke pengembang bila perlu):"
echo "      OS          : ${PRETTY_NAME:-?}"
echo "      Virtualisasi: $(systemd-detect-virt 2>/dev/null || echo '?')   /dev/kvm: $KVM"
echo "      CPU / RAM   : $(nproc) core / $(free -m | awk '/Mem:/{print $2}') MB   Disk kosong: $(df -h / | awk 'NR==2{print $4}')"
echo "      IP publik   : $PUBLIC_IP"
echo
echo "    Langkah berikutnya:"
echo "      1. Buka panel admin, isi rekening transfer di Pengaturan & VPN."
echo "      2. Siapkan server VPN (MikroTik CHR) agar router pelanggan bisa terhubung: docs/CLOUD.md bagian 4."
echo "         Sebelum CHR siap, Anda bisa mencoba alurnya dengan 'CHR simulasi' di Pengaturan & VPN."
echo "    Log aplikasi   : cd $APP && docker compose logs -f mikrotal"
