# Sambungan server MIKROTAL ↔ CHR (WireGuard)

Server aplikasi (Linux) dan CHR dihubungkan dengan satu tunnel WireGuard pribadi. Lewat tunnel ini:
- MIKROTAL mengatur CHR lewat API (10.199.0.1:8728), dan
- MIKROTAL menjangkau router pelanggan di jaringan 10.200.0.0/16.

Ganti `<...>` sesuai milik Anda. Buat kunci di server Linux: `wg genkey | tee app.key | wg pubkey > app.pub`.

## 1. Di CHR (Terminal Winbox)

```
/interface wireguard add name=link-app listen-port=13232 comment="ke server MIKROTAL"
/interface wireguard peers add interface=link-app public-key="<isi app.pub>" allowed-address=10.199.0.2/32
/ip address add address=10.199.0.1/30 interface=link-app
/user group add name=mikrotal policy=read,write,api,test,sensitive
/user add name=mikrotal group=mikrotal password="<password-api-chr>" address=10.199.0.2/32
/ip service set api address=10.199.0.2/32
/interface wireguard print detail where name=link-app
```

Catat `public-key` link-app untuk langkah 2.

Firewall input CHR (sesuaikan dengan rule yang sudah ada; letakkan sebelum rule drop):

```
/ip firewall filter
add chain=input connection-state=established,related action=accept comment="mikrotal: established"
add chain=input protocol=udp dst-port=13231,13232 action=accept comment="mikrotal: WireGuard pelanggan & link server"
add chain=input protocol=udp dst-port=500,4500,1701 action=accept comment="mikrotal: L2TP/IPsec"
add chain=input protocol=ipsec-esp action=accept comment="mikrotal: IPsec ESP"
add chain=input protocol=tcp dst-port=443 action=accept comment="mikrotal: SSTP"
add chain=input src-address=10.199.0.2 action=accept comment="mikrotal: server aplikasi"
add chain=input protocol=icmp action=accept
add chain=input src-address=<IP-anda-untuk-winbox> action=accept comment="admin"
add chain=input action=drop comment="drop lainnya"
```

## 2. Di server Linux

`/etc/wireguard/wg-chr.conf`:

```
[Interface]
Address = 10.199.0.2/30
PrivateKey = <isi app.key>

[Peer]
PublicKey = <public-key link-app dari CHR>
Endpoint = <vpn.domain-anda>:13232
AllowedIPs = 10.199.0.1/32, 10.200.0.0/16
PersistentKeepalive = 25
```

```
sudo systemctl enable --now wg-quick@wg-chr
ping 10.199.0.1
```

`AllowedIPs` berisi 10.200.0.0/16, sehingga server otomatis punya rute ke semua router pelanggan lewat CHR.

## 3. Di panel admin MIKROTAL Cloud

Pengaturan & VPN → Server VPN (MikroTik CHR):
- Alamat API CHR: `10.199.0.1`, port `8728`, user `mikrotal`, password di atas
- Endpoint publik VPN: `vpn.domain-anda`
- Klik **Uji koneksi**, lalu **Siapkan CHR**

Untuk SSTP, buat sertifikat dulu di CHR (CHR harus bisa diakses di port 80 dari internet sesaat):

```
/certificate enable-ssl-certificate dns-name=<vpn.domain-anda>
```

lalu klik **Siapkan CHR** lagi.
