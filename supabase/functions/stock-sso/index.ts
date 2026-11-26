// Sign-in from MJM Intranet (Intranet "level 2: token redirect").
//   { token, module: 'stock' | 'report' } → { session, auth, module }
// The Intranet opens the app with ?gw_token=<60-second single-use token>.
// We redeem it once with the Intranet's gw-check-access (server to server,
// with that module's API key), then look the person up in port_users — and
// create an HQ User row for them if this is their first visit. The browser
// gets the same session object the classic login builds, plus a Supabase
// Auth session (so the Super Admin / React paths work too).
import {
  ApiError, anonClient, handler, roleOf, serviceClient, SUPER_ADMIN_EMAIL, toAuthEmail, USERS_TABLE, type UserRow,
} from '../_shared/common.ts';
import { companyAccessRows, resolveAccess } from '../_shared/companyAccess.ts';
import {
  companiesForUser, intranetMasterData, linkEstates, saveCompanies, saveUserCompanies, type PortCompany,
} from '../_shared/masterSync.ts';

const INTRANET_URL = Deno.env.get('INTRANET_SUPABASE_URL') ?? 'https://briqzyxfxsvulyizzbiu.supabase.co';

type Module = 'stock' | 'report';

// Must match ALL_SECTIONS in the classic app (root index.html) — the Super
// Admin's session carries every section id as an array.
export const ALL_SECTION_IDS = [
  'dashboard',
  'transactions', 'summary', 'ledger',
  'roundprogress', 'maintprogress', 'chemusage',
  'fertrecord', 'chemrecord', 'plantrecord',
  'rainfall', 'rainfallreport', 'rainfallsummary',
  'tools', 'toolsrecord',
  'mgmtreport',
];

interface CheckResult {
  allowed: boolean;
  module_code?: string;
  user?: { id: string; email: string; full_name?: string | null; avatar_url?: string | null; is_super_admin?: boolean };
  error?: string;
}

/** One API key per Intranet module (the token's audience is the module code). */
function apiKeyFor(module: Module): string {
  const key = module === 'report'
    ? Deno.env.get('INTRANET_REPORT_API_KEY')
    : Deno.env.get('INTRANET_PORT_API_KEY') || Deno.env.get('INTRANET_STOCK_API_KEY') || Deno.env.get('INTRANET_MODULE_API_KEY');
  if (!key) throw new ApiError('err_sso_not_set_up', 500);
  return key;
}

async function redeem(token: string, module: Module): Promise<CheckResult> {
  const res = await fetch(`${INTRANET_URL}/functions/v1/gw-check-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gw-api-key': apiKeyFor(module) },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError('err_sso_invalid', 401);
  return body as CheckResult;
}

/** Case-insensitive lookup; also tries the legacy "<local part>@psms.app" User ID form. */
async function findUser(email: string): Promise<UserRow | null> {
  const db = serviceClient();
  const candidates = [email];
  const legacy = toAuthEmail(email.split('@')[0]);
  if (legacy !== email) candidates.push(legacy);
  for (const candidate of candidates) {
    const { data, error } = await db.from(USERS_TABLE).select('*').ilike('email', candidate);
    if (error) throw error;
    const row = ((data ?? []) as UserRow[]).find((r) => (r.email ?? '').toLowerCase() === candidate);
    if (row) return row;
  }
  return null;
}

/** First visit: create an HQ User row that can open the module they came from.
 *  - stock:  no __configured flag → the app defaults every section to 'view'
 *  - report: only Management Report ('view'); everything else 'none'
 *  Estates are left empty — an admin assigns them in User Management. */
async function createUser(email: string, name: string, module: Module): Promise<UserRow> {
  const permissions: Record<string, unknown> = module === 'report'
    ? { __role: 'hq_user', __configured: true, mgmtreport: 'view' }
    : { __role: 'hq_user' };
  const row = {
    id: Date.now(), // same id scheme as the app / mantap-worker-admin
    name, email, password_hash: '', estates: [], permissions, status: 'active',
  };
  const { data, error } = await serviceClient().from(USERS_TABLE).insert(row).select('*').single();
  if (error) throw error;
  return (data ?? { ...row, last_active: null }) as UserRow;
}

/** Creates the user's Supabase Auth account if needed and returns a session for it. */
async function issueSession(row: UserRow) {
  const admin = serviceClient().auth.admin;
  // Returning users already have an Auth account: ask for the link first and
  // create the account only when it is missing (one round trip less per sign-in)
  let link = await admin.generateLink({ type: 'magiclink', email: row.email });
  if (link.error) {
    const created = await admin.createUser({
      email: row.email, email_confirm: true, user_metadata: { opp_user_id: row.id, name: row.name },
    });
    if (created.error && !/already|exists|registered/i.test(created.error.message)) throw created.error;
    link = await admin.generateLink({ type: 'magiclink', email: row.email });
  }
  if (link.error) throw link.error;
  const { data, error } = await anonClient().auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
  if (error || !data.session) throw error ?? new Error('no session');
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

/** The session object exactly as the classic app's attemptLogin builds it. */
function toSession(row: UserRow, companies: PortCompany[], avatar = '', intranetSuper = false,
  companyAccess: Record<string, { role: string; permissions: Record<string, unknown>; status: string }> = {},
  companyEstates: Record<string, string[]> = {}) {
  // The Intranet Super Admin is the Super Admin here too
  const role = row.email.toLowerCase() === SUPER_ADMIN_EMAIL || intranetSuper ? 'superadmin' : roleOf(row);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    estates: row.estates ?? [],
    estate: '',
    role,
    permissions: role === 'superadmin' ? ALL_SECTION_IDS : (row.permissions ?? {}),
    // Companies this person was given for this module's icon in the Intranet
    // (business + company), in Intranet company code order: { id, code, name, short_name }
    companies,
    // The person's Intranet profile photo (public storage URL), shown in the portal
    avatar,
    // Signed in through MJM Intranet: the pages open only with such a session
    via: 'intranet',
    // PORT → User Access, per company: the front page applies the chosen
    // company's role / permissions / locations to this session
    company_access: companyAccess,
    company_estates: companyEstates,
  };
}

// When this function instance last linked old estate names to companies
let lastLink = 0;

Deno.serve(handler(async (_req, body) => {
  const token = String(body.token ?? '');
  if (!token || token.length > 4000) throw new ApiError('err_sso_invalid', 400);
  const module: Module = body.module === 'report' ? 'report' : 'stock';

  const check = await redeem(token, module);
  if (!check.allowed || !check.user?.email) throw new ApiError('err_forbidden', 403);
  const email = check.user.email.toLowerCase();
  const fullName = (check.user.full_name ?? '').trim() || email.split('@')[0];

  // Which companies the Intranet gives this person for this module's icon.
  // No company → no entry: the Intranet decides who may open what.
  let md;
  try {
    md = await intranetMasterData(module);
  } catch (e) {
    console.error('[stock-sso] Intranet master data:', e instanceof Error ? e.message : e);
    throw new ApiError(e instanceof Error && e.message === 'err_sso_not_set_up' ? 'err_sso_not_set_up' : 'err_intranet_unavailable', 503);
  }
  const companies = companiesForUser(email, md);
  if (!companies.length) throw new ApiError('err_no_company', 403);

  // Fast path: everything that does not depend on each other runs at the same time.
  // 1) the person's row  ‖  PORT's copy of the Intranet company list
  const [found] = await Promise.all([
    findUser(email),
    saveCompanies(md).catch((e) => console.warn('[stock-sso] company list skipped:', e instanceof Error ? e.message : e)),
  ]);
  let row = found ?? await createUser(email, fullName, module);
  if (row.status === 'inactive') throw new ApiError('err_inactive', 403);
  // The person is who the Intranet says they are: the row carries the Intranet
  // email and profile name. A row found by the legacy "<user id>@psms.app" form
  // is adopted (its rights stay) and takes the real email.
  const fix: Record<string, unknown> = {};
  if ((row.email ?? '').toLowerCase() !== email && /@psms\.app$/i.test(row.email ?? '')) fix.email = email;
  if ((check.user.full_name ?? '').trim() && row.name !== fullName) fix.name = fullName;
  // The Intranet Super Admin is Super Admin in PORT: marked on the row so User
  // Access knows it too (and unmarked when the Intranet takes it away)
  const intranetSuper = check.user.is_super_admin === true;
  const p0 = row.permissions && typeof row.permissions === 'object' && !Array.isArray(row.permissions) ? row.permissions as Record<string, unknown> : {};
  if (intranetSuper && (p0.__role !== 'superadmin' || !p0.__intranet_super)) {
    fix.permissions = { ...p0, __role: 'superadmin', __intranet_super: true, __role_before: p0.__role_before ?? p0.__role ?? 'hq_user' };
  } else if (!intranetSuper && p0.__intranet_super) {
    const { __intranet_super: _s, __role_before, ...rest } = p0;
    fix.permissions = { ...rest, __role: __role_before ?? 'hq_user' };
  }
  row = { ...row, ...fix } as UserRow;

  // 2) this person's company access  ‖  their companies' locations  ‖  per-company
  //    User Access  ‖  the sign-in session
  const ids = companies.map((c) => c.id);
  const [, estRes, perCoMap, auth] = await Promise.all([
    saveUserCompanies(email, module, companies),
    serviceClient().from('port_estate_company').select('estate, company_id').in('company_id', ids).order('estate'),
    companyAccessRows([email], ids),
    issueSession(row),
  ]);
  if (estRes.error) throw estRes.error;
  const estRows = (estRes.data ?? []) as { estate: string; company_id: string }[];
  const estates = estRows.map((r) => r.estate);
  // Per company: its locations (the company itself when none is linked) and the
  // access set for it in PORT → User Access (else the person's global access)
  const companyEstates: Record<string, string[]> = {};
  for (const c of companies) {
    const list = estRows.filter((r) => r.company_id === c.id).map((r) => r.estate);
    companyEstates[c.id] = list.length ? list : [c.name];
  }
  const perCo = perCoMap.get(email);
  const companyAccess: Record<string, { role: string; permissions: Record<string, unknown>; status: string }> = {};
  for (const c of companies) {
    const a = resolveAccess(row, perCo?.get(c.id));
    companyAccess[c.id] = { role: a.role, permissions: a.permissions, status: a.status };
  }
  row = { ...row, estates };

  // 3) After the answer: one write for the row, and the old-estate → company
  //    link (it scans every data table, so at most once every 10 minutes)
  const after = (async () => {
    const { error } = await serviceClient().from(USERS_TABLE)
      .update({ ...fix, last_active: new Date().toISOString(), companies: ids, estates }).eq('id', row.id);
    if (error) console.warn('[stock-sso] user row update skipped:', error.message);
    if (Date.now() - lastLink > 10 * 60 * 1000) {
      lastLink = Date.now();
      try { await linkEstates(); } catch (e) { console.warn('[stock-sso] estate link skipped:', e instanceof Error ? e.message : e); }
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(after); else await after;

  return { session: toSession(row, companies, String(check.user.avatar_url ?? ''), intranetSuper, companyAccess, companyEstates), auth, module };
}));
