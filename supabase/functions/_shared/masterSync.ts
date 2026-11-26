// PORT follows the MJM Intranet company master list.
//
//   port_companies       = every Intranet company (gw_companies), keyed by the
//                          Intranet company id, sorted by the Intranet company
//                          code (01, 02, …). Companies only: the Intranet's
//                          locations are not companies and never listed here.
//   port_user_companies  = the companies each person may open in each PORT
//                          module, exactly as the Intranet gives them
//                          (business + company access on that module's icon;
//                          the Intranet Super Admin gets every company with it).
//
// Old data still stores an estate name; port_link_estates() (SQL) points each
// estate name to its company and fills company_id — see the 20261126 migration.
import { serviceClient } from './common.ts';

const INTRANET_URL = Deno.env.get('INTRANET_SUPABASE_URL') ?? 'https://briqzyxfxsvulyizzbiu.supabase.co';

/** The PORT modules that open from their own Intranet icon (each has its own API key). */
export type PortModule = 'stock' | 'report' | 'mantap';

interface Company {
  id: string; code: string | null; name: string; short_name: string | null;
  opispro_id?: string | null; location_id?: string | null; is_active: boolean; sort_order: number | null;
}

export interface IntranetEstate { id: string; company_id: string; name: string; short_name: string | null; sort_order: number | null; is_active: boolean }

export interface MasterData {
  companies: Company[]; links: { group_id: string; company_id: string }[];
  businesses?: { id: string; name: string; sort_order: number | null }[];
  locations?: { id: string; company_id: string; group_id?: string | null; name: string; short_name?: string | null; location_id?: string | null; sort_order: number | null; is_active: boolean }[]; // gw_company_locations: the Locations of each company in the Intranet
  estates?: IntranetEstate[]; // gw_company_estates (older estate list)
  module_company_ids: string[]; module_business_ids: string[];
  module_users?: { id: string; email: string; full_name: string | null; is_admin: boolean; company_ids: string[] }[];
}

/** The locations (estates) of one company, exactly as set in the Intranet; [] when it has none. */
export function intranetEstatesOf(md: MasterData, companyId: string): string[] {
  // The Intranet's Location list of the company (Admin → Company → Locations); the older Estates list as fallback
  const locs = (md.locations ?? []).filter((e) => e.company_id === companyId && e.is_active !== false);
  if (!locs.length) {
    return (md.estates ?? []).filter((e) => e.company_id === companyId && e.is_active !== false)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
      .map((e) => e.name.trim()).filter(Boolean);
  }
  // Business by business (in the Intranet's business order), then the location order within it
  const bizOrder = new Map((md.businesses ?? []).map((b, i) => [b.id, i]));
  const biz = (e: { group_id?: string | null }) => (e.group_id && bizOrder.has(e.group_id) ? bizOrder.get(e.group_id)! : 1e6);
  const out: string[] = [];
  for (const e of locs.sort((a, b) => biz(a) - biz(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))) {
    const n = e.name.trim(); if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** A company's Intranet Locations grouped by Business, in the Intranet's business
 *  and location order: [{ id, name, locations: [location name, …] }]. Locations
 *  without a business come last under id '' (name ''). */
export function intranetLocationGroups(md: MasterData, companyId: string): { id: string; name: string; locations: string[] }[] {
  const locs = (md.locations ?? []).filter((e) => e.company_id === companyId && e.is_active !== false);
  const bizName = new Map((md.businesses ?? []).map((b) => [b.id, b.name]));
  const bizOrder = new Map((md.businesses ?? []).map((b, i) => [b.id, i]));
  const key = (e: { group_id?: string | null }) => (e.group_id && bizName.has(e.group_id) ? e.group_id : '');
  const groups = new Map<string, { id: string; name: string; locations: string[] }>();
  for (const e of locs.sort((a, b) => (bizOrder.get(key(a)) ?? 1e6) - (bizOrder.get(key(b)) ?? 1e6) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))) {
    const k = key(e), n = (e.name ?? '').trim();
    if (!n) continue;
    if (!groups.has(k)) groups.set(k, { id: k, name: k ? String(bizName.get(k)) : '', locations: [] });
    if (!groups.get(k)!.locations.includes(n)) groups.get(k)!.locations.push(n);
  }
  return [...groups.values()];
}

/** Opispro Location ID of each location of a company, by location name. A
 *  company without multiple locations is its own one location: its name → its
 *  own Location ID (Intranet → Company → Business Details). */
export function intranetLocationIds(md: MasterData, companyId: string): Record<string, string> {
  const out: Record<string, string> = {};
  const locs = (md.locations ?? []).filter((e) => e.company_id === companyId && e.is_active !== false);
  for (const e of locs) {
    const n = (e.name ?? '').trim(), id = (e.location_id ?? '').trim();
    if (n && id && !out[n]) out[n] = id;
  }
  if (!locs.length) {
    const c = (md.companies ?? []).find((x) => x.id === companyId);
    const id = (c?.location_id ?? '').trim();
    if (c && id) out[c.name.trim()] = id;
  }
  return out;
}

/** Short names of a company's Intranet Locations (Admin → Company → Locations → Short name), by location name. */
export function intranetLocationShortNames(md: MasterData, companyId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of md.locations ?? []) {
    if (e.company_id !== companyId || e.is_active === false) continue;
    const n = (e.name ?? '').trim(), sn = (e.short_name ?? '').trim();
    if (n && sn && !out[n]) out[n] = sn;
  }
  return out;
}

/** A company as PORT sends it to the browser (session.companies). */
export interface PortCompany { id: string; code: string; name: string; short_name: string }

export interface SyncResult {
  ok: true; total: number; added: string[]; renamed: [string, string][]; deactivated: string[];
  skipped: boolean; linked?: number; filled?: number; unlinked?: string[];
}

/** API key of one module's Intranet icon. */
export function moduleApiKey(module: PortModule): string | null {
  if (module === 'report') return Deno.env.get('INTRANET_REPORT_API_KEY') ?? null;
  if (module === 'mantap') return Deno.env.get('INTRANET_MANTAP_API_KEY') ?? null;
  return Deno.env.get('INTRANET_PORT_API_KEY') || Deno.env.get('INTRANET_STOCK_API_KEY') || Deno.env.get('INTRANET_MODULE_API_KEY') || null;
}

/** The Intranet's master data for one module's icon (gw-master-data, with that module's API key). */
export async function intranetMasterData(module: PortModule = 'stock'): Promise<MasterData> {
  const key = moduleApiKey(module);
  if (!key) throw new Error('err_sso_not_set_up');
  const res = await fetch(`${INTRANET_URL}/functions/v1/gw-master-data`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gw-api-key': key }, body: '{}',
  });
  if (!res.ok) throw new Error('intranet_' + res.status);
  return await res.json() as MasterData;
}

/** Intranet company code order: numeric codes as numbers (2 before 10), then name. */
export function byIntranetCode(a: { code?: string | null; name: string }, b: { code?: string | null; name: string }): number {
  const ca = (a.code ?? '').trim(), cb = (b.code ?? '').trim();
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  const c = ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
  return c || a.name.localeCompare(b.name);
}

function toPort(c: Company): PortCompany {
  return { id: c.id, code: (c.code ?? '').trim(), name: c.name.trim(), short_name: (c.short_name ?? '').trim() };
}

/** The companies one person may open in this module, in Intranet code order.
 *  Exactly the Intranet's answer: unknown person or no company → []. */
export function companiesForUser(email: string, md: MasterData): PortCompany[] {
  const me = (md.module_users ?? []).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!me) return [];
  const ids = new Set(me.company_ids ?? []);
  return (md.companies ?? [])
    .filter((c) => c.is_active !== false && ids.has(c.id))
    .sort(byIntranetCode)
    .map(toPort);
}

/** Copies every Intranet company into port_companies (insert / update; a company
 *  the Intranet no longer lists is kept but marked inactive, so its data stays). */
export async function saveCompanies(md: MasterData): Promise<{ added: string[]; renamed: [string, string][]; deactivated: string[]; total: number }> {
  const list = md.companies ?? [];
  if (!list.length) throw new Error('intranet_no_companies'); // never wipe the list on an empty answer
  const db = serviceClient();
  const { data: before, error } = await db.from('port_companies').select('id, name, is_active');
  if (error) throw error;
  const old = new Map(((before ?? []) as { id: string; name: string; is_active: boolean }[]).map((r) => [r.id, r]));
  const now = new Date().toISOString();
  const rows = list.map((c) => ({
    id: c.id, code: (c.code ?? '').trim() || null, name: c.name.trim(), short_name: (c.short_name ?? '').trim() || null,
    opispro_id: c.opispro_id ?? null, is_active: c.is_active !== false, synced_at: now,
    location_id: (c.location_id ?? '').trim() || null, // the company's own Location ID (no multiple locations)
  }));
  let { error: e2 } = await db.from('port_companies').upsert(rows, { onConflict: 'id' });
  if (e2 && /location_id/.test(e2.message ?? '')) { // before the 20261209 SQL: save without it
    ({ error: e2 } = await db.from('port_companies').upsert(rows.map(({ location_id: _l, ...r }) => r), { onConflict: 'id' }));
  }
  if (e2) throw e2;

  const seen = new Set(rows.map((r) => r.id));
  const gone = [...old.values()].filter((r) => !seen.has(r.id) && r.is_active);
  if (gone.length) {
    const { error: e3 } = await db.from('port_companies').update({ is_active: false, synced_at: now }).in('id', gone.map((r) => r.id));
    if (e3) throw e3;
  }
  return {
    total: rows.filter((r) => r.is_active).length,
    added: rows.filter((r) => !old.has(r.id)).map((r) => r.name),
    renamed: rows.filter((r) => old.has(r.id) && old.get(r.id)!.name !== r.name).map((r) => [old.get(r.id)!.name, r.name] as [string, string]),
    deactivated: [...gone.map((r) => r.name), ...rows.filter((r) => !r.is_active && old.get(r.id)?.is_active).map((r) => r.name)],
  };
}

/** Replaces one person's company access for one module with the Intranet's answer. */
export async function saveUserCompanies(email: string, module: PortModule, companies: PortCompany[]): Promise<void> {
  const db = serviceClient();
  const who = email.toLowerCase();
  const { error } = await db.from('port_user_companies').delete().eq('email', who).eq('module', module);
  if (error) throw error;
  if (!companies.length) return;
  const now = new Date().toISOString();
  const { error: e2 } = await db.from('port_user_companies')
    .insert(companies.map((c) => ({ email: who, module, company_id: c.id, synced_at: now })));
  if (e2) throw e2;
}

/** Links old estate names to companies and fills company_id (SQL port_link_estates). */
export async function linkEstates(): Promise<{ linked: number; filled: number; unlinked: string[] }> {
  const { data, error } = await serviceClient().rpc('port_link_estates');
  if (error) throw error;
  const r = (data ?? {}) as { linked?: number; filled?: number; unlinked?: string[] };
  return { linked: r.linked ?? 0, filled: r.filled ?? 0, unlinked: r.unlinked ?? [] };
}

/** Old estate names → MJM Intranet Locations (port_estate_company.location_name /
 *  location_id), like the company link. Rules, only when exactly one location fits:
 *  same name or short name; the name after the company name ("Mega Jutamas (Sg Rait)",
 *  "Mega Jutamas - Sg Rait"); or all words of the location in the old name.
 *  A company without Intranet locations is its own one location. Rows set by hand
 *  (location_matched_by = 'manual') only get their Location ID refreshed. */
export async function matchLocations(md: MasterData): Promise<{ matched: number }> {
  const db = serviceClient();
  const { data, error } = await db.from('port_estate_company').select('estate, company_id, location_name, location_id, location_matched_by').not('company_id', 'is', null);
  if (error) { if (/location_name/.test(error.message ?? '')) return { matched: 0 }; throw error; } // before the 20261210 SQL
  const norm = (x: string) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (x: string) => norm(x).split(' ').filter(Boolean);
  let matched = 0;
  for (const r of (data ?? []) as { estate: string; company_id: string; location_name: string | null; location_id: string | null; location_matched_by: string }[]) {
    const co = (md.companies ?? []).find((c) => c.id === r.company_id);
    if (!co) continue;
    const locs = (md.locations ?? []).filter((e) => e.company_id === co.id && e.is_active !== false)
      .map((e) => ({ name: (e.name ?? '').trim(), short: (e.short_name ?? '').trim(), id: (e.location_id ?? '').trim() })).filter((e) => e.name);
    let hit: { name: string; id: string } | null = null;
    if (r.location_matched_by === 'manual') {
      const l = locs.find((x) => x.name === r.location_name);
      if (l && l.id !== (r.location_id ?? '')) hit = l; else continue; // refresh the ID only
    } else if (!locs.length) {
      hit = { name: co.name.trim(), id: (co.location_id ?? '').trim() }; // the company is its own one location
    } else {
      const e = norm(r.estate);
      const coNames = [co.name, co.short_name ?? ''].map(norm).filter(Boolean);
      let rest = e;
      for (const cn of coNames) if (rest.startsWith(cn + ' ')) { rest = rest.slice(cn.length).trim(); break; }
      const by = (f: (l: typeof locs[number]) => boolean) => { const m = locs.filter(f); return m.length === 1 ? m[0] : null; };
      hit = by((l) => norm(l.name) === e || (!!l.short && norm(l.short) === e))
        ?? by((l) => norm(l.name) === rest || (!!l.short && norm(l.short) === rest))
        ?? by((l) => { const w = words(l.name), ew = words(r.estate); return w.length > 0 && w.every((x) => ew.includes(x)); });
    }
    if (!hit) continue;
    if (hit.name === r.location_name && (hit.id || null) === (r.location_id || null)) continue;
    const { error: e2 } = await db.from('port_estate_company')
      .update({ location_name: hit.name, location_id: hit.id || null, updated_at: new Date().toISOString() }).eq('estate', r.estate);
    if (e2) throw e2;
    matched++;
  }
  return { matched };
}

/** Full sync: Intranet companies into port_companies, then old estate names
 *  linked to them. Runs at every sign-in from the Intranet and from
 *  Settings → "Sync from Intranet". */
export async function syncCompaniesFromIntranet(md?: MasterData): Promise<SyncResult> {
  const saved = await saveCompanies(md ?? await intranetMasterData('stock'));
  const link = await linkEstates();
  try { await matchLocations(md ?? await intranetMasterData('stock')); } catch (e) { console.warn('[sync] location match skipped:', e instanceof Error ? e.message : e); }
  return { ok: true, ...saved, skipped: false, ...link };
}
