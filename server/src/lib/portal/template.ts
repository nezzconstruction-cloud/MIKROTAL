/**
 * Emulator sederhana bahasa template halaman hotspot RouterOS, untuk pratinjau dan pengujian:
 * $(var), $(if var), $(if var == 'x'), $(if var != 'x'), $(elif ...), $(else), $(endif).
 */
export type TemplateVars = Record<string, string>;

const TOKEN = /\$\((?:(if|elif) ([^)]*)|(else|endif)|([a-z0-9-]+))\)/g;

function evalCond(expr: string, vars: TemplateVars) {
  const m = expr.trim().match(/^([a-z0-9-]+)\s*(==|!=)\s*'([^']*)'$/);
  if (m) {
    const v = vars[m[1]] ?? '';
    return m[2] === '==' ? v === m[3] : v !== m[3];
  }
  return (vars[expr.trim()] ?? '') !== '';
}

export function renderTemplate(html: string, vars: TemplateVars): string {
  let out = '';
  let last = 0;
  // tiap level: apakah cabang aktif sekarang, dan apakah sudah ada cabang yang terpakai
  const stack: { active: boolean; taken: boolean; parent: boolean }[] = [];
  const emitting = () => stack.every((s) => s.active);
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (emitting()) out += html.slice(last, m.index);
    last = TOKEN.lastIndex;
    const [, kw, expr, kw2, name] = m;
    if (kw === 'if') {
      const parent = emitting();
      const ok = parent && evalCond(expr, vars);
      stack.push({ active: ok, taken: ok, parent });
    } else if (kw === 'elif') {
      const top = stack[stack.length - 1];
      if (!top) continue;
      const ok = top.parent && !top.taken && evalCond(expr, vars);
      top.active = ok;
      top.taken ||= ok;
    } else if (kw2 === 'else') {
      const top = stack[stack.length - 1];
      if (!top) continue;
      top.active = top.parent && !top.taken;
      top.taken = true;
    } else if (kw2 === 'endif') {
      stack.pop();
    } else if (name && emitting()) {
      out += vars[name] ?? '';
    }
  }
  if (emitting()) out += html.slice(last);
  return out;
}

/** Cek keseimbangan $(if)/$(endif) agar halaman tidak rusak di router. */
export function checkTemplate(html: string): string[] {
  const errors: string[] = [];
  let depth = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[1] === 'if') depth++;
    else if (m[3] === 'endif') depth--;
    else if ((m[1] === 'elif' || m[3] === 'else') && depth === 0) errors.push(`${m[0]} tanpa $(if) pada posisi ${m.index}`);
    if (depth < 0) {
      errors.push(`$(endif) berlebih pada posisi ${m.index}`);
      depth = 0;
    }
  }
  if (depth > 0) errors.push(`${depth} $(if) tidak ditutup`);
  return errors;
}
