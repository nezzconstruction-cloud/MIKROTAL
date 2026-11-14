import { useRef, useState } from 'react';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { post } from '../lib/api';
import { Button, Card, PageHeader } from '../components/ui';
import { RequireRouter } from '../components/RequireRouter';

interface Entry {
  input: string;
  rows?: Record<string, string>[];
  error?: string;
  ms?: number;
}

const EXAMPLES = ['/system/resource/print', '/ip/address/print', '/interface/print ?running=true', '/ip/hotspot/active/print', '/ip/firewall/filter/print', '/log/print'];

/** Pisahkan "cmd arg1 arg2" dengan dukungan tanda kutip. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function TerminalBody({ routerId }: { routerId: number }) {
  const [history, setHistory] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);

  const exec = async (line: string) => {
    const tokens = tokenize(line.trim());
    if (!tokens.length) return;
    // dukung gaya CLI: "/ip address print" → "/ip/address/print"
    let i = 0;
    const path: string[] = [];
    while (i < tokens.length && !tokens[i].includes('=') && !tokens[i].startsWith('?')) path.push(tokens[i++]);
    const command = path.join('/').replace(/\/+/g, '/');
    const args = tokens.slice(i);
    setBusy(true);
    const entry: Entry = { input: line };
    try {
      const r = await post<{ rows: Record<string, string>[]; ms: number }>(`/api/routers/${routerId}/terminal`, { command, args });
      entry.rows = r.rows;
      entry.ms = r.ms;
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    } finally {
      setBusy(false);
      setHistory((h) => [...h, entry]);
      setInput('');
      setCursor(-1);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const inputs = history.map((h) => h.input);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Terminal API"
        subtitle="Jalankan perintah RouterOS API langsung. Format: /path/perintah =param=nilai ?query=nilai"
        icon={<TerminalIcon className="size-5" />}
        actions={
          <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setHistory([])}>
            Bersihkan
          </Button>
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setInput(e)} className="rounded-lg border border-line px-2 py-1 font-mono text-xs text-muted hover:border-brand hover:text-brand">
            {e}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden bg-slate-950 text-slate-100 dark:bg-slate-950">
        <div className="h-[calc(100vh-330px)] min-h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          <p className="text-slate-500">MIKROTAL API terminal — perintah dicatat di audit log. Gunakan dengan hati-hati.</p>
          {history.map((h, i) => (
            <div key={i} className="mt-3">
              <p>
                <span className="text-cyan-400">[admin@router] &gt;</span> {h.input}
              </p>
              {h.error && <p className="text-rose-400">failure: {h.error}</p>}
              {h.rows && !h.rows.length && <p className="text-slate-500">(kosong) • {h.ms} ms</p>}
              {h.rows?.map((r, j) => (
                <div key={j} className="mt-1 border-l-2 border-slate-700 pl-3">
                  {Object.entries(r).map(([k, v]) => (
                    <p key={k}>
                      <span className="text-violet-300">{k}</span>=<span className="text-emerald-300">{v}</span>
                    </p>
                  ))}
                </div>
              ))}
              {h.rows && h.rows.length > 0 && (
                <p className="text-slate-500">
                  {h.rows.length} baris • {h.ms} ms
                </p>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="flex items-center gap-2 border-t border-slate-800 bg-slate-900 px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void exec(input);
          }}
        >
          <span className="font-mono text-xs text-cyan-400">&gt;</span>
          <input
            className="flex-1 bg-transparent py-1.5 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600"
            value={input}
            autoFocus
            placeholder="/ip/address/print"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && inputs.length) {
                e.preventDefault();
                const n = cursor < 0 ? inputs.length - 1 : Math.max(0, cursor - 1);
                setCursor(n);
                setInput(inputs[n]);
              } else if (e.key === 'ArrowDown' && cursor >= 0) {
                e.preventDefault();
                const n = cursor + 1;
                if (n >= inputs.length) {
                  setCursor(-1);
                  setInput('');
                } else {
                  setCursor(n);
                  setInput(inputs[n]);
                }
              }
            }}
            disabled={busy}
          />
          <Button size="sm" type="submit" loading={busy}>
            Jalankan
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function TerminalPage() {
  return <RequireRouter>{(id) => <TerminalBody key={id} routerId={id} />}</RequireRouter>;
}
