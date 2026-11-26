// What a person may do inside PORT, for ONE company.
//
// PORT → User Access sets a role and None / View / Edit per page for each
// person in each company (table port_user_company_access). A company with no
// row there falls back to the person's old global access (port_users.permissions),
// so nothing changes until an Admin sets it for that company.
import { roleOf, serviceClient, type UserRow } from './common.ts';

export interface CompanyAccess {
  role: string;                          // 'admin' | 'hq_user' | 'estate_user' (Super Admin is decided elsewhere)
  permissions: Record<string, unknown>;  // { __role, __configured?, <section>: 'view' | 'edit' }
  status: 'active' | 'inactive';
  set: boolean;                          // true = set for this company in User Access
}

interface AccessRow { email: string; company_id: string; role: string; permissions: Record<string, unknown>; status: string }

/** Per-company rows for these people (and, if given, only these companies): email → company → row. */
export async function companyAccessRows(emails: string[], companyIds?: string[]): Promise<Map<string, Map<string, AccessRow>>> {
  const out = new Map<string, Map<string, AccessRow>>();
  if (!emails.length) return out;
  let q = serviceClient().from('port_user_company_access').select('email, company_id, role, permissions, status').in('email', emails.map((e) => e.toLowerCase()));
  if (companyIds?.length) q = q.in('company_id', companyIds);
  const { data, error } = await q;
  if (error) {
    // Before the 20261128 SQL is run: everyone keeps their global access
    if (/port_user_company_access/.test(error.message ?? '')) return out;
    throw error;
  }
  for (const r of (data ?? []) as AccessRow[]) {
    if (!out.has(r.email)) out.set(r.email, new Map());
    out.get(r.email)!.set(r.company_id, r);
  }
  return out;
}

/** The access that applies for one company: its own row, else the global one. */
export function resolveAccess(user: UserRow, row: AccessRow | undefined): CompanyAccess {
  if (row) {
    return {
      role: row.role,
      permissions: { ...(row.permissions ?? {}), __role: row.role, __configured: true },
      status: row.status === 'inactive' ? 'inactive' : 'active',
      set: true,
    };
  }
  const p = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions) ? user.permissions : {};
  const role = roleOf(user);
  return {
    role: role === 'superadmin' ? 'admin' : role,
    permissions: { ...p },
    status: user.status === 'inactive' ? 'inactive' : 'active',
    set: false,
  };
}
