// PORT → User Access module (access/index.html).
//
// MJM Intranet decides WHO may enter PORT and WHICH companies they see (saved
// in port_user_companies at every Intranet sign-in). This function manages
// WHAT each person may do inside PORT: their role and None / View / Edit per
// page. One permission set per person, used for every company they have.
//
//   POST { action: 'list' }  → { me, roles, sections, users }
//   POST { action: 'save', id, role, permissions, status } → { ok, user }
//
// Who may use it (caller = the signed-in Supabase session from the Intranet sign-in):
//   Super Admin  every user; may give any role except Super Admin
//   Admin        only users who share at least one Intranet company with them;
//                not Super Admins, not other Admins, not themselves; may give
//                HQ User / Estate User only
// Users themselves are never created, deleted or given passwords here: the
// Intranet does that. A person appears after their first Intranet sign-in.
import { ApiError, callerEmail, handler, roleOf, serviceClient, SUPER_ADMIN_EMAIL, USERS_TABLE, type UserRow } from '../_shared/common.ts';

// Pages of PORT (ids = the classic app's section ids, plus estateinfo).
export const SECTIONS = [
  { id: 'estateinfo',      label: 'Estate Info',                 group: 'Estate Info' },
  { id: 'dashboard',       label: 'Dashboard',                   group: 'Stock' },
  { id: 'transactions',    label: 'Record Stock',                group: 'Stock' },
  { id: 'summary',         label: 'Stock Transactions',          group: 'Stock' },
  { id: 'ledger',          label: 'Stock Summary',               group: 'Stock' },
  { id: 'roundprogress',   label: 'Fertilizer Issuance',         group: 'Field Operations' },
  { id: 'maintprogress',   label: 'Maintenance Progress',        group: 'Field Operations' },
  { id: 'chemusage',       label: 'Chemical Usage',              group: 'Field Operations' },
  { id: 'fertrecord',      label: 'Fertilizer Issuance Record',  group: 'Reports' },
  { id: 'chemrecord',      label: 'Chemical Issuance Record',    group: 'Reports' },
  { id: 'plantrecord',     label: 'Field Planting Record',       group: 'Reports' },
  { id: 'tools',           label: 'Tools Transactions',          group: 'Tools' },
  { id: 'toolsrecord',     label: 'Tools Record',                group: 'Tools' },
  { id: 'ffbrecord',       label: 'FFB Production Record',       group: 'FFB Production' },
  { id: 'mgmtreport',      label: 'Management Report',           group: 'Management Report' },
  { id: 'rainfall',        label: 'Rainfall Transactions',       group: 'Rainfall' },
  { id: 'rainfallreport',  label: 'Monthly Rainfall Record',     group: 'Rainfall' },
  { id: 'rainfallsummary', label: 'Yearly Rainfall Record',      group: 'Rainfall' },
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

type Actor = { row: UserRow | null; email: string; role: 'superadmin' | 'admin'; companies: Set<string> };

function isSuper(email: string, row: UserRow | null): boolean {
  return email === SUPER_ADMIN_EMAIL.toLowerCase() || (!!row && roleOf(row) === 'superadmin');
}

/** Companies the Intranet gave each email (any module), as id sets. */
async function companiesByEmail(emails: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!emails.length) return out;
  const { data, error } = await serviceClient().from('port_user_companies').select('email, company_id').in('email', emails);
  if (error) throw error;
  for (const r of (data ?? []) as { email: string; company_id: string }[]) {
    if (!out.has(r.email)) out.set(r.email, new Set());
    out.get(r.email)!.add(r.company_id);
  }
  return out;
}

async function actorOf(req: Request): Promise<Actor> {
  const email = (await callerEmail(req))?.toLowerCase();
  if (!email) throw new ApiError('err_forbidden', 401);
  const { data, error } = await serviceClient().from(USERS_TABLE).select('*').ilike('email', email);
  if (error) throw error;
  const row = ((data ?? []) as UserRow[]).find((r) => r.email.toLowerCase() === email) ?? null;
  if (row && row.status === 'inactive') throw new ApiError('err_inactive', 403);
  const companies = (await companiesByEmail([email])).get(email) ?? new Set<string>();
  if (isSuper(email, row)) return { row, email, role: 'superadmin', companies };
  if (row && roleOf(row) === 'admin') return { row, email, role: 'admin', companies };
  throw new ApiError('err_forbidden', 403);
}

const shares = (a: Set<string>, b: Set<string> | undefined) => !!b && [...b].some((x) => a.has(x));

/** May this actor change this user? */
function mayEdit(actor: Actor, target: UserRow, targetCompanies: Set<string> | undefined): boolean {
  const email = target.email.toLowerCase();
  if (actor.role === 'superadmin') return email !== SUPER_ADMIN_EMAIL.toLowerCase(); // the built-in Super Admin stays as is
  if (email === actor.email) return false;
  const r = roleOf(target);
  if (r === 'superadmin' || r === 'admin' || isSuper(email, target)) return false;
  return shares(actor.companies, targetCompanies);
}

/** Only known pages, only 'view' / 'edit'; 'none' is simply left out. */
function cleanPermissions(role: string, raw: unknown): Record<string, unknown> {
  const perms: Record<string, unknown> = { __role: role };
  if (role === 'superadmin') return perms;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (SECTION_IDS.has(k) && (v === 'view' || v === 'edit')) perms[k] = v;
    }
  }
  perms.__configured = true; // explicit values win over the "view everything" default
  return perms;
}

function sectionValues(row: UserRow): Record<string, string> {
  const p = row.permissions;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (SECTION_IDS.has(k) && (v === 'view' || v === 'edit')) out[k] = v as string;
  return out;
}

Deno.serve(handler(async (req, body) => {
  const actor = await actorOf(req);
  const db = serviceClient();

  if (body.action === 'list') {
    const { data, error } = await db.from(USERS_TABLE).select('id, name, email, permissions, status, last_active').order('name');
    if (error) throw error;
    const rows = (data ?? []) as UserRow[];
    const byEmail = await companiesByEmail(rows.map((r) => r.email.toLowerCase()));
    const { data: cos } = await db.from('port_companies').select('id, code, name');
    const coById = new Map(((cos ?? []) as { id: string; code: string | null; name: string }[]).map((c) => [c.id, c]));
    const users = rows
      .map((r) => {
        const set = byEmail.get(r.email.toLowerCase());
        return {
          id: r.id, name: r.name, email: r.email,
          role: isSuper(r.email.toLowerCase(), r) ? 'superadmin' : roleOf(r),
          configured: !!(r.permissions && typeof r.permissions === 'object' && !Array.isArray(r.permissions) && (r.permissions as { __configured?: boolean }).__configured),
          permissions: sectionValues(r),
          status: r.status ?? 'active',
          last_active: r.last_active,
          companies: [...(set ?? [])].map((id) => coById.get(id)).filter(Boolean)
            .sort((a, b) => (a!.code ?? '').localeCompare(b!.code ?? '', undefined, { numeric: true }) || a!.name.localeCompare(b!.name)),
          can_edit: mayEdit(actor, r, set),
        };
      })
      // An Admin sees only the people of their own companies
      .filter((u) => actor.role === 'superadmin' || u.email.toLowerCase() === actor.email || shares(actor.companies, byEmail.get(u.email.toLowerCase())));
    return {
      me: { email: actor.email, role: actor.role },
      roles: actor.role === 'superadmin' ? ROLES.filter((r) => r.value !== 'superadmin') : ROLES.filter((r) => r.value === 'hq_user' || r.value === 'estate_user'),
      sections: SECTIONS,
      users,
    };
  }

  if (body.action === 'save') {
    const id = Number(body.id);
    if (!Number.isFinite(id)) throw new ApiError('err_invalid');
    const role = String(body.role ?? '');
    if (!ROLE_VALUES.has(role) || role === 'superadmin') throw new ApiError('err_invalid');
    if (actor.role === 'admin' && role !== 'hq_user' && role !== 'estate_user') throw new ApiError('err_forbidden', 403);
    const status = body.status === 'inactive' ? 'inactive' : 'active';

    const { data, error } = await db.from(USERS_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    const target = data as UserRow | null;
    if (!target) throw new ApiError('err_not_found', 404);
    const targetCompanies = (await companiesByEmail([target.email.toLowerCase()])).get(target.email.toLowerCase());
    if (!mayEdit(actor, target, targetCompanies)) throw new ApiError('err_forbidden', 403);

    const permissions = cleanPermissions(role, body.permissions);
    const { error: e2 } = await db.from(USERS_TABLE).update({ permissions, status }).eq('id', id);
    if (e2) throw e2;
    console.log('[port-user-access]', actor.email, 'set', target.email, role, status, JSON.stringify(permissions));
    return { ok: true, user: { id, role, status, permissions: sectionValues({ ...target, permissions }) } };
  }

  throw new ApiError('err_invalid');
}));
