// Worker Manage pages (PORT): the shared top bar and sign-in, as on the front page.
//   back · company | title | name, email, photo, log out
// The company list is exactly what MJM Intranet gave this person; changing it
// here changes it on the front page too.
(function () {
    const SESSION_KEY = 'opp_auth_session';
    const COMPANY_ID_KEY = 'port_company_id';
    const COMPANY_KEY = 'port_company';
    const INTRANET_URL = 'https://mjmelon.github.io/MJM-Intranet/';
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const LOGOUT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>';

    let session = null;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) {}
    if (session && session.via !== 'intranet') session = null; // MJM Intranet sign-in only

    const companies = session && Array.isArray(session.companies)
        ? session.companies.filter((c) => c && typeof c === 'object' && c.id && c.name &&
            !(session.role !== 'superadmin' && session.company_access && session.company_access[c.id] && session.company_access[c.id].status === 'inactive'))
        : [];
    const findCompany = (v) => {
        const x = String(v || '').trim().toLowerCase();
        if (!x) return null;
        return companies.find((c) => c.id === v) || companies.find((c) => [c.code, c.short_name, c.name].some((k) => (k || '').toLowerCase() === x)) || null;
    };
    const params = new URLSearchParams(location.search);
    let company = findCompany(params.get('gw_company_id')) || findCompany(params.get('gw_company')) || findCompany(params.get('gw_company_name'));
    try { const u = new URL(location.href); ['gw_token', 'gw_company_id', 'gw_company', 'gw_company_name', 'gw_company_short', 'gw_estate', 'gw_estate_short'].forEach((k) => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    if (!company) { try { company = findCompany(localStorage.getItem(COMPANY_ID_KEY)) || findCompany(localStorage.getItem(COMPANY_KEY)); } catch (e) {} }
    if (!company && companies.length === 1) company = companies[0];

    /** The chosen company's role / pages / locations, as the front page applies them. */
    function applyCompany(c) {
        if (!session || !c) return;
        const acc = session.company_access && session.company_access[c.id];
        if (acc && session.role !== 'superadmin') { session.role = acc.role; session.permissions = acc.permissions; }
        const est = session.company_estates && session.company_estates[c.id];
        if (Array.isArray(est) && est.length) { session.estates = est; if (!est.includes(session.estate)) session.estate = ''; }
        session.company_id = c.id; session.company_name = c.name;
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); localStorage.setItem(COMPANY_ID_KEY, c.id); localStorage.setItem(COMPANY_KEY, c.name); } catch (e) {}
    }
    if (company) applyCompany(company);

    const listeners = [];
    function logout() {
        localStorage.removeItem(SESSION_KEY);
        try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
        location.href = INTRANET_URL + (company ? '?gw_company=' + encodeURIComponent(company.name) : '');
    }

    /** Draws the top bar. backHref = where the back button goes (relative to this page). */
    function drawTop(backHref) {
        const name = session ? (session.name || session.email || '') : '';
        const photo = session && session.avatar && /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//.test(session.avatar) ? session.avatar : '';
        document.getElementById('who').innerHTML = session
            ? '<div class="me"><b>' + esc(name) + '</b><small>' + esc(session.email || '') + '</small></div><span class="avatar">' +
              (photo ? '<img src="' + esc(photo) + '" alt="">' : esc(name.trim().slice(0, 1).toUpperCase() || '?')) + '</span>' +
              '<button type="button" class="logout" id="logout" title="Log out" aria-label="Log out">' + LOGOUT_SVG + '</button>'
            : '';
        if (session) document.getElementById('logout').onclick = logout;
        const pick = document.getElementById('coPick'), sel = document.getElementById('coSelect');
        if (companies.length) {
            pick.style.display = '';
            sel.innerHTML = (company ? '' : '<option value="">— Choose company —</option>') +
                companies.map((c) => '<option value="' + esc(c.id) + '"' + (company && c.id === company.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
        } else pick.style.display = 'none';
        const u = new URL(backHref, location.href);
        if (company) u.searchParams.set('gw_company_id', company.id);
        document.getElementById('back').href = u.pathname + u.search;
        sel.onchange = (e) => { company = findCompany(e.target.value); applyCompany(company); drawTop(backHref); listeners.forEach((f) => f(company)); };
    }

    window.PortWorkers = {
        esc,
        get session() { return session; },
        get company() { return company; },
        companies,
        drawTop,
        onCompanyChange: (f) => listeners.push(f),
        /** Locations of the chosen company (the company itself when none is linked). */
        locations: () => (company && session && session.company_estates && session.company_estates[company.id]) || (company ? [company.name] : []),
        /** Worker Manage, as set in PORT → User Access for the chosen company:
         *  Super Admin and Admins always; others with Worker Manage = View / Edit. */
        canView: () => {
            if (!session) return false;
            if (session.role === 'superadmin' || session.role === 'admin') return true;
            const p = session.permissions && !Array.isArray(session.permissions) ? session.permissions : {};
            return p.workers === 'view' || p.workers === 'edit';
        },
        canEdit: () => {
            if (!session) return false;
            if (session.role === 'superadmin' || session.role === 'admin') return true;
            const p = session.permissions && !Array.isArray(session.permissions) ? session.permissions : {};
            return p.workers === 'edit';
        },
    };
})();
