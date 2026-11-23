import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { res } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, humanDuration, parseDuration } from '../lib/format';
import type { ColumnDef, FieldDef, ResourceDef } from '../resources';
import { ExtraProps, PropInput, useAllProps } from './RosProperties';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, SearchInput, Select, Textarea, Toggle, useAction, useFeedback } from './ui';

type Row = Record<string, string>;

export function renderCell(col: ColumnDef, row: Row): ReactNode {
  const v = row[col.key];
  switch (col.render) {
    case 'bool':
      return v === 'true' ? <CheckCircle2 className="size-4 text-emerald-500" /> : <span className="text-subtle">—</span>;
    case 'running':
      return v === 'true' ? (
        <Badge tone="green" dot>
          up
        </Badge>
      ) : (
        <Badge tone="red" dot>
          down
        </Badge>
      );
    case 'bytes':
      return v ? <span className="tabular-nums">{formatBytes(v)}</span> : <span className="text-subtle">—</span>;
    case 'mono':
      return v ? <span className="font-mono text-xs">{v}</span> : <span className="text-subtle">—</span>;
    case 'duration':
      return v ? <span className="tabular-nums">{humanDuration(parseDuration(v))}</span> : <span className="text-subtle">—</span>;
    case 'tags':
      return v ? <Badge tone="violet">{v}</Badge> : <span className="text-subtle">—</span>;
    case 'status': {
      if (!v) return <span className="text-subtle">—</span>;
      const tone = /bound|allow|accept|bypassed|running|true/.test(v) ? 'green' : /block|deny|drop|reject|false|waiting/.test(v) ? 'red' : 'blue';
      return <Badge tone={tone}>{v}</Badge>;
    }
    default:
      return v ? <span className="break-words">{v}</span> : <span className="text-subtle">—</span>;
  }
}

function useSourceOptions(routerId: number, fields: FieldDef[], enabled: boolean) {
  const paths = [...new Set(fields.filter((f) => f.source).map((f) => f.source!.path))];
  const results = useQuery({
    queryKey: ['res-sources', routerId, paths.join('|')],
    queryFn: async () => {
      const out: Record<string, Row[]> = {};
      await Promise.all(
        paths.map(async (p) => {
          try {
            out[p] = await res.list(routerId, p);
          } catch {
            out[p] = [];
          }
        }),
      );
      return out;
    },
    enabled: enabled && paths.length > 0,
    staleTime: 30000,
  });
  return results.data ?? {};
}

export function ResourceForm({
  def,
  routerId,
  initial,
  onClose,
  onSaved,
}: {
  def: ResourceDef;
  routerId: number;
  initial: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.['.id'];
  const fields = def.fields.filter((f) => !(isEdit && f.createOnly));
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of fields) {
      const cur = initial?.[f.name];
      if (f.type === 'bool') v[f.name] = cur === 'true' || cur === 'yes';
      else if (f.type === 'password') v[f.name] = '';
      else v[f.name] = cur ?? '';
    }
    return v;
  });
  const sources = useSourceOptions(routerId, fields, true);
  const { run, busy } = useAction();
  const fieldNames = useMemo(() => new Set(def.fields.map((f) => f.name)), [def.fields]);
  const adv = useAllProps(isEdit ? initial : null, fieldNames);
  const [showAdv, setShowAdv] = useState(false);
  const suggestions = useMemo(() => Object.keys(initial ?? {}).filter((k) => !k.startsWith('.')), [initial]);

  const save = async () => {
    const body: Record<string, string | boolean> = {};
    for (const f of fields) {
      const val = values[f.name];
      if (f.type === 'password' && !val) continue;
      if (isEdit && f.readOnlyOnEdit) continue;
      if (!isEdit && (val === '' || val === undefined)) continue;
      if (isEdit && f.type !== 'bool' && (initial?.[f.name] ?? '') === val) continue;
      if (isEdit && f.type === 'bool' && (initial?.[f.name] === 'true') === val) continue;
      body[f.name] = val;
    }
    for (const f of fields) {
      if (f.required && !isEdit && !values[f.name]) {
        throw new Error(`${f.label} wajib diisi`);
      }
    }
    // properti lanjutan (semua setelan lain dari router) ikut dikirim bila diubah
    for (const [k, v] of Object.entries(adv.changed())) if (!(k in body)) body[k] = v;
    if (isEdit && !Object.keys(body).length) return true;
    if (isEdit) await res.set(routerId, def.path, initial!['.id'], body);
    else await res.add(routerId, def.path, body);
    return true;
  };

  const options = (f: FieldDef): { value: string; label: string }[] => {
    const base: { value: string; label: string }[] = [];
    if (f.source) {
      if (f.source.allowEmpty || !f.required) base.push({ value: '', label: '— pilih —' });
      for (const e of f.source.extra ?? []) base.push({ value: e, label: e });
      for (const r of sources[f.source.path] ?? []) {
        const v = r[f.source.key ?? 'name'];
        if (v && !base.some((b) => b.value === v)) base.push({ value: v, label: v });
      }
      const cur = String(values[f.name] ?? '');
      if (cur && !base.some((b) => b.value === cur)) base.push({ value: cur, label: cur });
      return base;
    }
    return (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o || '— pilih —' } : o));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Ubah ${def.title}` : `Tambah ${def.title}`}
      size={fields.length > 8 ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={async () => (await run(save, isEdit ? 'Perubahan disimpan' : 'Item ditambahkan')) !== undefined && onSaved()}>
            Simpan
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await run(save, 'Tersimpan')) !== undefined) onSaved();
        }}
      >
        {fields.map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint} required={f.required && !isEdit} className={clsx((f.full || f.type === 'textarea') && 'sm:col-span-2')}>
            {f.type === 'select' ? (
              <Select value={String(values[f.name] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} disabled={isEdit && f.readOnlyOnEdit}>
                {options(f).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === 'bool' ? (
              <div className="pt-1">
                <Toggle checked={!!values[f.name]} onChange={(b) => setValues((v) => ({ ...v, [f.name]: b }))} />
              </div>
            ) : f.type === 'textarea' ? (
              <Textarea rows={5} value={String(values[f.name] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} placeholder={f.placeholder} />
            ) : (
              <Input
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={String(values[f.name] ?? '')}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.type === 'password' && isEdit ? '(tidak diubah)' : f.placeholder}
                disabled={isEdit && f.readOnlyOnEdit}
                autoComplete="off"
              />
            )}
          </Field>
        ))}
        <div className="border-t border-line pt-3 sm:col-span-2">
          <button type="button" className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg" onClick={() => setShowAdv((v) => !v)}>
            {showAdv ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {isEdit ? `Semua properti lain dari router (${adv.keys.length})` : 'Properti tambahan'}
          </button>
          {showAdv && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-subtle">Nama dan nilai persis seperti di Winbox/terminal RouterOS. Hanya properti yang diubah yang dikirim ke router.</p>
              {isEdit && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {adv.keys.map((k) => (
                    <label key={k} className="block">
                      <span className="mb-1 block font-mono text-[11px] text-muted">{k}</span>
                      <PropInput name={k} value={adv.vals[k] ?? ''} original={initial?.[k]} onChange={(v) => adv.setVals((x) => ({ ...x, [k]: v }))} />
                    </label>
                  ))}
                </div>
              )}
              <ExtraProps rows={adv.extra} onChange={adv.setExtra} suggestions={suggestions} />
            </div>
          )}
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export function ResourceTable({ def, routerId, toolbar }: { def: ResourceDef; routerId: number; toolbar?: ReactNode }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const { run } = useAction();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const writable = can(def.group === 'hotspot' ? 'hotspot.write' : 'config.write');
  const queryKey = ['res', routerId, def.path];

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => res.list(routerId, def.path),
    refetchInterval: def.autoRefresh,
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    const keys = def.searchKeys ?? def.columns.map((c) => c.key);
    return list.filter((r) => keys.some((k) => (r[k] ?? '').toLowerCase().includes(s)));
  }, [data, search, def]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['res', routerId] });

  const remove = async (row: Row) => {
    const label = row.name ?? row.address ?? row['mac-address'] ?? row.user ?? row['.id'];
    if (!(await confirm({ title: `${def.deleteLabel ?? 'Hapus'} item?`, message: <>Item <b>{label}</b> akan {def.deleteLabel ? 'diputus' : 'dihapus dari router'}.</>, danger: true, confirmText: def.deleteLabel ?? 'Hapus' }))) return;
    await run(() => res.remove(routerId, def.path, row['.id']), def.deleteLabel ? 'Sesi diputus' : 'Item dihapus');
    void refresh();
  };

  const toggle = async (row: Row) => {
    const action = row.disabled === 'true' ? 'enable' : 'disable';
    await run(() => res.action(routerId, def.path, row['.id'], action), action === 'enable' ? 'Diaktifkan' : 'Dinonaktifkan');
    void refresh();
  };

  const extra = async (row: Row, a: { action: string; label: string; confirm?: string }) => {
    if (a.confirm && !(await confirm({ title: a.label, message: a.confirm }))) return;
    await run(() => res.action(routerId, def.path, row['.id'], a.action), `${a.label} berhasil`);
    void refresh();
  };

  const bulk = async (action: 'remove' | 'enable' | 'disable') => {
    const ids = [...selected];
    if (action === 'remove' && !(await confirm({ title: `Hapus ${ids.length} item?`, message: 'Item terpilih akan dihapus dari router.', danger: true, confirmText: 'Hapus semua' }))) return;
    await run(() => res.bulk(routerId, def.path, action, ids), `${ids.length} item diproses`);
    setSelected(new Set());
    void refresh();
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r['.id']));
  const showActions = writable && (def.canEdit || def.canDelete || def.canToggle || def.extraActions?.length);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} />
          <span className="text-xs text-muted">{rows.length} item</span>
          {selected.size > 0 && writable && (
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-1">
              <span className="px-2 text-xs font-medium">{selected.size} dipilih</span>
              {def.canToggle && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => bulk('enable')}>
                    Aktifkan
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => bulk('disable')}>
                    Nonaktifkan
                  </Button>
                </>
              )}
              {def.canDelete && (
                <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => bulk('remove')}>
                  Hapus
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <Button size="sm" variant="secondary" icon={<RefreshCw className={clsx('size-3.5', isFetching && 'animate-spin')} />} onClick={() => refetch()}>
            Muat ulang
          </Button>
          {def.canAdd && writable && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Tambah
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState title={search ? 'Tidak ada hasil' : 'Belum ada data'} description={search ? 'Coba kata kunci lain.' : def.description} />
      ) : (
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="table-base">
            <thead>
              <tr>
                {writable && (def.canDelete || def.canToggle) && (
                  <th className="w-8">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r['.id'])))} />
                  </th>
                )}
                {def.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {showActions && <th className="text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row['.id']} className={clsx(row.disabled === 'true' && 'row-disabled')}>
                  {writable && (def.canDelete || def.canToggle) && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row['.id'])}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(row['.id'])) n.delete(row['.id']);
                            else n.add(row['.id']);
                            return n;
                          })
                        }
                      />
                    </td>
                  )}
                  {def.columns.map((c, i) => (
                    <td key={c.key} className={clsx(c.className, i === 0 && 'font-medium')}>
                      {renderCell(c, row)}
                      {i === 0 && (row.dynamic === 'true' || row.disabled === 'true' || row.invalid === 'true') && (
                        <span className="ml-1.5 inline-flex gap-1">
                          {row.disabled === 'true' && <Badge tone="gray">nonaktif</Badge>}
                          {row.dynamic === 'true' && def.columns.every((x) => x.key !== 'dynamic') && <Badge tone="blue">D</Badge>}
                          {row.invalid === 'true' && <Badge tone="red">invalid</Badge>}
                        </span>
                      )}
                    </td>
                  ))}
                  {showActions && (
                    <td className="whitespace-nowrap text-right">
                      {def.extraActions?.map((a) => (
                        <IconButton key={a.action} title={a.label} onClick={() => extra(row, a)}>
                          {a.action === 'run' ? <Play className="size-4" /> : <RefreshCw className="size-4" />}
                        </IconButton>
                      ))}
                      {def.canToggle && (
                        <IconButton title={row.disabled === 'true' ? 'Aktifkan' : 'Nonaktifkan'} tone={row.disabled === 'true' ? 'success' : 'default'} onClick={() => toggle(row)}>
                          {row.disabled === 'true' ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
                        </IconButton>
                      )}
                      {def.canEdit && (
                        <IconButton title="Ubah" onClick={() => setEditing(row)}>
                          <Pencil className="size-4" />
                        </IconButton>
                      )}
                      {def.canDelete && (
                        <IconButton title={def.deleteLabel ?? 'Hapus'} tone="danger" onClick={() => remove(row)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && (
        <ResourceForm
          def={def}
          routerId={routerId}
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}
