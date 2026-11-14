/**
 * Definisi menu RouterOS yang ditampilkan dengan halaman generik (tabel + form tambah/ubah).
 * Menambah menu baru cukup dengan menambah entri di sini (dan izinkan path-nya di server).
 */

export type FieldType = 'text' | 'number' | 'password' | 'select' | 'bool' | 'textarea' | 'duration';

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  options?: (string | { value: string; label: string })[];
  /** Ambil pilihan dari menu lain, mis. daftar interface */
  source?: { path: string; key?: string; allowEmpty?: boolean; extra?: string[] };
  required?: boolean;
  placeholder?: string;
  hint?: string;
  full?: boolean;
  /** Hanya tampil saat tambah (tidak saat ubah) */
  createOnly?: boolean;
  readOnlyOnEdit?: boolean;
}

export type ColumnRender = 'text' | 'bool' | 'bytes' | 'mono' | 'status' | 'running' | 'tags' | 'duration';

export interface ColumnDef {
  key: string;
  label: string;
  render?: ColumnRender;
  className?: string;
}

export interface ResourceDef {
  key: string;
  path: string;
  title: string;
  description: string;
  group: 'config' | 'hotspot';
  columns: ColumnDef[];
  fields: FieldDef[];
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canToggle?: boolean;
  extraActions?: { action: string; label: string; confirm?: string }[];
  autoRefresh?: number;
  deleteLabel?: string;
  searchKeys?: string[];
}

const IFACE = { path: '/interface', key: 'name' };
const PROTOCOLS = ['', 'tcp', 'udp', 'icmp', 'gre', 'ipsec-esp', 'ospf', 'igmp'];
const CONN_STATES = ['', 'established', 'related', 'new', 'invalid', 'established,related', 'untracked'];

function def(d: Omit<ResourceDef, 'canAdd' | 'canEdit' | 'canDelete' | 'canToggle'> & Partial<ResourceDef>): ResourceDef {
  return { canAdd: true, canEdit: true, canDelete: true, canToggle: true, ...d };
}

export const RESOURCES: ResourceDef[] = [
  // ---------- Jaringan ----------
  def({
    key: 'interfaces',
    path: '/interface',
    title: 'Interface',
    description: 'Semua port & interface router. Klik ubah untuk mengganti nama, MTU, atau komentar.',
    group: 'config',
    canAdd: false,
    canDelete: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'type', label: 'Tipe', render: 'tags' },
      { key: 'running', label: 'Link', render: 'running' },
      { key: 'rx-byte', label: 'RX', render: 'bytes' },
      { key: 'tx-byte', label: 'TX', render: 'bytes' },
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'mtu', label: 'MTU', type: 'number', placeholder: '1500' },
      { name: 'comment', label: 'Komentar', full: true, hint: 'Tambahkan [monitor] agar status link diawasi & dikirim alert.' },
    ],
  }),
  def({
    key: 'bridges',
    path: '/interface/bridge',
    title: 'Bridge',
    description: 'Gabungkan beberapa port menjadi satu jaringan layer-2.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'protocol-mode', label: 'Protokol' },
      { key: 'mtu', label: 'MTU' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'protocol-mode', label: 'Protocol mode', type: 'select', options: ['rstp', 'stp', 'mstp', 'none'] },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'bridge-ports',
    path: '/interface/bridge/port',
    title: 'Bridge Port',
    description: 'Port yang menjadi anggota bridge.',
    group: 'config',
    columns: [
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'bridge', label: 'Bridge', render: 'mono' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'bridge', label: 'Bridge', type: 'select', source: { path: '/interface/bridge', key: 'name' }, required: true },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'vlans',
    path: '/interface/vlan',
    title: 'VLAN',
    description: 'Virtual LAN (802.1Q) di atas interface fisik.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'vlan-id', label: 'VLAN ID' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true, placeholder: 'vlan10' },
      { name: 'vlan-id', label: 'VLAN ID', type: 'number', required: true },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'ip-address',
    path: '/ip/address',
    title: 'IP Address',
    description: 'Alamat IP pada setiap interface.',
    group: 'config',
    columns: [
      { key: 'address', label: 'Address', render: 'mono' },
      { key: 'network', label: 'Network', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'dynamic', label: 'Dinamis', render: 'bool' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'address', label: 'Address', required: true, placeholder: '192.168.10.1/24' },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'routes',
    path: '/ip/route',
    title: 'Routing',
    description: 'Tabel routing statis & dinamis.',
    group: 'config',
    columns: [
      { key: 'dst-address', label: 'Tujuan', render: 'mono' },
      { key: 'gateway', label: 'Gateway', render: 'mono' },
      { key: 'distance', label: 'Distance' },
      { key: 'active', label: 'Aktif', render: 'bool' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'dst-address', label: 'Dst. address', required: true, placeholder: '0.0.0.0/0' },
      { name: 'gateway', label: 'Gateway', required: true, placeholder: '192.168.1.1' },
      { name: 'distance', label: 'Distance', type: 'number', placeholder: '1' },
      { name: 'check-gateway', label: 'Check gateway', type: 'select', options: ['', 'ping', 'arp'] },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'pools',
    path: '/ip/pool',
    title: 'IP Pool',
    description: 'Rentang IP untuk DHCP, hotspot & PPP.',
    group: 'config',
    canToggle: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'ranges', label: 'Rentang', render: 'mono' },
      { key: 'next-pool', label: 'Next pool' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'ranges', label: 'Rentang', required: true, placeholder: '10.10.10.2-10.10.10.254' },
      { name: 'next-pool', label: 'Next pool', type: 'select', source: { path: '/ip/pool', key: 'name', allowEmpty: true } },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'dhcp-servers',
    path: '/ip/dhcp-server',
    title: 'DHCP Server',
    description: 'Server DHCP yang membagikan IP otomatis.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'address-pool', label: 'Pool' },
      { key: 'lease-time', label: 'Lease time' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'address-pool', label: 'Address pool', type: 'select', source: { path: '/ip/pool', key: 'name', extra: ['static-only'] } },
      { name: 'lease-time', label: 'Lease time', type: 'duration', placeholder: '1h' },
    ],
  }),
  def({
    key: 'dhcp-networks',
    path: '/ip/dhcp-server/network',
    title: 'DHCP Network',
    description: 'Gateway & DNS yang diberikan ke klien DHCP.',
    group: 'config',
    canToggle: false,
    columns: [
      { key: 'address', label: 'Network', render: 'mono' },
      { key: 'gateway', label: 'Gateway', render: 'mono' },
      { key: 'dns-server', label: 'DNS', render: 'mono' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'address', label: 'Network', required: true, placeholder: '192.168.10.0/24' },
      { name: 'gateway', label: 'Gateway', placeholder: '192.168.10.1' },
      { name: 'dns-server', label: 'DNS server', placeholder: '8.8.8.8,1.1.1.1' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'dhcp-leases',
    path: '/ip/dhcp-server/lease',
    title: 'DHCP Lease',
    description: 'Perangkat yang mendapat IP dari DHCP. Tambahkan lease statis untuk IP tetap.',
    group: 'config',
    autoRefresh: 15000,
    columns: [
      { key: 'address', label: 'IP', render: 'mono' },
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'host-name', label: 'Hostname' },
      { key: 'server', label: 'Server' },
      { key: 'status', label: 'Status', render: 'status' },
      { key: 'dynamic', label: 'Dinamis', render: 'bool' },
      { key: 'expires-after', label: 'Berakhir' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'address', label: 'IP address', required: true },
      { name: 'mac-address', label: 'MAC address', required: true, placeholder: 'AA:BB:CC:DD:EE:FF' },
      { name: 'server', label: 'Server', type: 'select', source: { path: '/ip/dhcp-server', key: 'name', extra: ['all'] } },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'dns-static',
    path: '/ip/dns/static',
    title: 'DNS Static',
    description: 'Catatan DNS lokal (mis. hotspot.lan → IP router).',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'address', label: 'Address', render: 'mono' },
      { key: 'ttl', label: 'TTL' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama domain', required: true },
      { name: 'address', label: 'Address', required: true },
      { name: 'ttl', label: 'TTL', type: 'duration', placeholder: '1d' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'arp',
    path: '/ip/arp',
    title: 'ARP',
    description: 'Tabel IP ↔ MAC perangkat di jaringan.',
    group: 'config',
    autoRefresh: 20000,
    columns: [
      { key: 'address', label: 'IP', render: 'mono' },
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'dynamic', label: 'Dinamis', render: 'bool' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'address', label: 'IP', required: true },
      { name: 'mac-address', label: 'MAC', required: true },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'neighbors',
    path: '/ip/neighbor',
    title: 'Neighbor',
    description: 'Perangkat MikroTik/CDP/LLDP yang terdeteksi di sekitar router.',
    group: 'config',
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canToggle: false,
    columns: [
      { key: 'identity', label: 'Identity' },
      { key: 'address', label: 'Address', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'platform', label: 'Platform' },
      { key: 'board', label: 'Board' },
      { key: 'version', label: 'Versi' },
    ],
    fields: [],
  }),
  // ---------- Firewall & QoS ----------
  def({
    key: 'firewall-filter',
    path: '/ip/firewall/filter',
    title: 'Firewall Filter',
    description: 'Aturan izinkan/blokir trafik. Urutan aturan berpengaruh.',
    group: 'config',
    columns: [
      { key: 'chain', label: 'Chain', render: 'tags' },
      { key: 'action', label: 'Aksi', render: 'tags' },
      { key: 'protocol', label: 'Proto' },
      { key: 'src-address', label: 'Src', render: 'mono' },
      { key: 'dst-address', label: 'Dst', render: 'mono' },
      { key: 'dst-port', label: 'Port' },
      { key: 'in-interface', label: 'In' },
      { key: 'bytes', label: 'Bytes', render: 'bytes' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'chain', label: 'Chain', type: 'select', options: ['input', 'forward', 'output'], required: true },
      { name: 'action', label: 'Aksi', type: 'select', options: ['accept', 'drop', 'reject', 'fasttrack-connection', 'passthrough', 'log', 'add-src-to-address-list', 'add-dst-to-address-list', 'jump', 'return'], required: true },
      { name: 'protocol', label: 'Protokol', type: 'select', options: PROTOCOLS },
      { name: 'connection-state', label: 'Connection state', type: 'select', options: CONN_STATES },
      { name: 'src-address', label: 'Src. address' },
      { name: 'dst-address', label: 'Dst. address' },
      { name: 'src-port', label: 'Src. port' },
      { name: 'dst-port', label: 'Dst. port', placeholder: '22,8291' },
      { name: 'in-interface', label: 'In. interface', type: 'select', source: { ...IFACE, allowEmpty: true } },
      { name: 'out-interface', label: 'Out. interface', type: 'select', source: { ...IFACE, allowEmpty: true } },
      { name: 'src-address-list', label: 'Src. address list' },
      { name: 'dst-address-list', label: 'Dst. address list' },
      { name: 'address-list', label: 'Tambah ke address list', hint: 'Untuk aksi add-src/dst-to-address-list' },
      { name: 'address-list-timeout', label: 'Timeout address list', type: 'duration' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'firewall-nat',
    path: '/ip/firewall/nat',
    title: 'NAT',
    description: 'Masquerade internet, port forwarding, dan redirect.',
    group: 'config',
    columns: [
      { key: 'chain', label: 'Chain', render: 'tags' },
      { key: 'action', label: 'Aksi', render: 'tags' },
      { key: 'protocol', label: 'Proto' },
      { key: 'dst-port', label: 'Port' },
      { key: 'out-interface', label: 'Out' },
      { key: 'to-addresses', label: 'Ke IP', render: 'mono' },
      { key: 'to-ports', label: 'Ke port' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'chain', label: 'Chain', type: 'select', options: ['srcnat', 'dstnat'], required: true },
      { name: 'action', label: 'Aksi', type: 'select', options: ['masquerade', 'dst-nat', 'src-nat', 'redirect', 'netmap', 'accept', 'passthrough'], required: true },
      { name: 'protocol', label: 'Protokol', type: 'select', options: PROTOCOLS },
      { name: 'src-address', label: 'Src. address' },
      { name: 'dst-address', label: 'Dst. address' },
      { name: 'dst-port', label: 'Dst. port' },
      { name: 'in-interface', label: 'In. interface', type: 'select', source: { ...IFACE, allowEmpty: true } },
      { name: 'out-interface', label: 'Out. interface', type: 'select', source: { ...IFACE, allowEmpty: true } },
      { name: 'to-addresses', label: 'To addresses' },
      { name: 'to-ports', label: 'To ports' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'firewall-mangle',
    path: '/ip/firewall/mangle',
    title: 'Mangle',
    description: 'Penandaan koneksi/paket untuk QoS & policy routing.',
    group: 'config',
    columns: [
      { key: 'chain', label: 'Chain', render: 'tags' },
      { key: 'action', label: 'Aksi', render: 'tags' },
      { key: 'new-connection-mark', label: 'Conn mark' },
      { key: 'new-packet-mark', label: 'Packet mark' },
      { key: 'new-routing-mark', label: 'Routing mark' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'chain', label: 'Chain', type: 'select', options: ['prerouting', 'input', 'forward', 'output', 'postrouting'], required: true },
      { name: 'action', label: 'Aksi', type: 'select', options: ['mark-connection', 'mark-packet', 'mark-routing', 'change-mss', 'accept', 'passthrough'], required: true },
      { name: 'protocol', label: 'Protokol', type: 'select', options: PROTOCOLS },
      { name: 'src-address', label: 'Src. address' },
      { name: 'dst-address', label: 'Dst. address' },
      { name: 'connection-mark', label: 'Connection mark (match)' },
      { name: 'new-connection-mark', label: 'New connection mark' },
      { name: 'new-packet-mark', label: 'New packet mark' },
      { name: 'new-routing-mark', label: 'New routing mark' },
      { name: 'passthrough', label: 'Passthrough', type: 'bool' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'address-list',
    path: '/ip/firewall/address-list',
    title: 'Address List',
    description: 'Daftar IP untuk dipakai di aturan firewall (blacklist, whitelist, dll).',
    group: 'config',
    columns: [
      { key: 'list', label: 'List', render: 'tags' },
      { key: 'address', label: 'Address', render: 'mono' },
      { key: 'timeout', label: 'Timeout' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'list', label: 'Nama list', required: true },
      { name: 'address', label: 'Address', required: true },
      { name: 'timeout', label: 'Timeout', type: 'duration', hint: 'Kosongkan untuk permanen' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'queue-simple',
    path: '/queue/simple',
    title: 'Simple Queue',
    description: 'Batasi bandwidth per IP/subnet dengan mudah.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'target', label: 'Target', render: 'mono' },
      { key: 'max-limit', label: 'Max limit (U/D)' },
      { key: 'limit-at', label: 'Limit at' },
      { key: 'parent', label: 'Parent' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'target', label: 'Target', required: true, placeholder: '192.168.10.0/24' },
      { name: 'max-limit', label: 'Max limit (upload/download)', placeholder: '10M/10M' },
      { name: 'limit-at', label: 'Limit at', placeholder: '1M/1M' },
      { name: 'burst-limit', label: 'Burst limit', placeholder: '15M/15M' },
      { name: 'burst-threshold', label: 'Burst threshold', placeholder: '8M/8M' },
      { name: 'burst-time', label: 'Burst time', placeholder: '10s/10s' },
      { name: 'priority', label: 'Prioritas', placeholder: '8/8' },
      { name: 'parent', label: 'Parent', type: 'select', source: { path: '/queue/simple', key: 'name', extra: ['none'] } },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'queue-types',
    path: '/queue/type',
    title: 'Queue Type',
    description: 'Jenis antrian (PCQ untuk berbagi bandwidth merata).',
    group: 'config',
    canToggle: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'kind', label: 'Jenis', render: 'tags' },
      { key: 'pcq-rate', label: 'PCQ rate' },
      { key: 'pcq-classifier', label: 'Classifier' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'kind', label: 'Jenis', type: 'select', options: ['pcq', 'sfq', 'pfifo', 'bfifo', 'red', 'fq-codel', 'cake'], required: true },
      { name: 'pcq-rate', label: 'PCQ rate', placeholder: '2M' },
      { name: 'pcq-classifier', label: 'PCQ classifier', type: 'select', options: ['', 'dst-address', 'src-address', 'dst-address,dst-port', 'src-address,src-port'] },
    ],
  }),
  // ---------- PPP ----------
  def({
    key: 'ppp-secrets',
    path: '/ppp/secret',
    title: 'PPP Secret',
    description: 'Akun pelanggan PPPoE / L2TP / PPTP / SSTP / OVPN.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Username', render: 'mono' },
      { key: 'service', label: 'Layanan', render: 'tags' },
      { key: 'profile', label: 'Profil' },
      { key: 'remote-address', label: 'Remote IP', render: 'mono' },
      { key: 'last-logged-out', label: 'Terakhir logout' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Username', required: true },
      { name: 'password', label: 'Password', type: 'password' },
      { name: 'service', label: 'Layanan', type: 'select', options: ['any', 'pppoe', 'l2tp', 'pptp', 'sstp', 'ovpn'] },
      { name: 'profile', label: 'Profil', type: 'select', source: { path: '/ppp/profile', key: 'name' } },
      { name: 'local-address', label: 'Local address' },
      { name: 'remote-address', label: 'Remote address' },
      { name: 'caller-id', label: 'Caller ID (MAC)' },
      { name: 'comment', label: 'Komentar / nama pelanggan', full: true },
    ],
  }),
  def({
    key: 'ppp-profiles',
    path: '/ppp/profile',
    title: 'PPP Profile',
    description: 'Paket kecepatan & pengaturan pelanggan PPP.',
    group: 'config',
    canToggle: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'rate-limit', label: 'Rate limit' },
      { key: 'local-address', label: 'Local', render: 'mono' },
      { key: 'remote-address', label: 'Remote' },
      { key: 'only-one', label: 'Only one' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'rate-limit', label: 'Rate limit (U/D)', placeholder: '10M/10M' },
      { name: 'local-address', label: 'Local address' },
      { name: 'remote-address', label: 'Remote address / pool', type: 'select', source: { path: '/ip/pool', key: 'name', allowEmpty: true } },
      { name: 'dns-server', label: 'DNS server' },
      { name: 'only-one', label: 'Only one', type: 'select', options: ['default', 'yes', 'no'] },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'ppp-active',
    path: '/ppp/active',
    title: 'PPP Aktif',
    description: 'Pelanggan PPP yang sedang terhubung. Hapus untuk memutus sesi.',
    group: 'config',
    canAdd: false,
    canEdit: false,
    canToggle: false,
    deleteLabel: 'Putuskan',
    autoRefresh: 10000,
    columns: [
      { key: 'name', label: 'Username', render: 'mono' },
      { key: 'service', label: 'Layanan', render: 'tags' },
      { key: 'address', label: 'IP', render: 'mono' },
      { key: 'caller-id', label: 'Caller ID', render: 'mono' },
      { key: 'uptime', label: 'Uptime', render: 'duration' },
    ],
    fields: [],
  }),
  def({
    key: 'pppoe-servers',
    path: '/interface/pppoe-server/server',
    title: 'PPPoE Server',
    description: 'Layanan PPPoE server pada interface.',
    group: 'config',
    columns: [
      { key: 'service-name', label: 'Service name', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'default-profile', label: 'Profil default' },
    ],
    fields: [
      { name: 'service-name', label: 'Service name', required: true },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'default-profile', label: 'Profil default', type: 'select', source: { path: '/ppp/profile', key: 'name' } },
      { name: 'one-session-per-host', label: 'One session per host', type: 'bool' },
    ],
  }),
  // ---------- Sistem ----------
  def({
    key: 'scheduler',
    path: '/system/scheduler',
    title: 'Scheduler',
    description: 'Jalankan perintah otomatis pada waktu tertentu.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'start-date', label: 'Mulai' },
      { key: 'start-time', label: 'Jam' },
      { key: 'interval', label: 'Interval' },
      { key: 'next-run', label: 'Berikutnya' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'start-date', label: 'Tanggal mulai', placeholder: 'jan/01/2026' },
      { name: 'start-time', label: 'Jam mulai', placeholder: '03:00:00' },
      { name: 'interval', label: 'Interval', type: 'duration', placeholder: '1d' },
      { name: 'on-event', label: 'Perintah', type: 'textarea', full: true, placeholder: '/system backup save name=auto' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'scripts',
    path: '/system/script',
    title: 'Script',
    description: 'Script RouterOS yang tersimpan di router.',
    group: 'config',
    canToggle: false,
    extraActions: [{ action: 'run', label: 'Jalankan', confirm: 'Jalankan script ini sekarang?' }],
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'policy', label: 'Policy' },
      { key: 'last-started', label: 'Terakhir dijalankan' },
      { key: 'run-count', label: 'Jumlah run' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'source', label: 'Isi script', type: 'textarea', full: true },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'router-users',
    path: '/user',
    title: 'User Router',
    description: 'Akun login Winbox/SSH/API di router.',
    group: 'config',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'group', label: 'Grup', render: 'tags' },
      { key: 'address', label: 'Allowed address', render: 'mono' },
      { key: 'last-logged-in', label: 'Terakhir login' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'group', label: 'Grup', type: 'select', source: { path: '/user/group', key: 'name' }, required: true },
      { name: 'password', label: 'Password', type: 'password', hint: 'Kosongkan saat ubah jika tidak diganti' },
      { name: 'address', label: 'Allowed address', placeholder: '192.168.88.0/24' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'services',
    path: '/ip/service',
    title: 'IP Service',
    description: 'Port layanan manajemen router (api, winbox, ssh, www). Matikan yang tidak perlu demi keamanan.',
    group: 'config',
    canAdd: false,
    canDelete: false,
    columns: [
      { key: 'name', label: 'Layanan', render: 'mono' },
      { key: 'port', label: 'Port' },
      { key: 'address', label: 'Allowed address', render: 'mono' },
    ],
    fields: [
      { name: 'port', label: 'Port', type: 'number', required: true },
      { name: 'address', label: 'Allowed address', placeholder: 'Kosong = semua', full: true },
    ],
  }),
  def({
    key: 'files',
    path: '/file',
    title: 'File',
    description: 'File di penyimpanan router (backup, export, template hotspot).',
    group: 'config',
    canAdd: false,
    canEdit: false,
    canToggle: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'type', label: 'Tipe', render: 'tags' },
      { key: 'size', label: 'Ukuran', render: 'bytes' },
      { key: 'creation-time', label: 'Dibuat' },
    ],
    fields: [],
  }),
  // ---------- Hotspot ----------
  def({
    key: 'hotspot-users',
    path: '/ip/hotspot/user',
    title: 'Pengguna Hotspot',
    description: 'Semua akun hotspot di router (member & voucher).',
    group: 'hotspot',
    extraActions: [{ action: 'reset-counters', label: 'Reset counter', confirm: 'Reset uptime & kuota pengguna ini?' }],
    searchKeys: ['name', 'profile', 'comment', 'mac-address'],
    columns: [
      { key: 'name', label: 'Username', render: 'mono' },
      { key: 'profile', label: 'Profil', render: 'tags' },
      { key: 'uptime', label: 'Uptime', render: 'duration' },
      { key: 'limit-uptime', label: 'Limit waktu' },
      { key: 'bytes-out', label: 'Download', render: 'bytes' },
      { key: 'bytes-in', label: 'Upload', render: 'bytes' },
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'name', label: 'Username', required: true },
      { name: 'password', label: 'Password', type: 'password' },
      { name: 'profile', label: 'Profil', type: 'select', source: { path: '/ip/hotspot/user/profile', key: 'name' } },
      { name: 'server', label: 'Server', type: 'select', source: { path: '/ip/hotspot', key: 'name', extra: ['all'] } },
      { name: 'limit-uptime', label: 'Limit uptime', type: 'duration', placeholder: '3h' },
      { name: 'limit-bytes-total', label: 'Limit kuota (byte)', type: 'number', placeholder: '1073741824' },
      { name: 'mac-address', label: 'Kunci ke MAC' },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'hotspot-hosts',
    path: '/ip/hotspot/host',
    title: 'Hotspot Host',
    description: 'Semua perangkat yang terdeteksi di jaringan hotspot (login maupun belum).',
    group: 'hotspot',
    canAdd: false,
    canEdit: false,
    canToggle: false,
    autoRefresh: 15000,
    columns: [
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'address', label: 'IP', render: 'mono' },
      { key: 'to-address', label: 'To address', render: 'mono' },
      { key: 'server', label: 'Server' },
      { key: 'authorized', label: 'Login', render: 'bool' },
      { key: 'bypassed', label: 'Bypass', render: 'bool' },
      { key: 'idle-time', label: 'Idle' },
    ],
    fields: [],
  }),
  def({
    key: 'ip-binding',
    path: '/ip/hotspot/ip-binding',
    title: 'IP Binding',
    description: 'Bypass (tanpa login) atau blokir perangkat berdasarkan MAC/IP.',
    group: 'hotspot',
    columns: [
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'address', label: 'Address', render: 'mono' },
      { key: 'to-address', label: 'To address', render: 'mono' },
      { key: 'type', label: 'Tipe', render: 'status' },
      { key: 'server', label: 'Server' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'mac-address', label: 'MAC address' },
      { name: 'address', label: 'Address' },
      { name: 'to-address', label: 'To address' },
      { name: 'type', label: 'Tipe', type: 'select', options: ['bypassed', 'blocked', 'regular'], required: true },
      { name: 'server', label: 'Server', type: 'select', source: { path: '/ip/hotspot', key: 'name', extra: ['all'] } },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'walled-garden',
    path: '/ip/hotspot/walled-garden',
    title: 'Walled Garden',
    description: 'Situs yang boleh diakses tanpa login (mis. WhatsApp, situs pembayaran).',
    group: 'hotspot',
    columns: [
      { key: 'dst-host', label: 'Host', render: 'mono' },
      { key: 'dst-port', label: 'Port' },
      { key: 'path', label: 'Path' },
      { key: 'action', label: 'Aksi', render: 'status' },
      { key: 'server', label: 'Server' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'dst-host', label: 'Dst. host', placeholder: '*.example.com', required: true },
      { name: 'dst-port', label: 'Dst. port' },
      { name: 'path', label: 'Path' },
      { name: 'action', label: 'Aksi', type: 'select', options: ['allow', 'deny'] },
      { name: 'server', label: 'Server', type: 'select', source: { path: '/ip/hotspot', key: 'name', allowEmpty: true } },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'walled-garden-ip',
    path: '/ip/hotspot/walled-garden/ip',
    title: 'Walled Garden IP',
    description: 'IP/port yang boleh diakses tanpa login.',
    group: 'hotspot',
    columns: [
      { key: 'dst-address', label: 'Dst. address', render: 'mono' },
      { key: 'protocol', label: 'Protokol' },
      { key: 'dst-port', label: 'Port' },
      { key: 'action', label: 'Aksi', render: 'status' },
      { key: 'comment', label: 'Komentar' },
    ],
    fields: [
      { name: 'dst-address', label: 'Dst. address', required: true },
      { name: 'protocol', label: 'Protokol', type: 'select', options: PROTOCOLS },
      { name: 'dst-port', label: 'Dst. port' },
      { name: 'action', label: 'Aksi', type: 'select', options: ['accept', 'drop', 'reject'] },
      { name: 'comment', label: 'Komentar', full: true },
    ],
  }),
  def({
    key: 'hotspot-servers',
    path: '/ip/hotspot',
    title: 'Server Hotspot',
    description: 'Instance hotspot pada interface.',
    group: 'hotspot',
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'interface', label: 'Interface', render: 'mono' },
      { key: 'address-pool', label: 'Pool' },
      { key: 'profile', label: 'Profil server' },
      { key: 'addresses-per-mac', label: 'IP/MAC' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'interface', label: 'Interface', type: 'select', source: IFACE, required: true },
      { name: 'address-pool', label: 'Address pool', type: 'select', source: { path: '/ip/pool', key: 'name', extra: ['none'] } },
      { name: 'profile', label: 'Profil server', type: 'select', source: { path: '/ip/hotspot/profile', key: 'name' } },
      { name: 'addresses-per-mac', label: 'Addresses per MAC', type: 'number' },
    ],
  }),
  def({
    key: 'hotspot-server-profiles',
    path: '/ip/hotspot/profile',
    title: 'Profil Server Hotspot',
    description: 'Pengaturan halaman login, DNS name & metode login.',
    group: 'hotspot',
    canToggle: false,
    columns: [
      { key: 'name', label: 'Nama', render: 'mono' },
      { key: 'hotspot-address', label: 'Alamat', render: 'mono' },
      { key: 'dns-name', label: 'DNS name' },
      { key: 'html-directory', label: 'Folder HTML' },
      { key: 'login-by', label: 'Login by' },
    ],
    fields: [
      { name: 'name', label: 'Nama', required: true },
      { name: 'hotspot-address', label: 'Hotspot address' },
      { name: 'dns-name', label: 'DNS name', placeholder: 'hotspot.lan' },
      { name: 'html-directory', label: 'HTML directory', placeholder: 'hotspot' },
      { name: 'login-by', label: 'Login by', placeholder: 'cookie,http-chap' },
      { name: 'rate-limit', label: 'Rate limit' },
    ],
  }),
  def({
    key: 'hotspot-cookies',
    path: '/ip/hotspot/cookie',
    title: 'Cookie Hotspot',
    description: 'Cookie login otomatis. Hapus untuk memaksa perangkat login ulang.',
    group: 'hotspot',
    canAdd: false,
    canEdit: false,
    canToggle: false,
    columns: [
      { key: 'user', label: 'User', render: 'mono' },
      { key: 'mac-address', label: 'MAC', render: 'mono' },
      { key: 'expires-in', label: 'Berakhir' },
    ],
    fields: [],
  }),
];

export const RESOURCE_MAP = Object.fromEntries(RESOURCES.map((r) => [r.key, r]));
