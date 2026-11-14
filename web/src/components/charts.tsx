import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBps, formatMoney, formatNumber } from '../lib/format';

const axis = { stroke: 'var(--subtle)', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: 'var(--elevated)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--fg)' },
  labelStyle: { color: 'var(--muted)', marginBottom: 4 },
  itemStyle: { padding: 0 },
};

const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function TrafficChart({ data, height = 220, showLegend = true }: { data: { ts: number; rx: number; tx: number }[]; height?: number; showLegend?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="ts" tickFormatter={timeFmt} {...axis} minTickGap={40} />
        <YAxis tickFormatter={(v) => formatBps(v, 0)} {...axis} width={70} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => timeFmt(Number(v))} formatter={(v, n) => [formatBps(Number(v)), n === 'rx' ? 'Download (RX)' : 'Upload (TX)']} />
        {showLegend && <Legend formatter={(v) => (v === 'rx' ? 'Download (RX)' : 'Upload (TX)')} wrapperStyle={{ fontSize: 12 }} />}
        <Area type="monotone" dataKey="rx" stroke="#22d3ee" strokeWidth={2} fill="url(#rx)" isAnimationActive={false} />
        <Area type="monotone" dataKey="tx" stroke="#a78bfa" strokeWidth={2} fill="url(#tx)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, dataKey, color = '#22d3ee', height = 40 }: { data: Record<string, number>[]; dataKey: string; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sp-${dataKey}-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#sp-${dataKey}-${color.slice(1)})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const SERIES: Record<string, string> = { pppoe: 'PPPoE langsung', direct: 'Hotspot langsung', reseller: 'Reseller' };

export function RevenueChart({ data, height = 260, currency = 'IDR' }: { data: { date: string; direct: number; reseller: number; pppoe?: number }[]; height?: number; currency?: string }) {
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bar-direct" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
          <linearGradient id="bar-pppoe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id="bar-reseller" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} {...axis} minTickGap={16} />
        <YAxis tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}jt` : v >= 1e3 ? `${Math.round(v / 1e3)}rb` : String(v))} {...axis} width={48} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} labelFormatter={(v) => fmtDate(String(v))} formatter={(v, n) => [formatMoney(Number(v), currency), SERIES[String(n)] ?? String(n)]} />
        <Legend formatter={(v) => SERIES[String(v)] ?? v} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="pppoe" stackId="a" fill="url(#bar-pppoe)" radius={[0, 0, 0, 0]} maxBarSize={36} />
        <Bar dataKey="direct" stackId="a" fill="url(#bar-direct)" radius={[0, 0, 0, 0]} maxBarSize={36} />
        <Bar dataKey="reseller" stackId="a" fill="url(#bar-reseller)" radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MetricsChart({
  data,
  lines,
  height = 220,
  format = (v: number) => formatNumber(v),
}: {
  data: Record<string, number>[];
  lines: { key: string; label: string; color: string }[];
  height?: number;
  format?: (v: number) => string;
}) {
  const fmt = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmt} {...axis} minTickGap={50} />
        <YAxis tickFormatter={(v) => format(Number(v))} {...axis} width={70} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => fmt(Number(v))} formatter={(v, n) => [format(Number(v)), lines.find((l) => l.key === n)?.label ?? String(n)]} />
        <Legend formatter={(v) => lines.find((l) => l.key === v)?.label ?? v} wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
