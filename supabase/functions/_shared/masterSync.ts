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
  opispro_id?: string | null; is_active: boolean; sort_order: number | null;
}

export interface IntranetEstate { id: string; company_id: string; name: string; short_name: string | null; sort_order: number | null; is_active: boolean }

export interface MasterData {
  companies: Company[]; links: { group_id: string; company_id: string }[];
  locations?: { id: string; company_id: string; name: string; location_id?: string | null; sort_order: number | null; is_active: boolean }[]; // gw_company_locations: the Locations of each company in the Intranet
  estates?: IntranetEstate[]; // gw_company_estates (older estate list)
  module_company_ids: string[]; module_business_ids: string[];
  module_users?: { id: string; email: string; full_name: string | null; is_admin: boolean; company_ids: string[] }[];
}

/** The locations (estates) of one company, exactly as set in the Intranet; [] when it has none. */
export function intranetEstatesOf(md: MasterData, companyId: string): string[] {
  // The Intranet's Location list of the company (Admin → Company → Locations); the older Estates list as fallback
  const locs = (md.locations ?? []).filter((e) => e.company_id === companyId && e.is_active !== false);
  const src = locs.length ? locs : (md.estates ?? []).filter((e) => e.company_id === companyId && e.is_active !== false);
  return src
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .map((e) => e.name.trim()).filter(Boolean);
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
  }));
  const { error: e2 } = await db.from('port_companies').upsert(rows, { onConflict: 'id' });
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

/** Full sync: Intranet companies into port_companies, then old estate names
 *  linked to them. Runs at every sign-in from the Intranet and from
 *  Settings → "Sync from Intranet". */
export async function syncCompaniesFromIntranet(md?: MasterData): Promise<SyncResult> {
  const saved = await saveCompanies(md ?? await intranetMasterData('stock'));
  const link = await linkEstates();
  return { ok: true, ...saved, skipped: false, ...link };
}
