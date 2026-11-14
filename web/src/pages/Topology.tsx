import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, MapPin, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TopoCustomer, TopoOdc, TopoOdp, Topology } from '../lib/pppoe';
import { RequireRouter } from '../components/RequireRouter';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, useAction, useFeedback } from '../components/ui';

type PortState = 'online' | 'offline' | 'isolated' | 'disabled' | 'empty';

const PORT_STYLE: Record<PortState, string> = {
  online: 'bg-emerald-500 text-white border-emerald-600',
  offline: 'bg-rose-500 text-white border-rose-600',
  isolated: 'bg-amber-400 text-amber-950 border-amber-500',
  disabled: 'bg-slate-400 text-white border-slate-500',
  empty: 'border-dashed border-line text-subtle bg-transparent',
};
const PORT_LABEL: Record<PortState, string> = { online: 'Online', offline: 'Offline', isolated: 'Terisolir', disabled: 'Nonaktif', empty: 'Kosong' };

function stateOf(c: TopoCustomer | undefined): PortState {
  if (!c) return 'empty';
  if (c.status === 'disabled') return 'disabled';
  if (c.status === 'isolated') return 'isolated';
  return c.online ? 'online' : 'offline';
}

function OdcModal({ routerId, odc, onClose }: { routerId: number; odc?: TopoOdc; onClose: () => void }) {
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: odc?.name ?? '', location: odc?.location ?? '', ports: String(odc?.ports ?? 12), note: odc?.note ?? '' });
  const save = async () => {
    const body = { routerId, ...f, ports: Number(f.ports) };
    const r = await run(() => (odc ? put(`/api/odcs/${odc.id}`, body) : post('/api/odcs', body)), 'ODC disimpan');
    if (r) {
      void qc.invalidateQueries({ queryKey: ['topology'] });
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={odc ? `Ubah ${odc.name}` : 'ODC baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nama ODC" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ODC-01" autoFocus />
        </Field>
        <Field label="Lokasi">
          <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Depan pos ronda RW 05" />
        </Field>
        <Field label="Jumlah port keluaran" hint="Jumlah ODP yang bisa dilayani ODC ini">
          <Input type="number" min={1} max={288} value={f.ports} onChange={(e) => setF({ ...f, ports: e.target.value })} />
        </Field>
        <Field label="Catatan">
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="mis. splitter 1:8, core biru" />
        </Field>
      </div>
    </Modal>
  );
}

function OdpModal({ routerId, odp, odcId, topo, onClose }: { routerId: number; odp?: TopoOdp; odcId?: number; topo: Topology; onClose: () => void }) {
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: odp?.name ?? '',
    location: odp?.location ?? '',
    ports: String(odp?.ports ?? 8),
    note: odp?.note ?? '',
    odcId: odp?.odc_id ?? odcId ?? (null as number | null),
    odcPort: odp?.odc_port ?? (null as number | null),
  });
  const odc = topo.odcs.find((d) => d.id === f.odcId);
  const taken = new Map(odc?.odps.filter((o) => o.id !== odp?.id && o.odc_port).map((o) => [o.odc_port!, o.name]));
  const save = async () => {
    const body = { routerId, ...f, ports: Number(f.ports) };
    const r = await run(() => (odp ? put(`/api/odps/${odp.id}`, body) : post('/api/odps', body)), 'ODP disimpan');
    if (r) {
      void qc.invalidateQueries({ queryKey: ['topology'] });
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={odp ? `Ubah ${odp.name}` : 'ODP baru'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama ODP" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ODP-01A" autoFocus />
        </Field>
        <Field label="Jumlah port pelanggan">
          <Select value={f.ports} onChange={(e) => setF({ ...f, ports: e.target.value })}>
            {[2, 4, 8, 16, 24, 32, 48, 64].map((n) => (
              <option key={n} value={n}>
                {n} port
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lokasi" className="sm:col-span-2">
          <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Tiang Gang Mawar" />
        </Field>
        <Field label="Terhubung ke ODC">
          <Select value={f.odcId ?? ''} onChange={(e) => setF({ ...f, odcId: e.target.value ? Number(e.target.value) : null, odcPort: null })}>
            <option value="">— langsung dari server —</option>
            {topo.odcs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.used}/{d.ports} terpakai)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Port ODC">
          <Select value={f.odcPort ?? ''} disabled={!odc} onChange={(e) => setF({ ...f, odcPort: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {odc &&
              Array.from({ length: odc.ports }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p} disabled={taken.has(p)}>
                  Port {p}
                  {taken.has(p) ? ` — ${taken.get(p)}` : ''}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Catatan" className="sm:col-span-2">
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="mis. splitter 1:8, redaman -19 dBm" />
        </Field>
      </div>
    </Modal>
  );
}

function OdpCard({ odp, write, onEdit, onDelete }: { odp: TopoOdp; write: boolean; onEdit: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  const byPort = new Map(odp.customers.filter((c) => c.odp_port).map((c) => [c.odp_port!, c]));
  const noPort = odp.customers.filter((c) => !c.odp_port);
  return (
    <div className={clsx('rounded-xl border p-3', odp.down ? 'border-rose-500/60 bg-rose-500/5' : 'border-line bg-surface-2/50')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            {odp.name}
            {odp.odc_port && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">ODC port {odp.odc_port}</span>}
          </p>
          {odp.location && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
              <MapPin className="size-3 shrink-0" /> {odp.location}
            </p>
          )}
        </div>
        {write && (
          <div className="flex shrink-0">
            <IconButton title="Ubah ODP" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton title="Hapus ODP" tone="danger" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        )}
      </div>
      {odp.down && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          <AlertTriangle className="size-3.5" /> Semua pelanggan offline — periksa kabel/ODP
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: odp.ports }, (_, i) => i + 1).map((p) => {
          const c = byPort.get(p);
          const st = stateOf(c);
          return (
            <button
              key={p}
              type="button"
              disabled={!c}
              title={c ? `Port ${p}: ${c.name} (${c.username}) — ${PORT_LABEL[st]}` : `Port ${p}: kosong`}
              onClick={() => c && navigate(`/customers?id=${c.id}`)}
              className={clsx('flex size-8 items-center justify-center rounded-md border text-[11px] font-bold tabular-nums transition', PORT_STYLE[st], c && 'hover:scale-110')}
            >
              {p}
            </button>
          );
        })}
      </div>
      <div className="mt-3 space-y-1">
        {[...byPort.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([p, c]) => (
            <Link key={c.id} to={`/customers?id=${c.id}`} className="flex items-center gap-2 text-xs hover:underline">
              <span className={clsx('size-2 shrink-0 rounded-full', PORT_STYLE[stateOf(c)].split(' ')[0])} />
              <span className="w-5 shrink-0 tabular-nums text-subtle">{p}</span>
              <span className="truncate">{c.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-subtle">{c.package_name ?? ''}</span>
            </Link>
          ))}
        {noPort.map((c) => (
          <Link key={c.id} to={`/customers?id=${c.id}`} className="flex items-center gap-2 text-xs hover:underline">
            <span className={clsx('size-2 shrink-0 rounded-full', PORT_STYLE[stateOf(c)].split(' ')[0])} />
            <span className="w-5 shrink-0 text-subtle">?</span>
            <span className="truncate">{c.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-amber-500">port belum diisi</span>
          </Link>
        ))}
      </div>
      <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
        {odp.used}/{odp.ports} port terpakai • {odp.online} online • {odp.ports - byPort.size} kosong
      </p>
    </div>
  );
}

function Inner({ routerId, routerName }: { routerId: number; routerName: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const write = can('customer.write');
  const [modal, setModal] = useState<{ type: 'odc'; odc?: TopoOdc } | { type: 'odp'; odp?: TopoOdp; odcId?: number } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['topology', routerId], queryFn: () => get<Topology>('/api/topology', { routerId }), refetchInterval: 20000 });

  const removeOdc = async (d: TopoOdc) => {
    if (!(await confirm({ title: `Hapus ${d.name}?`, message: `${d.odps.length} ODP di bawahnya tidak ikut terhapus, hanya dilepas dari ODC ini.`, danger: true, confirmText: 'Hapus ODC' }))) return;
    await run(() => del(`/api/odcs/${d.id}`), 'ODC dihapus');
    void qc.invalidateQueries({ queryKey: ['topology'] });
  };
  const removeOdp = async (o: TopoOdp) => {
    if (!(await confirm({ title: `Hapus ${o.name}?`, message: `${o.used} pelanggan di ODP ini tidak terhapus, hanya dilepas dari ODP.`, danger: true, confirmText: 'Hapus ODP' }))) return;
    await run(() => del(`/api/odps/${o.id}`), 'ODP dihapus');
    void qc.invalidateQueries({ queryKey: ['topology'] });
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };

  const allOdps = data ? [...data.odcs.flatMap((d) => d.odps), ...data.looseOdps] : [];
  const totalPorts = allOdps.reduce((n, o) => n + o.ports, 0);
  const used = allOdps.reduce((n, o) => n + o.used, 0);
  const down = allOdps.filter((o) => o.down);

  return (
    <div>
      <PageHeader
        title="Topologi ODC / ODP"
        subtitle={`Jalur fiber dari ${routerName} ke rumah pelanggan, lengkap dengan status tiap port`}
        icon={<Network className="size-5" />}
        actions={
          write && (
            <>
              <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setModal({ type: 'odp' })}>
                ODP baru
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ type: 'odc' })}>
                ODC baru
              </Button>
            </>
          )
        }
      />
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data.odcs.length && !data.looseOdps.length ? (
        <Card>
          <EmptyState
            icon={<Boxes className="size-6" />}
            title="Belum ada ODC / ODP"
            description="Catat ODC dan ODP jaringan Anda, lalu tempatkan pelanggan pada port ODP. Jika semua pelanggan di satu ODP mati bersamaan, Anda langsung tahu titik gangguannya."
            action={write && <Button onClick={() => setModal({ type: 'odc' })}>Tambah ODC pertama</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <span>
              <b className="text-fg">{data.odcs.length}</b> ODC
            </span>
            <span>
              <b className="text-fg">{allOdps.length}</b> ODP
            </span>
            <span>
              <b className="text-fg">
                {used}/{totalPorts}
              </b>{' '}
              port terpakai
            </span>
            {down.length > 0 && <Badge tone="red">{down.length} ODP mati total</Badge>}
            <span className="ml-auto flex flex-wrap items-center gap-3">
              {(Object.keys(PORT_LABEL) as PortState[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={clsx('size-3 rounded border', PORT_STYLE[s])} /> {PORT_LABEL[s]}
                </span>
              ))}
            </span>
          </div>

          {data.odcs.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 text-base font-bold">
                    <Boxes className="size-4 text-cyan-500" /> {d.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {d.location && `${d.location} • `}
                    {d.used}/{d.ports} port ODC terpakai • {d.customers} pelanggan • {d.online} online
                    {d.note && ` • ${d.note}`}
                  </p>
                </div>
                {write && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setModal({ type: 'odp', odcId: d.id })}>
                      ODP
                    </Button>
                    <IconButton title="Ubah ODC" onClick={() => setModal({ type: 'odc', odc: d })}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton title="Hapus ODC" tone="danger" onClick={() => removeOdc(d)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )}
              </div>
              {d.odps.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.odps.map((o) => (
                    <OdpCard key={o.id} odp={o} write={write} onEdit={() => setModal({ type: 'odp', odp: o })} onDelete={() => removeOdp(o)} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">Belum ada ODP di ODC ini.</p>
              )}
            </Card>
          ))}

          {data.looseOdps.length > 0 && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold">ODP tanpa ODC</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.looseOdps.map((o) => (
                  <OdpCard key={o.id} odp={o} write={write} onEdit={() => setModal({ type: 'odp', odp: o })} onDelete={() => removeOdp(o)} />
                ))}
              </div>
            </Card>
          )}

          {data.unassigned.length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-bold">{data.unassigned.length} pelanggan belum ditempatkan di ODP</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.unassigned.slice(0, 60).map((c) => (
                  <Link key={c.id} to={`/customers?id=${c.id}`}>
                    <Badge tone={stateOf(c) === 'online' ? 'green' : stateOf(c) === 'isolated' ? 'yellow' : stateOf(c) === 'disabled' ? 'gray' : 'red'} dot>
                      {c.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      {modal?.type === 'odc' && <OdcModal routerId={routerId} odc={modal.odc} onClose={() => setModal(null)} />}
      {modal?.type === 'odp' && data && <OdpModal routerId={routerId} odp={modal.odp} odcId={modal.odcId} topo={data} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function TopologyPage() {
  return <RequireRouter>{(routerId, router) => <Inner key={routerId} routerId={routerId} routerName={router.name} />}</RequireRouter>;
}
