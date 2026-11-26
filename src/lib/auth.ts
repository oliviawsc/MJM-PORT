// Sign-out, session restore and profile refresh.
//  - Sign-in is ONLY through MJM Intranet: the stock-sso Edge Function gives the
//    browser a session marked via: 'intranet'. No password sign-in here.
//  - Estate workers are sent to the Worker Portal.
import { ACTIVE_SECTION_KEY, AUTH_FUNCTION, SUPER_ADMIN_EMAIL, WORKER_PORTAL_URL } from './config';
import { clearSession, loadSession, saveSession, sessionFromProfile } from './session';
import { removeKey } from './storage';
import { callFunction, supabase } from './supabase';
import type { Profile, Session } from './types';

/** port_users id of the Super Admin (for last_active), if the row exists. */
async function superAdminId(): Promise<number | undefined> {
  try {
    const { data } = await supabase.from('port_users').select('id').eq('email', SUPER_ADMIN_EMAIL).maybeSingle();
    return (data as { id?: number } | null)?.id;
  } catch { return undefined; }
}

export function touchLastActive(id: number | undefined) {
  if (!id) return;
  void supabase.from('port_users').update({ last_active: new Date().toISOString() }).eq('id', id)
    .then(() => {}, () => {});
}

export function goToWorkerPortal() {
  window.location.replace(WORKER_PORTAL_URL);
}

/** Password sign-in is switched off: Plantation Operation opens only from
 *  MJM Intranet (stock-sso). Kept so callers compile; always throws. */
export async function signIn(_rawId: string, _password: string): Promise<Session> {
  throw new Error('err_intranet_only');
}

/**
 * Session to boot with on page load, or null when the user must sign in.
 * A cached session also needs a matching Supabase Auth session; legacy
 * HQ-user sessions (no Auth session) therefore sign in once more.
 */
export async function restoreSession(): Promise<Session | 'worker' | null> {
  const local = loadSession();
  if (!local) return null;
  if (local.role === 'estate_user') return 'worker';
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email?.toLowerCase();
  if (!email || email !== local.email.toLowerCase()) {
    clearSession();
    return null;
  }
  return local;
}

/**
 * Re-reads the signed-in user's profile (access, estates, status may have
 * changed). Returns the updated session, 'inactive' when the account was
 * deactivated or removed, or the unchanged session when offline.
 */
export async function refreshProfile(): Promise<Session | 'inactive' | 'worker' | null> {
  const prev = loadSession();
  if (!prev) return null;
  if (prev.role === 'superadmin') {
    if (prev.id) return prev;
    const id = await superAdminId();
    if (!id) return prev;
    const s = { ...prev, id };
    saveSession(s);
    return s;
  }
  try {
    const r = await callFunction<{ profile: Profile }>(AUTH_FUNCTION, { action: 'me' });
    if (r.profile.role === 'estate_user') return 'worker';
    const s = sessionFromProfile(r.profile, prev);
    saveSession(s);
    return s;
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    if (code === 'err_inactive' || code === 'err_forbidden') return 'inactive';
    return prev; // offline or server hiccup: keep the cached session
  }
}

/** Clears the session (legacy logoutUser without the confirm dialog). */
export async function signOut() {
  clearSession();
  removeKey(ACTIVE_SECTION_KEY, sessionStorage);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

/** Sign out of PORT and of MJM Intranet (the Intranet reads ?gw_logout=1). */
export async function signOutEverywhere() {
  await signOut();
  window.location.href = 'https://mjmelon.github.io/MJM-Intranet/?gw_logout=1';
}

/** Throws Error(cp_err_* | err_*). */
export async function changePassword(current: string, next: string): Promise<void> {
  const s = loadSession();
  if (!s) throw new Error('cp_err_session');
  if (s.role === 'superadmin') {
    const verify = await supabase.auth.signInWithPassword({ email: s.email, password: current });
    if (verify.error) throw new Error('cp_err_wrong');
    const upd = await supabase.auth.updateUser({ password: next });
    if (upd.error) throw new Error('cp_err_network');
    return;
  }
  try {
    await callFunction(AUTH_FUNCTION, { action: 'change_password', current, next });
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    if (code === 'err_wrong') throw new Error('cp_err_wrong');
    if (code === 'err_locked' || code === 'err_inactive') throw e;
    throw new Error('cp_err_network');
  }
}
