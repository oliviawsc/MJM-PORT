// Keeps opp_estates equal to the MJM Intranet company list, so the estate
// dropdowns of Plantation Operation (Stock), Management Report and Mantap
// all show the Intranet's companies and estates.
//
//   Intranet company with estates (MJM Plantation 1 / 2 / 3) → one row per estate
//   Intranet company without estates                        → one row, the company
//
// Rows are linked by intranet_id. The first time, an unlinked estate whose
// name resembles the Intranet name is linked and renamed (its data follows,
// see stock_rename_estate). Intranet companies no longer carrying the Stock
// icon are kept but marked inactive, so their records stay.
import { serviceClient } from './common.ts';

const INTRANET_URL = Deno.env.get('INTRANET_SUPABASE_URL') ?? 'https://briqzyxfxsvulyizzbiu.supabase.co';

interface Company { id: string; name: string; short_name: string | null; is_active: boolean; sort_order: number | null }
interface Estate { id: string; company_id: string; name: string; short_name: string | null; sort_order: number | null; is_active: boolean }
interface Wanted { id: string; kind: 'estate' | 'company'; name: string; short: string | null; company: string; sort: number }
interface Row { name: string; intranet_id: string | null; is_active: boolean }

export interface SyncResult { ok: true; total: number; added: string[]; renamed: [string, string][]; deactivated: string[]; skipped: boolean }

const GENERIC = /^(sdn|bhd|berhad|sb|plantation|plantations|estate|estates|estet|ladang|the)$/;
const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const toks = (x: string) => words(x).filter((w) => !GENERIC.test(w));
const compact = (x: string) => toks(x).join('');

/** Same rules as the Stock app's matchEstateForCompany: exact name, then the same
 *  words without Sdn Bhd / Plantation / Estate, then short form or initials.
 *  Returns one estate name, or '' when none or several fit. */
export function matchEstate(hints: string[], names: string[]): string {
  for (const h of hints) {
    const exact = names.find((n) => n.toLowerCase() === h.toLowerCase());
    if (exact) return exact;
  }
  let best: string[] = [], bestScore = 0;
  for (const h of hints) {
    const ht = toks(h), hc = compact(h);
    if (!ht.length) continue;
    for (const n of names) {
      const nt = toks(n), nc = compact(n), na = words(n);
      let score = 0;
      if (ht.join(' ') === nt.join(' ')) score = 3;
      else if (hc.length >= 4 && (nc.startsWith(hc) || hc.startsWith(nc) || na.join('').startsWith(hc))) score = 2;
      else if (hc.length >= 2 && (hc === na.map((w) => w[0]).join('') || hc === na[0] + na.slice(1).map((w) => w[0]).join(''))) score = 2;
      else {
        const common = ht.filter((w) => nt.includes(w)).length;
        if (common && common === Math.min(ht.length, nt.length)) score = 1;
      }
      if (!score) continue;
      if (score > bestScore) { bestScore = score; best = [n]; }
      else if (score === bestScore && !best.includes(n)) best.push(n);
    }
    if (best.length === 1) return best[0];
  }
  return best.length === 1 ? best[0] : '';
}

/** The estate list the Intranet wants Stock to have. */
async function wantedFromIntranet(): Promise<Wanted[]> {
  const key = Deno.env.get('INTRANET_STOCK_API_KEY') || Deno.env.get('INTRANET_MODULE_API_KEY');
  if (!key) throw new Error('err_sso_not_set_up');
  const res = await fetch(`${INTRANET_URL}/functions/v1/gw-master-data`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gw-api-key': key }, body: '{}',
  });
  if (!res.ok) throw new Error('intranet_' + res.status);
  const m = await res.json() as {
    companies: Company[]; links: { group_id: string; company_id: string }[]; estates?: Estate[];
    module_company_ids: string[]; module_business_ids: string[];
  };
  const taggedBiz = new Set(m.module_business_ids ?? []);
  const withIcon = new Set<string>(m.module_company_ids ?? []);
  for (const l of m.links ?? []) if (taggedBiz.has(l.group_id)) withIcon.add(l.company_id);
  const estates = (m.estates ?? []).filter((e) => e.is_active !== false);
  const out: Wanted[] = [];
  let i = 0;
  for (const c of (m.companies ?? []).filter((c) => c.is_active !== false && withIcon.has(c.id))) {
    const mine = estates.filter((e) => e.company_id === c.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    if (mine.length) for (const e of mine) out.push({ id: e.id, kind: 'estate', name: e.name.trim(), short: e.short_name, company: c.name, sort: i++ });
    else out.push({ id: c.id, kind: 'company', name: c.name.trim(), short: c.short_name, company: c.name, sort: i++ });
  }
  return out;
}

/** Runs the sync. With `force` false it is skipped when a sync ran in the last 10 minutes. */
export async function syncEstatesFromIntranet(force = false): Promise<SyncResult> {
  const db = serviceClient();
  const { data: rows0, error } = await db.from('opp_estates').select('name, intranet_id, is_active, synced_at');
  if (error) throw error;
  const rows = (rows0 ?? []) as (Row & { synced_at: string | null })[];
  const last = Math.max(0, ...rows.map((r) => r.synced_at ? Date.parse(r.synced_at) : 0));
  if (!force && Date.now() - last < 10 * 60 * 1000) return { ok: true, total: rows.length, added: [], renamed: [], deactivated: [], skipped: true };

  const wanted = await wantedFromIntranet();
  if (!wanted.length) throw new Error('intranet_no_companies'); // never wipe the list on an empty answer
  const now = new Date().toISOString();
  const byId = new Map(rows.filter((r) => r.intranet_id).map((r) => [r.intranet_id!, r]));
  const taken = new Set(rows.map((r) => r.name));
  const linked = new Set<string>();
  const added: string[] = [], renamed: [string, string][] = [], deactivated: string[] = [];

  for (const w of wanted) {
    let row = byId.get(w.id) ?? null;
    if (!row) {
      // first time: link an unlinked estate with a similar name (exact name first)
      const free = rows.filter((r) => !r.intranet_id && !linked.has(r.name)).map((r) => r.name);
      const hit = matchEstate([w.name, w.short ?? '', w.company].filter(Boolean), free);
      if (hit) row = rows.find((r) => r.name === hit) ?? null;
    }
    const fields = { intranet_id: w.id, intranet_kind: w.kind, company_name: w.company, short_name: w.short, is_active: true, sort_order: w.sort, synced_at: now };
    if (row) {
      linked.add(row.name);
      if (row.name !== w.name && !taken.has(w.name)) {
        const { error: e2 } = await db.rpc('stock_rename_estate', { p_old: row.name, p_new: w.name });
        if (e2) throw e2;
        renamed.push([row.name, w.name]);
        taken.delete(row.name); taken.add(w.name);
        row.name = w.name;
      }
      const { error: e3 } = await db.from('opp_estates').update(fields).eq('name', row.name);
      if (e3) throw e3;
    } else {
      if (taken.has(w.name)) continue; // a different linked row already has this name
      const { error: e4 } = await db.from('opp_estates').insert({ name: w.name, ...fields });
      if (e4) throw e4;
      taken.add(w.name); linked.add(w.name); added.push(w.name);
    }
  }
  // Everything the Intranet did not list: keep the records, hide from the dropdowns
  for (const r of rows) {
    if (linked.has(r.name) || !r.is_active) continue;
    const { error: e5 } = await db.from('opp_estates').update({ is_active: false, synced_at: now }).eq('name', r.name);
    if (e5) throw e5;
    deactivated.push(r.name);
  }
  return { ok: true, total: wanted.length, added, renamed, deactivated, skipped: false };
}
