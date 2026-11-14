import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, LocateFixed, MapPin, X } from 'lucide-react';
import clsx from 'clsx';
import { HEALTH_COLOR, type MapLine, type MapNode } from '../lib/fibermap';
import { mapsLink, parseCoord } from '../lib/pppoe';
import { Button, Input } from './ui';

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
/** Titik tengah Indonesia, dipakai saat belum ada koordinat sama sekali. */
const DEFAULT_CENTER: [number, number] = [-2.5, 118];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function nodeIcon(n: MapNode, selected: boolean) {
  const color = HEALTH_COLOR[n.health];
  const size = n.kind === 'server' ? 26 : n.kind === 'odc' ? 22 : n.kind === 'odp' ? 16 : 10;
  const radius = n.kind === 'server' ? '6px' : n.kind === 'odc' ? '5px' : '50%';
  const letter = n.kind === 'server' ? 'S' : n.kind === 'odc' ? 'C' : '';
  const ring = selected ? `box-shadow:0 0 0 4px ${color}55,0 1px 4px #0006;` : 'box-shadow:0 1px 4px #0006;';
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:${color};border:2px solid #fff;${ring}display:flex;align-items:center;justify-content:center;color:#fff;font:700 11px system-ui">${letter}</div>`,
  });
}

function useLeaflet(height: number) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: DEFAULT_CENTER, zoom: 5, attributionControl: true, zoomControl: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    setMap(m);
    const t = setTimeout(() => m.invalidateSize(), 150);
    return () => {
      clearTimeout(t);
      m.remove();
      setMap(null);
    };
  }, []);
  useEffect(() => {
    map?.invalidateSize();
  }, [map, height]);
  return { el, map };
}

/** Peta jalur fiber: server, ODC, ODP, pelanggan, dan garis penghubung berwarna menurut kondisi. */
export function FiberMap({ nodes, lines, height = 420, focus, className }: { nodes: MapNode[]; lines: MapLine[]; height?: number; focus?: { from: [number, number] | null; to: [number, number] | null; key: string } | null; className?: string }) {
  const { el, map } = useLeaflet(height);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef('');

  useEffect(() => {
    if (!map) return;
    layer.current?.remove();
    const g = L.layerGroup().addTo(map);
    layer.current = g;
    for (const l of lines) {
      const bad = l.health === 'fault' || l.health === 'suspect';
      L.polyline([l.from, l.to], { color: HEALTH_COLOR[l.health], weight: bad ? 5 : 3, opacity: bad ? 0.95 : 0.75, dashArray: l.health === 'fault' ? '2 10' : l.health === 'dark' || l.health === 'unknown' ? '6 8' : undefined })
        .bindTooltip(esc(l.detail), { sticky: true })
        .addTo(g);
    }
    for (const n of nodes) {
      const mk = L.marker([n.lat, n.lng], { icon: nodeIcon(n, false), zIndexOffset: n.kind === 'customer' ? 0 : n.kind === 'odp' ? 200 : 400 }).addTo(g);
      mk.bindPopup(`<b>${esc(n.label)}</b><br>${esc(n.detail)}<br><a href="${mapsLink(n.lat, n.lng)}" target="_blank" rel="noreferrer">Buka di Google Maps</a>`);
      if (n.kind !== 'customer') mk.bindTooltip(esc(n.label), { permanent: true, direction: 'top', offset: [0, -10], className: 'fiber-label' });
    }
    // Sesuaikan tampilan hanya saat kumpulan titik berubah, bukan tiap penyegaran status
    const sig = nodes.map((n) => `${n.id}:${n.lat},${n.lng}`).join('|');
    if (sig !== fitted.current && nodes.length) {
      fitted.current = sig;
      map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lng] as [number, number])).pad(0.25), { maxZoom: 17 });
    }
  }, [map, nodes, lines]);

  const all = useRef(nodes);
  all.current = nodes;
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (!focus) {
      // fokus dilepas (mis. setelah scan baru): kembali menampilkan seluruh jaringan
      if (hadFocus.current && all.current.length) map.fitBounds(L.latLngBounds(all.current.map((n) => [n.lat, n.lng] as [number, number])).pad(0.25), { maxZoom: 17 });
      hadFocus.current = false;
      return;
    }
    hadFocus.current = true;
    const pts = [focus.from, focus.to].filter(Boolean) as [number, number][];
    if (pts.length === 2) map.fitBounds(L.latLngBounds(pts).pad(0.6), { maxZoom: 18 });
    else if (pts.length === 1) map.setView(pts[0], 17);
  }, [map, focus]);

  return <div ref={el} className={clsx('relative isolate z-0 w-full overflow-hidden rounded-xl border border-line bg-surface-2', className)} style={{ height }} />;
}

/** Input koordinat: ketik/tempel, ambil lokasi perangkat, atau klik di peta. */
export function LocationPicker({ value, onChange, label = 'Lokasi (koordinat)', hint }: { value: { lat: number | null; lng: number | null }; onChange: (v: { lat: number | null; lng: number | null }) => void; label?: string; hint?: string }) {
  const has = value.lat != null && value.lng != null;
  const [text, setText] = useState(has ? `${value.lat}, ${value.lng}` : '');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [locating, setLocating] = useState(false);

  const apply = (lat: number, lng: number) => {
    const v = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    setText(`${v.lat}, ${v.lng}`);
    setMsg('');
    onChange(v);
  };
  const onText = (t: string) => {
    setText(t);
    if (!t.trim()) {
      setMsg('');
      onChange({ lat: null, lng: null });
      return;
    }
    const c = parseCoord(t);
    if (c) {
      setMsg('');
      onChange(c);
    } else setMsg('Format belum dikenali. Contoh: -6.200000, 106.816666 atau tempel tautan Google Maps.');
  };
  const locate = () => {
    if (!navigator.geolocation) return setMsg('Perangkat ini tidak mendukung lokasi.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        apply(p.coords.latitude, p.coords.longitude);
        setOpen(true);
      },
      (e) => {
        setLocating(false);
        setMsg(e.code === e.PERMISSION_DENIED ? 'Izin lokasi ditolak. Izinkan akses lokasi di browser.' : 'Lokasi tidak didapat. Browser hanya memberi lokasi lewat HTTPS atau localhost; ketik koordinat atau pilih di peta.');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <Input className="font-mono" value={text} onChange={(e) => onText(e.target.value)} placeholder="-6.200000, 106.816666" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={locating} icon={<LocateFixed className="size-3.5" />} onClick={locate}>
          Lokasi saya
        </Button>
        <Button type="button" size="sm" variant="secondary" icon={<MapPin className="size-3.5" />} onClick={() => setOpen((o) => !o)}>
          {open ? 'Tutup peta' : 'Pilih di peta'}
        </Button>
        {has && (
          <>
            <a href={mapsLink(value.lat!, value.lng!)} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-1 text-xs font-medium text-brand hover:underline">
              <ExternalLink className="size-3.5" /> Google Maps
            </a>
            <button type="button" title="Hapus koordinat" className="text-subtle hover:text-rose-500" onClick={() => onText('')}>
              <X className="size-4" />
            </button>
          </>
        )}
      </div>
      {msg ? (
        <span className="mt-1 block text-[11px] text-rose-500">{msg}</span>
      ) : (
        <span className="mt-1 block text-[11px] text-subtle">{hint ?? 'Ketik "lat, lng", tempel tautan Google Maps, pakai lokasi HP saat di lapangan, atau klik di peta'}</span>
      )}
      {open && <PickerMap value={value} onPick={apply} />}
    </div>
  );
}

function PickerMap({ value, onPick }: { value: { lat: number | null; lng: number | null }; onPick: (lat: number, lng: number) => void }) {
  const { el, map } = useLeaflet(240);
  const marker = useRef<L.Marker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const centered = useRef(false);

  useEffect(() => {
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => pick.current(e.latlng.lat, e.latlng.lng);
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (value.lat == null || value.lng == null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const pos: [number, number] = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(pos, {
        draggable: true,
        icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div style="width:22px;height:22px;border-radius:50%;background:#06b6d4;border:3px solid #fff;box-shadow:0 1px 6px #0008"></div>' }),
      }).addTo(map);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        pick.current(p.lat, p.lng);
      });
    } else marker.current.setLatLng(pos);
    if (!centered.current || !map.getBounds().contains(pos)) {
      centered.current = true;
      map.setView(pos, Math.max(map.getZoom(), 16));
    }
  }, [map, value.lat, value.lng]);

  return (
    <div className="mt-2">
      <div ref={el} className="relative isolate z-0 w-full overflow-hidden rounded-xl border border-line bg-surface-2" style={{ height: 240, cursor: 'crosshair' }} />
      <p className="mt-1 text-[11px] text-subtle">Klik pada peta untuk menaruh titik, atau geser titiknya.</p>
    </div>
  );
}

export function MapLegend({ customers }: { customers?: boolean }) {
  const item = (color: string, label: string, dashed = false) => (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-0 w-5 border-t-[3px]" style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }} /> {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {item(HEALTH_COLOR.ok, 'Normal')}
      {item(HEALTH_COLOR.fault, 'Diduga putus', true)}
      {item(HEALTH_COLOR.suspect, 'Perlu dicek')}
      {item(HEALTH_COLOR.dark, 'Tanpa sinyal / belum ada data', true)}
      <span>■ S = server • ■ C = ODC • ● ODP{customers ? ' • titik kecil = rumah pelanggan' : ''}</span>
    </div>
  );
}
