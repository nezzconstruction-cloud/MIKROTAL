import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Columns3, Compass, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RequireRouter } from '../components/RequireRouter';
import { ExtraProps, PropInput, READONLY_KEYS, useAllProps } from '../components/RosProperties';
import { Badge, Button, Card, EmptyState, IconButton, Input, Loading, Modal, PageHeader, SearchInput, useAction, useFeedback } from '../components/ui';

type Row = Record<string, string>;

/** Katalog menu RouterOS v6 & v7. Menu yang tidak ada di router ditolak dengan pesan jelas. */
const CATALOG: { group: string; items: [string, string][] }[] = [
  {
    group: 'Interface',
    items: [
      ['/interface', 'Semua interface'],
      ['/interface/ethernet', 'Ethernet'],
      ['/interface/bridge', 'Bridge'],
      ['/interface/bridge/port', 'Bridge port'],
      ['/interface/bridge/vlan', 'Bridge VLAN'],
      ['/interface/vlan', 'VLAN'],
      ['/interface/bonding', 'Bonding'],
      ['/interface/list', 'Interface list'],
      ['/interface/list/member', 'Anggota interface list'],
      ['/interface/wireless', 'Wireless (v6)'],
      ['/interface/wifi', 'WiFi (v7)'],
      ['/interface/eoip', 'EoIP'],
      ['/interface/gre', 'GRE'],
      ['/interface/vrrp', 'VRRP'],
      ['/interface/wireguard', 'WireGuard'],
      ['/interface/wireguard/peers', 'WireGuard peers'],
    ],
  },
  {
    group: 'PPP & VPN',
    items: [
      ['/ppp/profile', 'PPP Profile'],
      ['/ppp/secret', 'PPP Secret'],
      ['/ppp/active', 'PPP aktif'],
      ['/ppp/aaa', 'PPP AAA'],
      ['/interface/pppoe-server/server', 'PPPoE server'],
      ['/interface/pppoe-client', 'PPPoE client'],
      ['/interface/l2tp-server/server', 'L2TP server'],
      ['/interface/l2tp-client', 'L2TP client'],
      ['/interface/l2tp-ether', 'L2TP Ethernet (v7)'],
      ['/ppp/l2tp-secret', 'L2TP secret (v7)'],
      ['/interface/ovpn-server/server', 'OVPN server'],
      ['/interface/ovpn-client', 'OVPN client'],
      ['/interface/sstp-server/server', 'SSTP server'],
      ['/interface/sstp-client', 'SSTP client'],
      ['/interface/pptp-server/server', 'PPTP server'],
      ['/interface/pptp-client', 'PPTP client'],
    ],
  },
  {
    group: 'IP',
    items: [
      ['/ip/address', 'IP address'],
      ['/ip/route', 'Route'],
      ['/ip/pool', 'Pool'],
      ['/ip/dns', 'DNS'],
      ['/ip/dns/static', 'DNS static'],
      ['/ip/dhcp-client', 'DHCP client'],
      ['/ip/dhcp-server', 'DHCP server'],
      ['/ip/dhcp-server/network', 'DHCP network'],
      ['/ip/dhcp-server/lease', 'DHCP lease'],
      ['/ip/arp', 'ARP'],
      ['/ip/neighbor', 'Neighbor'],
      ['/ip/neighbor/discovery-settings', 'Neighbor discovery'],
      ['/ip/settings', 'IP settings'],
      ['/ip/service', 'IP service'],
      ['/ip/cloud', 'IP cloud (DDNS)'],
      ['/ip/proxy', 'Web proxy'],
      ['/ip/socks', 'SOCKS'],
      ['/ip/upnp', 'UPnP'],
      ['/ip/traffic-flow', 'Traffic flow'],
      ['/ip/ipsec/peer', 'IPsec peer'],
      ['/ip/ipsec/policy', 'IPsec policy'],
      ['/ip/vrf', 'VRF'],
    ],
  },
  {
    group: 'Firewall',
    items: [
      ['/ip/firewall/filter', 'Filter'],
      ['/ip/firewall/nat', 'NAT'],
      ['/ip/firewall/mangle', 'Mangle'],
      ['/ip/firewall/raw', 'Raw'],
      ['/ip/firewall/address-list', 'Address list'],
      ['/ip/firewall/layer7-protocol', 'Layer7 protocol'],
      ['/ip/firewall/service-port', 'Service port'],
      ['/ip/firewall/connection/tracking', 'Connection tracking'],
    ],
  },
  {
    group: 'Hotspot',
    items: [
      ['/ip/hotspot', 'Server hotspot'],
      ['/ip/hotspot/profile', 'Profil server'],
      ['/ip/hotspot/user', 'User'],
      ['/ip/hotspot/user/profile', 'Profil user'],
      ['/ip/hotspot/active', 'Sesi aktif'],
      ['/ip/hotspot/host', 'Host'],
      ['/ip/hotspot/ip-binding', 'IP binding'],
      ['/ip/hotspot/walled-garden', 'Walled garden'],
      ['/ip/hotspot/walled-garden/ip', 'Walled garden IP'],
      ['/ip/hotspot/cookie', 'Cookie'],
    ],
  },
  {
    group: 'Queue & bandwidth',
    items: [
      ['/queue/simple', 'Simple queue'],
      ['/queue/tree', 'Queue tree'],
      ['/queue/type', 'Queue type'],
      ['/queue/interface', 'Queue interface'],
    ],
  },
  {
    group: 'Routing',
    items: [
      ['/routing/table', 'Routing table (v7)'],
      ['/routing/rule', 'Routing rule (v7)'],
      ['/ip/route/rule', 'Route rule (v6)'],
      ['/routing/ospf/instance', 'OSPF instance'],
      ['/routing/ospf/area', 'OSPF area'],
      ['/routing/ospf/interface-template', 'OSPF interface (v7)'],
      ['/routing/bgp/connection', 'BGP connection (v7)'],
      ['/routing/bgp/peer', 'BGP peer (v6)'],
      ['/routing/filter/rule', 'Routing filter (v7)'],
    ],
  },
  {
    group: 'IPv6',
    items: [
      ['/ipv6/address', 'Address'],
      ['/ipv6/route', 'Route'],
      ['/ipv6/firewall/filter', 'Firewall filter'],
      ['/ipv6/dhcp-client', 'DHCP client'],
      ['/ipv6/nd', 'ND'],
      ['/ipv6/settings', 'Settings'],
    ],
  },
  {
    group: 'Sistem',
    items: [
      ['/system/identity', 'Identity'],
      ['/system/clock', 'Jam'],
      ['/system/ntp/client', 'NTP client'],
      ['/system/ntp/server', 'NTP server'],
      ['/system/scheduler', 'Scheduler'],
      ['/system/script', 'Script'],
      ['/system/logging', 'Logging'],
      ['/system/logging/action', 'Logging action'],
      ['/system/note', 'Catatan login'],
      ['/system/watchdog', 'Watchdog'],
      ['/system/routerboard/settings', 'RouterBOARD settings'],
      ['/system/package', 'Paket'],
      ['/user', 'User router'],
      ['/user/group', 'Grup user'],
      ['/radius', 'RADIUS'],
      ['/snmp', 'SNMP'],
      ['/snmp/community', 'SNMP community'],
      ['/certificate', 'Sertifikat'],
    ],
  },
  {
    group: 'Tools',
    items: [
      ['/tool/netwatch', 'Netwatch'],
      ['/tool/e-mail', 'E-mail'],
      ['/tool/graphing/interface', 'Graphing interface'],
      ['/tool/mac-server', 'MAC server'],
      ['/tool/mac-server/mac-winbox', 'MAC winbox'],
      ['/tool/romon', 'RoMON'],
      ['/tool/bandwidth-server', 'Bandwidth server'],
    ],
  },
];
const ALL_ITEMS = CATALOG.flatMap((g) => g.items.map(([path, label]) => ({ path, label, group: g.group })));

/** Urutan kolom: nama/alamat dulu, sisanya sesuai urutan dari router. */
const FIRST = ['name', 'address', 'interface', 'chain', 'action', 'list', 'target', 'src-address', 'dst-address', 'dst-host', 'profile', 'local-address', 'remote-address', 'rate-limit', 'max-limit', 'parent', 'comment'];
const HIDE = new Set(['.id', 'disabled', 'dynamic', 'invalid', '.nextid']);

function columnsOf(rows: Row[]) {
  const seen = new Map<string, number>();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) if (!HIDE.has(k)) seen.set(k, (seen.get(k) ?? 0) + 1);
  const keys = [...seen.keys()];
  return [...FIRST.filter((k) => seen.has(k)), ...keys.filter((k) => !FIRST.includes(k))];
}

function ItemModal({ routerId, path, row, keys, onClose, onSaved }: { routerId: number; path: string; row: Row | null; keys: string[]; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const props = useAllProps(row);
  const isEdit = !!row;
  const save = async () => {
    const params = props.changed();
    if (isEdit) await post(`/api/routers/${routerId}/ros/set`, { path, id: row?.['.id'], params });
    else await post(`/api/routers/${routerId}/ros/add`, { path, params });
    return true;
  };
  const readOnly = row ? Object.keys(row).filter((k) => READONLY_KEYS.has(k) && k !== '.id') : [];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Ubah ${row?.name ?? row?.['.id']} — ${path}` : `Tambah ke ${path}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, isEdit ? 'Perubahan dikirim ke router' : 'Item ditambahkan')) !== undefined && onSaved()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {row?.dynamic === 'true' && <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">Item dinamis dibuat otomatis oleh router dan umumnya tidak bisa diubah.</p>}
        {isEdit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {props.keys.map((k) => (
              <label key={k} className="block">
                <span className="mb-1 block font-mono text-[11px] text-muted">{k}</span>
                <PropInput name={k} value={props.vals[k] ?? ''} original={row?.[k]} onChange={(v) => props.setVals((x) => ({ ...x, [k]: v }))} />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Isi properti dengan nama yang sama seperti di Winbox/terminal (mis. name, interface, address). Saran nama diambil dari item yang sudah ada.</p>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">{isEdit ? 'Properti lain yang belum terisi' : 'Properti'}</p>
          <ExtraProps rows={props.extra} onChange={props.setExtra} suggestions={keys.filter((k) => !READONLY_KEYS.has(k))} />
        </div>
        {readOnly.length > 0 && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-2 text-xs font-semibold text-muted">Status (hanya baca)</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {readOnly.map((k) => (
                <div key={k} className="min-w-0">
                  <dt className="font-mono text-[10px] text-subtle">{k}</dt>
                  <dd className="truncate">{row?.[k] || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SingletonForm({ routerId, path, row, canWrite, onSaved }: { routerId: number; path: string; row: Row; canWrite: boolean; onSaved: () => void }) {
  const props = useAllProps(row);
  const { run, busy } = useAction();
  const readOnly = Object.keys(row).filter((k) => READONLY_KEYS.has(k));
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {props.keys.map((k) => (
          <label key={k} className="block">
            <span className="mb-1 block font-mono text-[11px] text-muted">{k}</span>
            <fieldset disabled={!canWrite}>
              <PropInput name={k} value={props.vals[k] ?? ''} original={row[k]} onChange={(v) => props.setVals((x) => ({ ...x, [k]: v }))} />
            </fieldset>
          </label>
        ))}
      </div>
      {readOnly.length > 0 && (
        <p className="text-xs text-muted">
          Hanya baca: {readOnly.map((k) => `${k}=${row[k]}`).join(' • ')}
        </p>
      )}
      {canWrite && (
        <>
          <ExtraProps rows={props.extra} onChange={props.setExtra} suggestions={[]} />
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => post(`/api/routers/${routerId}/ros/set`, { path, params: props.changed() }), 'Pengaturan dikirim ke router');
              if (r) onSaved();
            }}
          >
            Simpan
          </Button>
        </>
      )}
    </div>
  );
}

function MenuView({ routerId, path }: { routerId: number; path: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const [showCols, setShowCols] = useState(false);
  const canWrite = can('system.danger');
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ros', routerId, path],
    queryFn: () => get<{ rows: Row[]; singleton: boolean }>(`/api/routers/${routerId}/ros`, { path }),
    retry: false,
  });
  const rows = data?.rows ?? [];
  const cols = useMemo(() => columnsOf(rows), [rows]);
  const visible = cols.filter((c) => (hidden ? !hidden.has(c) : cols.indexOf(c) < 8));
  const filtered = q ? rows.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q.toLowerCase()))) : rows;
  const refresh = () => qc.invalidateQueries({ queryKey: ['ros', routerId, path] });
  const act = async (r: Row, action: 'enable' | 'disable' | 'remove') => {
    if (action === 'remove' && !(await confirm({ title: `Hapus ${r.name ?? r['.id']}?`, message: `Item dihapus dari ${path} di router.`, danger: true, confirmText: 'Hapus' }))) return;
    await run(() => post(`/api/routers/${routerId}/ros/action`, { path, ids: [r['.id']], action }), action === 'remove' ? 'Item dihapus' : action === 'enable' ? 'Diaktifkan' : 'Dinonaktifkan');
    void refresh();
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold">{path}</p>
          <p className="text-xs text-muted">{data ? (data.singleton ? 'Pengaturan tunggal' : `${rows.length} item`) : ' '}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && !data.singleton && <SearchInput value={q} onChange={setQ} placeholder="Cari di semua kolom..." />}
          {data && !data.singleton && (
            <div className="relative">
              <Button size="sm" variant="secondary" icon={<Columns3 className="size-3.5" />} onClick={() => setShowCols((v) => !v)}>
                Kolom
              </Button>
              {showCols && (
                <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl dark:bg-elevated">
                  {cols.map((c) => (
                    <label key={c} className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={visible.includes(c)}
                        onChange={() => {
                          const base = hidden ?? new Set(cols.filter((x) => !visible.includes(x)));
                          const n = new Set(base);
                          if (n.has(c)) n.delete(c);
                          else n.add(c);
                          setHidden(n);
                        }}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <IconButton title="Muat ulang" onClick={() => refetch()}>
            <RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />
          </IconButton>
          {canWrite && data && !data.singleton && (
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
              Tambah
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <EmptyState icon={<Compass className="size-6" />} title="Menu tidak bisa dibuka" description={error instanceof ApiError ? error.message : String(error)} />
      ) : data?.singleton ? (
        <SingletonForm key={JSON.stringify(rows[0])} routerId={routerId} path={path} row={rows[0]} canWrite={canWrite} onSaved={refresh} />
      ) : !rows.length ? (
        <EmptyState icon={<Compass className="size-6" />} title="Belum ada item" description="Menu ini kosong di router." action={canWrite && <Button onClick={() => setEditing('new')}>Tambah item</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-6"></th>
                {visible.map((c) => (
                  <th key={c} className="font-mono normal-case">
                    {c}
                  </th>
                ))}
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r['.id'] ?? JSON.stringify(r)} className={clsx(r.disabled === 'true' && 'opacity-50')}>
                  <td>
                    {r.dynamic === 'true' && <Badge tone="blue">D</Badge>}
                    {r.invalid === 'true' && <Badge tone="red">I</Badge>}
                  </td>
                  {visible.map((c) => (
                    <td key={c} className="max-w-[260px] truncate font-mono text-xs" title={r[c]}>
                      {r[c] ?? ''}
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <IconButton title={canWrite ? 'Ubah semua properti' : 'Lihat semua properti'} onClick={() => setEditing(r)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    {canWrite && r['.id'] && r.disabled !== undefined && (
                      <IconButton title={r.disabled === 'true' ? 'Aktifkan' : 'Nonaktifkan'} onClick={() => act(r, r.disabled === 'true' ? 'enable' : 'disable')}>
                        {r.disabled === 'true' ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
                      </IconButton>
                    )}
                    {canWrite && r['.id'] && (
                      <IconButton title="Hapus" tone="danger" onClick={() => act(r, 'remove')}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ItemModal routerId={routerId} path={path} row={editing === 'new' ? null : editing} keys={cols} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void refresh())} />}
    </Card>
  );
}

function Inner({ routerId }: { routerId: number }) {
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const [typed, setTyped] = useState(path);
  const [filter, setFilter] = useState('');
  const open = (p: string) => {
    const clean = p.trim().replace(/\s+/g, '/').replace(/\/+$/, '');
    if (!clean) return;
    const v = clean.startsWith('/') ? clean : '/' + clean;
    setTyped(v);
    setParams({ path: v });
  };
  const f = filter.toLowerCase();
  const groups = CATALOG.map((g) => ({ ...g, items: g.items.filter(([p, l]) => !f || p.includes(f) || l.toLowerCase().includes(f)) })).filter((g) => g.items.length);
  const current = ALL_ITEMS.find((i) => i.path === path);

  return (
    <div className="space-y-4">
      <PageHeader title="Semua Menu Router" subtitle="Buka dan atur menu RouterOS apa pun langsung dari MIKROTAL, termasuk yang belum punya halaman khusus" icon={<Compass className="size-5" />} />
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="space-y-3 p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              open(typed);
            }}
            className="flex gap-2"
          >
            <Input className="font-mono text-xs" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="/ip/firewall/raw" />
            <Button type="submit" size="sm">
              Buka
            </Button>
          </form>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <Input className="h-8 pl-8 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cari menu..." />
          </div>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">{g.group}</p>
                {g.items.map(([p, l]) => (
                  <button key={p} type="button" onClick={() => open(p)} className={clsx('block w-full rounded-lg px-2 py-1 text-left text-xs transition', path === p ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                    {l}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>
        {path ? (
          <div className="min-w-0 space-y-2">
            {current && (
              <p className="text-xs text-muted">
                {current.group} › <b className="text-fg">{current.label}</b>
              </p>
            )}
            <MenuView key={path} routerId={routerId} path={path} />
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<Compass className="size-6" />}
              title="Pilih menu di kiri"
              description="Atau ketik path RouterOS, misalnya /interface/ovpn-server/server atau /queue/tree. Semua properti bisa diubah persis seperti di Winbox. Perubahan langsung terkirim ke router dan tercatat di Audit Log."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

export default function RouterMenu() {
  return <RequireRouter>{(routerId) => <Inner key={routerId} routerId={routerId} />}</RequireRouter>;
}
