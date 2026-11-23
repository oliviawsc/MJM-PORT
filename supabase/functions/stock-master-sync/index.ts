// Settings → Estates → "Sync from Intranet": copies the Intranet company /
// estate list into port_estates (see _shared/masterSync.ts). Super Admin only;
// the same sync also runs by itself after each sign-in from the Intranet.
//   POST {}  (Authorization: the Super Admin's Supabase session)
//   → { ok, total, added, renamed, deactivated, skipped }
import { ApiError, callerEmail, handler, SUPER_ADMIN_EMAIL } from '../_shared/common.ts';
import { syncEstatesFromIntranet } from '../_shared/masterSync.ts';

Deno.serve(handler(async (req) => {
  const email = (await callerEmail(req))?.toLowerCase();
  if (!email || email !== SUPER_ADMIN_EMAIL.toLowerCase()) throw new ApiError('err_forbidden', 403);
  try {
    return await syncEstatesFromIntranet(true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'err_sso_not_set_up') throw new ApiError('err_sso_not_set_up', 500);
    console.error('[stock-master-sync]', e);
    throw new ApiError('err_sync_failed', 500);
  }
}));
