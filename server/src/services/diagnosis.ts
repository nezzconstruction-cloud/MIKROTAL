/**
 * Diagnosis jalur fiber dari pola pelanggan PPPoE yang offline.
 *
 * Aplikasi tidak bisa mengukur titik putus secara fisik (itu pekerjaan OTDR / daya optik OLT).
 * Yang bisa dilakukan: membandingkan siapa saja yang mati bersamaan, lalu menunjuk segmen
 * kabel yang paling mungkin bermasalah: server → ODC (feeder), ODC → ODP (distribusi),
 * atau ODP → rumah (drop).
 */

export interface DiagPoint {
  type: 'server' | 'odc' | 'odp' | 'customer';
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface DiagCustomer {
  id: number;
  name: string;
  username: string;
  phone: string;
  status: string;
  online: number;
  on_router: number;
  odp_id: number | null;
  odp_port: number | null;
  last_seen_at: string | null;
  lat: number | null;
  lng: number | null;
}

export interface DiagOdp {
  id: number;
  odc_id: number | null;
  odc_port: number | null;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface DiagOdc {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export type FindingKind = 'server' | 'feeder' | 'distribution' | 'drop' | 'ambiguous';

export interface Finding {
  key: string;
  kind: FindingKind;
  severity: 'critical' | 'warning';
  confidence: 'tinggi' | 'sedang' | 'rendah';
  title: string;
  reason: string;
  steps: string[];
  from: DiagPoint;
  to: DiagPoint;
  distanceM: number | null;
  /** Perkiraan waktu putus: terakhir kali pelanggan terdampak terlihat online. */
  since: string | null;
  /** true bila semua pelanggan terdampak hilang pada rentang waktu yang sama. */
  simultaneous: boolean | null;
  affected: { id: number; name: string; username: string; phone: string; odp: string; port: number | null; last_seen_at: string | null; lastLog?: string }[];
}

export interface Diagnosis {
  scannedAt: string;
  totals: { customers: number; online: number; offline: number; neverOnline: number; unassignedOffline: number };
  findings: Finding[];
  /** Pelanggan yang belum pernah online: pemasangan belum selesai, tidak dianalisis. */
  neverOnline: { id: number; name: string; username: string; odp: string }[];
  /** Offline tetapi belum ditempatkan di ODP, sehingga segmennya tidak bisa ditentukan. */
  unassignedOffline: { id: number; name: string; username: string; last_seen_at: string | null }[];
}

export function distanceMeters(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
}

/** Selisih waktu terakhir online yang masih dianggap "putus bersamaan". */
const SIMULTANEOUS_MS = 5 * 60_000;

export function diagnose(input: {
  server: DiagPoint;
  odcs: DiagOdc[];
  odps: DiagOdp[];
  customers: DiagCustomer[];
  /** false bila interface PPPoE server di router terdeteksi mati. */
  serverPortRunning?: { name: string; running: boolean }[];
  now?: number;
}): Diagnosis {
  const now = input.now ?? Date.now();
  const odpById = new Map(input.odps.map((o) => [o.id, o]));
  const live = input.customers.filter((c) => c.status !== 'disabled' && c.on_router);
  const isKnown = (c: DiagCustomer) => !!c.online || !!c.last_seen_at;
  const known = live.filter(isKnown);
  const neverOnline = live.filter((c) => !isKnown(c));
  const offline = known.filter((c) => !c.online);

  const odpPoint = (o: DiagOdp): DiagPoint => ({ type: 'odp', id: o.id, name: o.name, lat: o.lat, lng: o.lng });
  const odcPoint = (d: DiagOdc): DiagPoint => ({ type: 'odc', id: d.id, name: d.name, lat: d.lat, lng: d.lng });
  const affected = (list: DiagCustomer[]) =>
    list.map((c) => ({ id: c.id, name: c.name, username: c.username, phone: c.phone, odp: c.odp_id ? odpById.get(c.odp_id)?.name ?? '' : '', port: c.odp_port, last_seen_at: c.last_seen_at }));
  const timing = (list: DiagCustomer[]) => {
    const times = list.map((c) => (c.last_seen_at ? Date.parse(c.last_seen_at) : NaN)).filter((t) => !Number.isNaN(t));
    if (!times.length) return { since: null, simultaneous: null as boolean | null };
    const max = Math.max(...times);
    return { since: new Date(max).toISOString(), simultaneous: list.length > 1 ? max - Math.min(...times) <= SIMULTANEOUS_MS : null };
  };
  const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const whenText = (t: { since: string | null; simultaneous: boolean | null }) =>
    !t.since ? '' : t.simultaneous ? ` Semuanya hilang bersamaan sekitar ${clock(t.since)}.` : t.simultaneous === false ? ` Tidak hilang bersamaan (terakhir ${clock(t.since)}), jadi bisa lebih dari satu penyebab.` : ` Terakhir online ${clock(t.since)}.`;

  const findings: Finding[] = [];
  const make = (f: Omit<Finding, 'distanceM' | 'since' | 'simultaneous' | 'affected'>, members: DiagCustomer[]) => {
    const t = timing(members);
    findings.push({ ...f, reason: f.reason + whenText(t), distanceM: distanceMeters(f.from, f.to), since: t.since, simultaneous: t.simultaneous, affected: affected(members) });
    return t;
  };

  const totals = {
    customers: live.length,
    online: known.filter((c) => c.online).length,
    offline: offline.length,
    neverOnline: neverOnline.length,
    unassignedOffline: offline.filter((c) => !c.odp_id).length,
  };
  const result = (): Diagnosis => ({
    scannedAt: new Date(now).toISOString(),
    totals,
    findings,
    neverOnline: neverOnline.map((c) => ({ id: c.id, name: c.name, username: c.username, odp: c.odp_id ? odpById.get(c.odp_id)?.name ?? '' : '' })),
    unassignedOffline: offline.filter((c) => !c.odp_id).map((c) => ({ id: c.id, name: c.name, username: c.username, last_seen_at: c.last_seen_at })),
  });

  // 1. Sisi server: interface PPPoE mati, atau seluruh pelanggan hilang
  const deadPort = input.serverPortRunning?.find((p) => !p.running);
  if (known.length >= 2 && offline.length === known.length) {
    const first = input.odcs[0] ? odcPoint(input.odcs[0]) : input.odps[0] ? odpPoint(input.odps[0]) : input.server;
    make(
      {
        key: 'server',
        kind: 'server',
        severity: 'critical',
        confidence: deadPort ? 'tinggi' : 'sedang',
        title: 'Semua pelanggan PPPoE offline',
        reason: deadPort
          ? `Interface ${deadPort.name} (PPPoE server) di router tidak aktif, dan seluruh ${known.length} pelanggan offline.`
          : `Seluruh ${known.length} pelanggan di semua ODC/ODP offline. Gangguan ada di sisi server, sebelum jalur bercabang.`,
        steps: [
          deadPort ? `Periksa kabel/SFP pada port ${deadPort.name} di router.` : 'Periksa port router yang menuju OLT/switch dan lampu link-nya.',
          'Periksa OLT atau media converter: daya listrik, lampu PON, dan alarm LOS.',
          'Periksa kabel feeder utama yang keluar dari ruang server.',
          'Pastikan layanan PPPoE server di router masih aktif (menu PPPoE Server).',
        ],
        from: input.server,
        to: first,
      },
      offline,
    );
    return result();
  }
  if (deadPort) {
    findings.push({
      key: 'server-port',
      kind: 'server',
      severity: 'critical',
      confidence: 'tinggi',
      title: `Interface ${deadPort.name} tidak aktif`,
      reason: `Interface PPPoE server ${deadPort.name} di router terdeteksi mati (running = false).`,
      steps: [`Periksa kabel/SFP pada port ${deadPort.name}.`, 'Periksa perangkat di ujung lain (OLT/switch).'],
      from: input.server,
      to: input.odcs[0] ? odcPoint(input.odcs[0]) : input.server,
      distanceM: null,
      since: null,
      simultaneous: null,
      affected: [],
    });
  }

  // 2. Kelompokkan per ODP
  const byOdp = new Map<number, DiagCustomer[]>();
  for (const c of known) if (c.odp_id && odpById.has(c.odp_id)) byOdp.set(c.odp_id, [...(byOdp.get(c.odp_id) ?? []), c]);
  const odpDown = (o: DiagOdp) => {
    const m = byOdp.get(o.id) ?? [];
    return m.length > 0 && m.every((c) => !c.online);
  };
  const covered = new Set<number>(); // ODP yang sudah dijelaskan oleh temuan feeder

  // 3. Feeder server → ODC: semua ODP berpelanggan di bawah ODC mati
  for (const d of input.odcs) {
    const children = input.odps.filter((o) => o.odc_id === d.id && (byOdp.get(o.id)?.length ?? 0) > 0);
    if (!children.length || !children.every(odpDown)) continue;
    const members = children.flatMap((o) => byOdp.get(o.id) ?? []);
    if (members.length < 2) continue; // satu pelanggan saja: ditangani sebagai temuan ambigu di bawah
    for (const o of children) covered.add(o.id);
    const many = children.length >= 2;
    make(
      {
        key: `feeder:${d.id}`,
        kind: 'feeder',
        severity: 'critical',
        confidence: many ? 'tinggi' : 'sedang',
        title: many ? `Kabel feeder ke ${d.name} diduga putus` : `Jalur ${d.name} → ${children[0].name} diduga putus`,
        reason: many
          ? `Semua ${members.length} pelanggan di ${children.length} ODP di bawah ${d.name} offline, sedangkan ODC lain normal. Titik gangguan ada sebelum splitter ${d.name}: kabel feeder dari server atau ODC itu sendiri.`
          : `Semua ${members.length} pelanggan di ${children[0].name} offline, dan itu satu-satunya ODP berpelanggan di ${d.name}. Gangguan bisa di kabel feeder ke ${d.name} atau di kabel distribusi ke ${children[0].name}.`,
        steps: [
          `Ukur daya optik di input ${d.name}. Bila tidak ada sinyal, kabel feeder dari server putus atau tertekuk.`,
          'Telusuri kabel feeder dari server: cari kabel putus, tertimpa pohon, digigit hewan, atau sambungan (joint closure) terendam air.',
          `Bila input ${d.name} normal, periksa splitter dan konektor di dalam ODC.`,
          ...(many ? [] : [`Bila output ODC normal, lanjutkan ke kabel distribusi menuju ${children[0].name}.`]),
        ],
        from: input.server,
        to: odcPoint(d),
      },
      members,
    );
  }

  // 4. Distribusi ODC → ODP, dan drop ODP → rumah
  for (const o of input.odps) {
    const members = byOdp.get(o.id) ?? [];
    if (!members.length || covered.has(o.id)) continue;
    const down = members.filter((c) => !c.online);
    if (!down.length) continue;
    const odc = o.odc_id ? input.odcs.find((d) => d.id === o.odc_id) : undefined;
    const upstream = odc ? odcPoint(odc) : input.server;
    const portText = o.odc_port ? ` (port ${o.odc_port} ${odc?.name ?? ''})`.replace(' )', ')') : '';
    if (down.length === members.length && members.length >= 2) {
      make(
        {
          key: `distribution:${o.id}`,
          kind: 'distribution',
          severity: 'critical',
          confidence: 'tinggi',
          title: `Kabel distribusi ke ${o.name} diduga putus`,
          reason: `Semua ${members.length} pelanggan di ${o.name} offline, sedangkan ODP lain${odc ? ` di ${odc.name}` : ''} masih online. Titik gangguan ada di antara ${upstream.name} dan ${o.name}${portText}, atau di splitter ${o.name}.`,
          steps: [
            `Ukur daya optik di input ${o.name}. Bila tidak ada sinyal, kabel distribusi dari ${upstream.name}${portText} putus.`,
            `Periksa konektor/pigtail ${portText ? `pada${portText}` : `di ${upstream.name}`}: kotor, longgar, atau tercabut.`,
            `Telusuri kabel antara ${upstream.name} dan ${o.name}.`,
            `Bila input ${o.name} normal, periksa splitter di dalam ODP.`,
          ],
          from: upstream,
          to: odpPoint(o),
        },
        down,
      );
    } else if (down.length === members.length) {
      const c = down[0];
      make(
        {
          key: `ambiguous:${o.id}`,
          kind: 'ambiguous',
          severity: 'warning',
          confidence: 'rendah',
          title: `${c.name} offline, satu-satunya pelanggan di ${o.name}`,
          reason: `${o.name} hanya punya satu pelanggan yang pernah online, jadi tidak ada pembanding. Gangguan bisa di kabel drop/perangkat ${c.name}, atau di kabel distribusi ke ${o.name}.`,
          steps: [
            `Hubungi ${c.name}: pastikan ONT/router menyala dan lampu PON/LOS tidak merah.`,
            `Bila perangkat pelanggan normal tetapi LOS merah, ukur daya optik di port ${c.odp_port ?? '?'} ${o.name}.`,
            `Bila ${o.name} tidak menerima sinyal, telusuri kabel distribusi dari ${upstream.name}.`,
          ],
          from: upstream,
          to: odpPoint(o),
        },
        down,
      );
    } else {
      for (const c of down) {
        make(
          {
            key: `drop:${c.id}`,
            kind: 'drop',
            severity: 'warning',
            confidence: 'sedang',
            title: `Kabel drop / perangkat ${c.name}`,
            reason: `${c.name} offline, sedangkan ${members.length - down.length} pelanggan lain di ${o.name} online. Jalur sampai ${o.name} normal; gangguan ada di kabel drop port ${c.odp_port ?? '?'} atau di rumah pelanggan.`,
            steps: [
              'Hubungi pelanggan: apakah listrik padam, atau ONT/router mati atau dicabut?',
              'Minta pelanggan cek lampu ONT: LOS merah berarti kabel drop putus/tertekuk; PON normal berarti masalah di router (PPPoE, password).',
              `Bila LOS merah, periksa kabel drop dari port ${c.odp_port ?? '?'} ${o.name} sampai rumah, termasuk konektor di kedua ujung.`,
            ],
            from: odpPoint(o),
            to: { type: 'customer', id: c.id, name: c.name, lat: c.lat, lng: c.lng },
          },
          [c],
        );
      }
    }
  }

  const rank: Record<FindingKind, number> = { server: 0, feeder: 1, distribution: 2, ambiguous: 3, drop: 4 };
  findings.sort((a, b) => rank[a.kind] - rank[b.kind] || b.affected.length - a.affected.length);
  return result();
}
