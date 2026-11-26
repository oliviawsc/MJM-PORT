// PORT → User Access module (access/index.html), ONE COMPANY AT A TIME.
//
// MJM Intranet decides WHO may enter PORT and WHICH companies they see (saved
// in port_user_companies at every Intranet sign-in). This function manages
// WHAT each person may do inside PORT for one company: their role and
// None / View / Edit per page (port_user_company_access). Setting it for one
// company does not change any other company.
//
//   POST { action: 'list', company_id }  → { me, company, roles, sections, users }
//   POST { action: 'save', company_id, id, role, permissions, status } → { ok, user }
//
// Who may use it (caller = the signed-in Supabase session from the Intranet sign-in):
//   Super Admin  every company; may give Admin / HQ User / Estate User
//   Admin        only a company where they are Admin; not Super Admins, not
//                other Admins, not themselves; may give HQ User / Estate User
// Users themselves are never created, deleted or given passwords here: the
// Intranet does that. A person appears after their first Intranet sign-in.
import { ApiError, callerEmail, handler, roleOf, serviceClient, SUPER_ADMIN_EMAIL, USERS_TABLE, type UserRow } from '../_shared/common.ts';
import { companiesForUser, intranetEstatesOf, intranetLocationGroups, intranetLocationIds, intranetLocationShortNames, intranetMasterData, saveCompanies, saveUserCompanies } from '../_shared/masterSync.ts';
import { companyAccessRows, resolveAccess } from '../_shared/companyAccess.ts';

// Pages of PORT (ids = the classic app's section ids, plus estateinfo).
export const SECTIONS = [
  // Grouped like the tiles on the Plantation Operation front page
  { id: 'estateinfo',      label: 'Estate Info',                 group: 'Estate Info' },
  { id: 'dashboard',       label: 'Dashboard',                   group: 'Stock' },
  { id: 'transactions',    label: 'Record Stock',                group: 'Stock' },
  { id: 'summary',         label: 'Stock Transactions',          group: 'Stock' },
  { id: 'ledger',          label: 'Stock Summary',               group: 'Stock' },
  { id: 'roundprogress',   label: 'Fertilizer Issuance',         group: 'Stock' },
  { id: 'maintprogress',   label: 'Maintenance Progress',        group: 'Stock' },
  { id: 'chemusage',       label: 'Chemical Usage',              group: 'Stock' },
  { id: 'fertrecord',      label: 'Fertilizer Issuance Record',  group: 'Stock' },
  { id: 'chemrecord',      label: 'Chemical Issuance Record',    group: 'Stock' },
  { id: 'plantrecord',     label: 'Field Planting Record',       group: 'Stock' },
  { id: 'tools',           label: 'Tools Transactions',          group: 'Stock' },
  { id: 'toolsrecord',     label: 'Tools Record',                group: 'Stock' },
  { id: 'mgmtreport',      label: 'Management Report',           group: 'Management Report' },
  { id: 'ffbrecord',       label: 'FFB Production',              group: 'FFB Production' },
  { id: 'rainfall',        label: 'Rainfall Transactions',       group: 'Rainfall' },
  { id: 'rainfallreport',  label: 'Monthly Rainfall Record',     group: 'Rainfall' },
  { id: 'rainfallsummary', label: 'Yearly Rainfall Record',      group: 'Rainfall' },
  { id: 'workers',         label: 'Worker list (Mantap)',        group: 'Worker Manage' },
  // Estate User (mobile) pages
  { id: 'estate_baja',      label: 'Baja (Fertilizer) — mobile',  group: 'Estate User (mobile)' },
  { id: 'estate_racun',     label: 'Racun (Chemical) — mobile',   group: 'Estate User (mobile)' },
  { id: 'estate_anak',      label: 'Anak Sawit (Seedling) — mobile', group: 'Estate User (mobile)' },
  { id: 'mobile_rainfall',  label: 'Hujan (Rainfall) — mobile',   group: 'Estate User (mobile)' },
  { id: 'tools_mobile_cat', label: 'Peralatan (Tools) — mobile',  group: 'Estate User (mobile)' },
];
const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

export const ROLES = [
  { value: 'superadmin',  label: 'Super Admin', note: 'Everything, every company' },
  { value: 'admin',       label: 'Admin',       note: 'Own page access + manages users of their companies' },
  { value: 'hq_user',     label: 'HQ User',     note: 'Website, pages as ticked below' },
  { value: 'estate_user', label: 'Estate User', note: 'Mobile / Worker Portal, pages as ticked below' },
];
const ROLE_VALUES = new Set(ROLES.map((r) => r.value));

type Actor = { row: UserRow | null; email: string; super: boolean };

/** Super Admin: the built-in one, or marked so (the Intranet Super Admin is marked at sign-in). */
function isSuper(email: string, row: UserRow | null): boolean {
  return email === SUPER_ADMIN_EMAIL.toLowerCase() || (!!row && roleOf(row) === 'superadmin');
}

async function actorOf(req: Request): Promise<Actor> {
  const email = (await callerEmail(req))?.toLowerCase();
  if (!email) throw new ApiError('err_forbidden', 401);
  const { data, error } = await serviceClient().from(USERS_TABLE).select('*').ilike('email', email);
  if (error) throw error;
  const row = ((data ?? []) as UserRow[]).find((r) => r.email.toLowerCase() === email) ?? null;
  if (row && row.status === 'inactive') throw new ApiError('err_inactive', 403);
  return { row, email, super: isSuper(email, row) };
}

/** The company this call is about; the caller must be Super Admin or Admin of it. */
async function companyOf(actor: Actor, v: unknown) {
  const id = String(v ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('err_no_company', 400);
  const db = serviceClient();
  const { data: co } = await db.from('port_companies').select('id, code, name').eq('id', id).maybeSingle();
  if (!co) throw new ApiError('err_no_company', 404);
  if (actor.super) return co as { id: string; code: string | null; name: string };
  const { data: given } = await db.from('port_user_companies').select('company_id').eq('email', actor.email).eq('company_id', id).limit(1);
  if (!given?.length || !actor.row) throw new ApiError('err_forbidden', 403);
  const mine = resolveAccess(actor.row, (await companyAccessRows([actor.email], [id])).get(actor.email)?.get(id));
  if (mine.role !== 'admin' || mine.status === 'inactive') throw new ApiError('err_forbidden', 403);
  return co as { id: string; code: string | null; name: string };
}

/** Only known pages, only 'view' / 'edit'; 'none' is simply left out. */
function cleanPermissions(raw: unknown): Record<string, string> {
  const perms: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (SECTION_IDS.has(k) && (v === 'view' || v === 'edit')) perms[k] = v;
    }
  }
  return perms;
}
function sectionValues(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (SECTION_IDS.has(k) && (v === 'view' || v === 'edit')) out[k] = v as string;
  return out;
}

/** May this actor change this person's access in this company? */
function mayEdit(actor: Actor, target: UserRow, targetRole: string): boolean {
  const email = target.email.toLowerCase();
  if (isSuper(email, target)) return false;              // Super Admins are set in the Intranet
  if (actor.super) return true;
  if (email === actor.email) return false;               // not yourself
  return targetRole !== 'admin';                         // an Admin manages HQ / Estate Users only
}

Deno.serve(handler(async (req, body) => {
  const actor = await actorOf(req);
  const db = serviceClient();

  // Any page: a company's Intranet Locations and their short names, fresh from the
  // Intranet (no new sign-in needed after a change there). Only for a company the
  // Intranet gave the caller (the Super Admin: any).
  //   POST { action: 'locations', company_id } → { locations: string[], short: { [name]: short }, groups: [{ id, name, locations }] }
  if (body.action === 'locations') {
    const id = String(body.company_id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('err_no_company', 400);
    if (!actor.super) {
      const { data: given } = await db.from('port_user_companies').select('company_id').eq('email', actor.email).eq('company_id', id).limit(1);
      if (!given?.length) throw new ApiError('err_forbidden', 403);
    }
    const md = await intranetMasterData('stock');
    return { locations: intranetEstatesOf(md, id), short: intranetLocationShortNames(md, id), groups: intranetLocationGroups(md, id), ids: intranetLocationIds(md, id) };
  }

  if (body.action === 'list') {
    const company = await companyOf(actor, body.company_id);
    // Everyone the Intranet lets into Plantation Operation is listed, signed in
    // before or not: people new to PORT get a row (HQ user) and their companies now.
    try {
      const md = await intranetMasterData('stock');
      await saveCompanies(md);
      const { data: have } = await db.from(USERS_TABLE).select('email');
      const known = new Set(((have ?? []) as { email: string }[]).map((r) => (r.email || '').toLowerCase()));
      let n = 0;
      for (const u of md.module_users ?? []) {
        const email = (u.email || '').toLowerCase();
        if (!email) continue;
        if (!known.has(email)) {
          const name = (u.full_name ?? '').trim() || email.split('@')[0];
          const { error: e1 } = await db.from(USERS_TABLE).insert({
            id: Date.now() + n++, name, email, password_hash: '', estates: [], permissions: { __role: 'hq_user' }, status: 'active',
          });
          if (e1) { console.warn('[port-user-access] add from Intranet skipped:', e1.message); continue; }
          known.add(email);
        }
        await saveUserCompanies(email, 'stock', companiesForUser(email, md));
      }
    } catch (e) {
      console.warn('[port-user-access] Intranet list skipped:', e instanceof Error ? e.message : e);
    }
    // The people the Intranet gave THIS company
    const { data: given, error: gErr } = await db.from('port_user_companies').select('email').eq('company_id', company.id);
    if (gErr) throw gErr;
    const emails = [...new Set(((given ?? []) as { email: string }[]).map((r) => r.email.toLowerCase()))];
    const { data, error } = emails.length
      ? await db.from(USERS_TABLE).select('id, name, email, permissions, status, last_active').in('email', emails).order('name')
      : { data: [], error: null };
    if (error) throw error;
    // Only people who sign in from the Intranet: Mantap workers (User ID accounts, <id>@psms.app) are managed in Worker Manage
    const rows = ((data ?? []) as UserRow[]).filter((r) => !/@psms\.app$/i.test(r.email ?? ''));
    const access = await companyAccessRows(rows.map((r) => r.email), [company.id]);
    const users = rows.map((r) => {
      const em = r.email.toLowerCase();
      const sup = isSuper(em, r);
      const a = resolveAccess(r, access.get(em)?.get(company.id));
      return {
        id: r.id, name: r.name, email: r.email,
        role: sup ? 'superadmin' : a.role,
        configured: a.set || !!(a.permissions as { __configured?: boolean }).__configured,
        set_here: a.set,
        permissions: sup ? {} : sectionValues(a.permissions),
        status: a.status,
        can_edit: mayEdit(actor, r, a.role),
      };
    });
    return {
      me: { email: actor.email, role: actor.super ? 'superadmin' : 'admin' },
      company,
      roles: actor.super ? ROLES.filter((r) => r.value !== 'superadmin') : ROLES.filter((r) => r.value === 'hq_user' || r.value === 'estate_user'),
      sections: SECTIONS,
      users,
    };
  }

  if (body.action === 'save') {
    const company = await companyOf(actor, body.company_id);
    const id = Number(body.id);
    if (!Number.isFinite(id)) throw new ApiError('err_invalid');
    const role = String(body.role ?? '');
    if (!ROLE_VALUES.has(role) || role === 'superadmin') throw new ApiError('err_invalid');
    if (!actor.super && role !== 'hq_user' && role !== 'estate_user') throw new ApiError('err_forbidden', 403);
    const status = body.status === 'inactive' ? 'inactive' : 'active';

    const { data, error } = await db.from(USERS_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    const target = data as UserRow | null;
    if (!target) throw new ApiError('err_not_found', 404);
    const email = target.email.toLowerCase();
    const { data: given } = await db.from('port_user_companies').select('company_id').eq('email', email).eq('company_id', company.id).limit(1);
    if (!given?.length) throw new ApiError('err_forbidden', 403); // the Intranet did not give them this company
    const before = resolveAccess(target, (await companyAccessRows([email], [company.id])).get(email)?.get(company.id));
    if (!mayEdit(actor, target, before.role)) throw new ApiError('err_forbidden', 403);

    const permissions = cleanPermissions(body.permissions);
    const { error: e2 } = await db.from('port_user_company_access').upsert({
      email, company_id: company.id, role, permissions, status, updated_by: actor.email, updated_at: new Date().toISOString(),
    }, { onConflict: 'email,company_id' });
    if (e2) throw /port_user_company_access/.test(e2.message ?? '') ? new ApiError('err_not_set_up', 500) : e2;
    console.log('[port-user-access]', actor.email, 'set', email, 'in', company.name, role, status, JSON.stringify(permissions));
    return { ok: true, user: { id, role, status, permissions, set_here: true } };
  }

  throw new ApiError('err_invalid');
}));
