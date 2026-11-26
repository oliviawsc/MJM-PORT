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

    // This page's own address keeps the company (and the worker list's location),
    // so a refresh reopens exactly this — not the company last chosen in another tab.
    const urlLoc = params.has('loc') ? params.get('loc') : null; // '' = All locations
    function syncUrl() {
        try {
            const u = new URL(location.href);
            ['gw_token', 'gw_company', 'gw_company_name', 'gw_company_short', 'gw_estate', 'gw_estate_short', 'gw_company_id', 'loc'].forEach((k) => u.searchParams.delete(k));
            if (company) u.searchParams.set('gw_company_id', company.id);
            if (allowAll && company && locationsOf(company).length) u.searchParams.set('loc', location_);
            history.replaceState(null, '', u.pathname + u.search + u.hash);
        } catch (e) {}
    }

    const listeners = [];
    function logout() {
        localStorage.removeItem(SESSION_KEY);
        try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
        location.href = INTRANET_URL + (company ? '?gw_company=' + encodeURIComponent(company.name) : '');
    }

    // ---- Location of the chosen company: the same list and the same remembered
    // choice as on the front page (port_location:<company id>). "All locations"
    // (empty) is offered where a page asks for it (the worker list).
    const LOC_KEY = 'port_location';
    let allowAll = false;
    const locationsOf = (c) => (c && session && session.company_estates && Array.isArray(session.company_estates[c.id])) ? session.company_estates[c.id].filter(Boolean) : [];
    const allPicked = new Set(); // companies where "All locations" was chosen on this page
    const pinned = new Map();    // company → location chosen on this page
    let urlLocUsed = false;
    function currentLocation() {
        const locs = locationsOf(company);
        if (!locs.length) return '';
        if (allowAll) {
            // Worker list: All locations unless this page's address says otherwise (refresh)
            if (!urlLocUsed && urlLoc != null) { urlLocUsed = true; if (urlLoc === '' || locs.includes(urlLoc)) { if (urlLoc) pinned.set(company.id, urlLoc); else allPicked.add(company.id); } }
            if (pinned.has(company.id) && locs.includes(pinned.get(company.id))) return pinned.get(company.id);
            return '';
        }
        if (allPicked.has(company.id)) return '';
        let want = params.get('gw_estate') || null;
        if (want == null) { try { want = localStorage.getItem(LOC_KEY + ':' + company.id); } catch (e) {} }
        if (want === '' && allowAll) return '';
        return locs.includes(want) ? want : (allowAll ? '' : locs[0]);
    }
    let location_ = '';
    function pickLocation(name) {
        location_ = name || '';
        if (company) { if (location_) { allPicked.delete(company.id); pinned.set(company.id, location_); } else { allPicked.add(company.id); pinned.delete(company.id); } }
        try { if (company && location_) localStorage.setItem(LOC_KEY + ':' + company.id, location_); } catch (e) {}
        if (session && location_) { session.estate = location_; try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
    }
    const locListeners = [];

    /** Draws the top bar. backHref = where the back button goes; opts.allLocations adds "All locations". */
    function drawTop(backHref, opts) {
        allowAll = !!(opts && opts.allLocations);
        const name = session ? (session.name || session.email || '') : '';
        const photo = session && session.avatar && /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//.test(session.avatar) ? session.avatar : '';
        document.getElementById('who').innerHTML = session
            ? '<div class="me"><b>' + esc(name) + '</b><small>' + esc(session.email || '') + '</small></div><span class="avatar">' +
              (photo ? '<img src="' + esc(photo) + '" alt="">' : esc(name.trim().slice(0, 1).toUpperCase() || '?')) + '</span>' +
              '<button type="button" class="logout" id="logout" title="Log out" aria-label="Log out">' + LOGOUT_SVG + '</button>'
            : '';
        if (session) document.getElementById('logout').onclick = logout;
        // Company
        const pick = document.getElementById('coPick');
        if (companies.length) {
            pick.style.display = '';
            document.getElementById('coBtn').textContent = company ? company.name : '— Choose company —';
            document.getElementById('coMenu').innerHTML = companies.map((c) => '<button type="button" data-co="' + esc(c.id) + '" class="' + (company && c.id === company.id ? 'on' : '') + '">' + esc(c.name) + '</button>').join('');
        } else pick.style.display = 'none';
        // Location (only when the company has locations)
        const locs = locationsOf(company), es = document.getElementById('esPick');
        if (locs.length) {
            location_ = currentLocation();
            es.style.display = '';
            document.getElementById('esBtn').textContent = location_ || (allowAll ? 'All locations' : '— Location —');
            document.getElementById('esMenu').innerHTML = (allowAll ? '<button type="button" data-es="" class="' + (!location_ ? 'on' : '') + '">All locations</button>' : '') +
                locs.map((n) => '<button type="button" data-es="' + esc(n) + '" class="' + (n === location_ ? 'on' : '') + '">' + esc(n) + '</button>').join('');
        } else { location_ = ''; es.style.display = 'none'; }
        const u = new URL(backHref, location.href);
        if (company) u.searchParams.set('gw_company_id', company.id);
        document.getElementById('back').href = u.pathname + u.search;
        lastBack = backHref; lastOpts = opts;
        syncUrl();
    }
    let lastBack = '../', lastOpts = null;
    // Menus open / close / choose (wired once)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#coBtn, #esBtn');
        if (btn) { const m = document.getElementById(btn.id === 'coBtn' ? 'coMenu' : 'esMenu'); const open = !m.classList.contains('open'); document.querySelectorAll('.co-menu.open').forEach((x) => x.classList.remove('open')); if (open) m.classList.add('open'); return; }
        const co = e.target.closest('#coMenu [data-co]');
        if (co) {
            document.getElementById('coMenu').classList.remove('open');
            const c = findCompany(co.dataset.co);
            if (!c || (company && c.id === company.id)) return;
            company = c; applyCompany(company); drawTop(lastBack, lastOpts); listeners.forEach((f) => f(company));
            return;
        }
        const es = e.target.closest('#esMenu [data-es]');
        if (es) {
            document.getElementById('esMenu').classList.remove('open');
            pickLocation(es.dataset.es); drawTop(lastBack, lastOpts); locListeners.forEach((f) => f(location_));
            return;
        }
        if (!e.target.closest('.co-pick')) document.querySelectorAll('.co-menu.open').forEach((x) => x.classList.remove('open'));
    });

    window.PortWorkers = {
        esc,
        get session() { return session; },
        get company() { return company; },
        companies,
        drawTop,
        onCompanyChange: (f) => listeners.push(f),
        onLocationChange: (f) => locListeners.push(f),
        /** A location's short name from the Intranet (Company → Locations → Short name), else ''. */
        shortName: (loc) => (company && session && session.company_location_short && session.company_location_short[company.id] && session.company_location_short[company.id][loc]) || '',
        /** The chosen location ('' = all locations / none). */
        get location() { return location_; },
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
