/* .CUT barbershop — espace salon : agenda par barbier, prestations, barbiers, horaires. */
(function () {
  'use strict';
  var C = window.CUT_CONFIG, OFF = C.TZ_OFFSET_MIN * 60000;
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var $ = function (s) { return document.querySelector(s); };
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var CFG = null, TAB = 'agenda', VIEW = 'jour', FILTER = 'all', CUR = null, TIMER = null;

  function h(tag, a) {
    var e = document.createElement(tag); a = a || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) [].concat(arguments[i]).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(t, err) { var x = h('div', { class: 'toast' + (err ? ' e' : ''), text: t }); $('#toasts').appendChild(x); setTimeout(function () { x.remove(); }, 3500); }
  function localOf(ms) { var d = new Date(ms + OFF); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  function addDays(o, n) { var d = new Date(Date.UTC(o.y, o.m, o.d + n)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; }
  function toUtc(o, min) { return Date.UTC(o.y, o.m, o.d) + (min || 0) * 60000 - OFF; }
  function same(a, b) { return a.y === b.y && a.m === b.m && a.d === b.d; }
  function hm(min) { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  function minToStr(m) { return m >= 1440 ? '24:00' : hm(m); }
  function strToMin(s) { var p = /^(\d{1,2}):(\d{2})$/.exec(s || ''); if (!p) return null; var v = +p[1] * 60 + +p[2]; return v > 1440 ? null : v; }
  function longDate(o) { return DAYS[o.dow] + ' ' + o.d + ' ' + MONTHS[o.m]; }
  function weekStart(o) { return addDays(o, -((o.dow + 6) % 7)); }

  function showLogin(msg) {
    clearInterval(TIMER); $('#who').innerHTML = '';
    var em = h('input', { id: 'em', type: 'email', autocomplete: 'username', required: true });
    var pw = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'err', text: msg || '' }), btn = h('button', { class: 'btn red', type: 'submit' }, 'Se connecter');
    var f = h('form', { class: 'login' }, h('h1', { text: 'Espace salon' }), h('p', { class: 'muted', text: 'Agenda des rendez-vous et réglages du site.' }),
      h('label', { for: 'em' }, 'Email'), em, h('label', { for: 'pw' }, 'Mot de passe'), pw, err, btn);
    f.onsubmit = function (e) {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      sb.auth.signInWithPassword({ email: em.value.trim(), password: pw.value }).then(function (r) {
        btn.disabled = false;
        if (r.error) { err.textContent = 'Email ou mot de passe incorrect.'; return; }
        start();
      });
    };
    var app = $('#app'); app.innerHTML = ''; app.appendChild(f);
  }
  function start() {
    sb.rpc('cutbarber_is_admin').then(function (r) {
      if (!r.data) { sb.auth.signOut(); return showLogin('Ce compte n’a pas accès à l’espace salon .CUT.'); }
      return sb.auth.getUser().then(function (u) {
        $('#who').innerHTML = '';
        $('#who').appendChild(h('span', { text: u.data.user ? u.data.user.email : '' }));
        $('#who').appendChild(h('button', { class: 'btn sm wh', onclick: function () { sb.auth.signOut().then(function () { location.reload(); }); } }, 'Déconnexion'));
        CUR = localOf(Date.now());
        return loadCfg().then(draw);
      });
    });
  }
  function loadCfg() { return sb.rpc('cutbarber_admin_config').then(function (r) { if (r.error) throw r.error; CFG = r.data; }); }

  function draw() {
    var app = $('#app'); app.innerHTML = '';
    var tabs = h('div', { class: 'tabs' });
    [['agenda', 'Agenda'], ['services', 'Prestations'], ['barbers', 'Barbiers'], ['hours', 'Horaires']].forEach(function (t) {
      tabs.appendChild(h('button', { class: TAB === t[0] ? 'on' : null, onclick: function () { TAB = t[0]; draw(); } }, t[1]));
    });
    app.appendChild(tabs);
    var body = h('div'); app.appendChild(body);
    clearInterval(TIMER);
    if (TAB === 'agenda') { agenda(body); TIMER = setInterval(function () { if (TAB === 'agenda' && !document.hidden) agenda(body, true); }, 60000); }
    else if (TAB === 'services') services(body);
    else if (TAB === 'barbers') barbers(body);
    else hoursTab(body);
  }

  // ===== Agenda =====
  function bName(id) { var b = CFG.barbers.filter(function (x) { return x.id === id; })[0]; return b ? b.name : '?'; }
  function agenda(body, quiet) {
    var activeB = CFG.barbers.filter(function (b) { return b.active; });
    var from = VIEW === 'jour' ? CUR : weekStart(CUR), to = addDays(from, VIEW === 'jour' ? 1 : 7);
    var today = localOf(Date.now());
    function fetch(f, t) { return sb.rpc('cutbarber_admin_appointments', { p_from: new Date(toUtc(f)).toISOString(), p_to: new Date(toUtc(t)).toISOString() }); }
    function prep(d) { return (d || []).map(function (a) { a.s = Date.parse(a.starts_at); a.e = Date.parse(a.ends_at); a.L = localOf(a.s); return a; }); }
    return Promise.all([fetch(from, to), fetch(today, addDays(today, 1))]).then(function (rs) {
      var r = rs[0];
      if (r.error || rs[1].error) { if (!quiet) toast('Erreur de chargement', true); return; }
      var list = prep(r.data), tlist = prep(rs[1].data).filter(function (a) { return a.status !== 'cancelled'; });
      body.innerHTML = '';
      body.appendChild(summary(today, tlist, activeB));
      var seg = h('div', { class: 'seg' }, ['jour', 'semaine'].map(function (v) { return h('button', { class: VIEW === v ? 'on' : null, onclick: function () { VIEW = v; agenda(body); } }, v === 'jour' ? 'Jour' : 'Semaine'); }));
      var fsel = h('div', { class: 'seg' }, [['all', 'Tous']].concat(activeB.map(function (b) { return [String(b.id), b.name]; })).map(function (f) {
        return h('button', { class: FILTER === f[0] ? 'on' : null, onclick: function () { FILTER = f[0]; agenda(body); } }, f[1]);
      }));
      var lbl = VIEW === 'jour' ? longDate(CUR) : 'Semaine du ' + from.d + ' ' + MONTHS[from.m];
      var step = VIEW === 'jour' ? 1 : 7;
      body.appendChild(h('div', { class: 'bar' },
        h('button', { class: 'btn line sm', 'aria-label': 'Précédent', onclick: function () { CUR = addDays(CUR, -step); agenda(body); } }, '‹'),
        h('div', { class: 'datelbl', text: lbl }),
        h('button', { class: 'btn line sm', 'aria-label': 'Suivant', onclick: function () { CUR = addDays(CUR, step); agenda(body); } }, '›'),
        h('button', { class: 'btn line sm', onclick: function () { CUR = localOf(Date.now()); agenda(body); } }, 'Aujourd’hui'), seg, fsel));
      var shown = activeB.filter(function (b) { return FILTER === 'all' || String(b.id) === FILTER; });
      // barbiers désactivés mais avec des RDV : on les montre aussi
      list.forEach(function (a) { if (!shown.some(function (b) { return b.id === a.barber_id; }) && (FILTER === 'all' || String(a.barber_id) === FILTER)) shown.push({ id: a.barber_id, name: bName(a.barber_id) }); });
      if (VIEW === 'jour') {
        var cols = h('div', { class: 'cols' + (shown.length > 1 ? ' two' : '') });
        shown.forEach(function (b, i) {
          var xs = list.filter(function (a) { return a.barber_id === b.id; });
          var n = xs.filter(function (a) { return a.status !== 'cancelled'; }).length;
          cols.appendChild(h('div', { class: 'col' }, h('h2', null, b.name, h('span', { text: n + ' RDV' })),
            xs.length ? xs.map(function (a) { return card(a, i, false, body); }) : h('div', { class: 'empty', text: 'Aucun rendez-vous' })));
        });
        body.appendChild(cols);
      } else {
        var wrap = h('div', { class: 'cols week' });
        for (var k = 0; k < 7; k++) {
          var day = addDays(from, k);
          var xs = list.filter(function (a) { return same(a.L, day) && shown.some(function (b) { return b.id === a.barber_id; }); });
          var col = h('div', { class: 'col' }, h('div', { class: 'dayh', text: longDate(day) + (xs.length ? ' · ' + xs.filter(function (a) { return a.status !== 'cancelled'; }).length + ' RDV' : '') }));
          if (xs.length) xs.forEach(function (a) { col.appendChild(card(a, shown.findIndex(function (b) { return b.id === a.barber_id; }), true, body)); });
          else col.appendChild(h('div', { class: 'empty', text: 'Aucun rendez-vous' }));
          wrap.appendChild(col);
        }
        body.appendChild(wrap);
      }
    });
  }
  function summary(today, tl, activeB) {
    var now = Date.now(), next = tl.filter(function (a) { return a.status === 'booked' && a.e > now; })[0];
    var ca = tl.reduce(function (t, a) { return t + (a.price_da || 0); }, 0);
    var g = h('div', { class: 'kpis' },
      h('div', { class: 'kpi dark' }, h('small', { text: 'Rendez-vous aujourd’hui' }), h('b', { text: String(tl.length) }), h('span', { text: tl.filter(function (a) { return a.status === 'done'; }).length + ' terminé(s)' })));
    activeB.forEach(function (b, i) {
      var n = tl.filter(function (a) { return a.barber_id === b.id; }).length;
      g.appendChild(h('div', { class: 'kpi ' + (i % 2 ? 'bb' : 'br') }, h('small', { text: b.name }), h('b', { text: String(n) }), h('span', { text: 'rendez-vous' })));
    });
    var nx = h('div', { class: 'kpi next' }, h('small', { text: 'Prochain rendez-vous' }));
    if (next) {
      var mins = Math.round((next.s - now) / 60000);
      nx.appendChild(h('b', { text: hm(next.L.min) }));
      nx.appendChild(h('span', { text: next.client_name + ' · ' + next.service_name + ' · ' + bName(next.barber_id) }));
      nx.appendChild(h('em', { text: mins > 0 ? 'dans ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') : mins + ' min') : 'en cours' }));
    } else { nx.appendChild(h('b', { text: '—' })); nx.appendChild(h('span', { text: 'Plus de rendez-vous aujourd’hui' })); }
    g.appendChild(nx);
    g.appendChild(h('div', { class: 'kpi ca' }, h('small', { text: 'Chiffre prévu (indicatif)' }), h('b', { text: ca.toLocaleString('fr-FR') + ' DA' }), h('span', { text: 'selon les prix du site' })));
    return h('section', { class: 'dash' }, h('h1', { text: 'Bonjour 👋' }), h('p', { class: 'muted', text: 'Aujourd’hui, ' + longDate(today) }), g);
  }
  function card(a, idx, showBarber, body) {
    var st = a.status, end = localOf(a.e);
    var act = h('div', { class: 'act' });
    function set(s) { sb.rpc('cutbarber_admin_set_status', { p_id: a.id, p_status: s }).then(function (r) { if (r.error) { toast(/slot_taken/.test(r.error.message) ? 'Créneau déjà pris : impossible de rétablir' : 'Erreur', true); } else { toast('Mis à jour'); agenda(body); } }); }
    if (st === 'booked') {
      act.appendChild(h('a', { class: 'btn sm', href: 'tel:' + a.client_phone.replace(/[^0-9+]/g, '') }, 'Appeler'));
      act.appendChild(h('button', { class: 'btn sm line', onclick: function () { set('done'); } }, 'Fait ✓'));
      act.appendChild(h('button', { class: 'btn sm line', onclick: function () { if (confirm('Annuler ce rendez-vous ? Le créneau sera de nouveau proposé aux clients.')) set('cancelled'); } }, 'Annuler'));
    } else act.appendChild(h('button', { class: 'btn sm line', onclick: function () { set('booked'); } }, 'Rétablir'));
    return h('div', { class: 'appt ' + (idx % 2 ? 'b2 ' : '') + st },
      h('div', null, h('span', { class: 'tm', text: hm(a.L.min) + ' – ' + hm(end.min) }),
        showBarber ? h('span', { class: 'badge', text: bName(a.barber_id) }) : null,
        st !== 'booked' ? h('span', { class: 'badge', text: st === 'done' ? 'Fait' : 'Annulé' }) : null),
      h('div', { class: 'svc', text: a.service_name + (a.price_da != null ? ' · ' + a.price_da + ' DA' : '') }),
      h('div', { class: 'who', text: a.client_name }),
      h('a', { class: 'tel', href: 'tel:' + a.client_phone.replace(/[^0-9+]/g, '') }, a.client_phone), act);
  }

  // ===== Réglages =====
  function save(payload, btn) {
    btn.disabled = true;
    return sb.rpc('cutbarber_admin_save_config', { payload: payload }).then(function (r) {
      btn.disabled = false;
      if (r.error) { toast('Erreur : vérifiez les champs', true); return; }
      toast('Enregistré'); return loadCfg().then(draw);
    });
  }
  function services(body) {
    var items = CFG.services.map(function (s) { return Object.assign({}, s); });
    var p = h('div', { class: 'panel' }, h('p', { class: 'muted', text: 'Cochez « à confirmer » tant que le prix n’est pas validé : le site l’affiche comme indicatif. Décochez « visible » pour retirer une prestation.' }));
    function row(s) {
      function inp(k, type, extra) { var i = h('input', Object.assign({ type: type || 'text', value: s[k] == null ? '' : s[k] }, extra || {})); i.oninput = function () { s[k] = type === 'number' ? (i.value === '' ? null : +i.value) : i.value; }; return i; }
      function chk(k, t) { var i = h('input', { type: 'checkbox', checked: s[k] }); i.onchange = function () { s[k] = i.checked; }; return h('label', { class: 'chk' }, i, t); }
      return h('div', { class: 'row' },
        h('div', { class: 'full' }, h('label', null, 'Nom'), inp('name', 'text', { maxlength: 80 })),
        h('div', { class: 'full' }, h('label', null, 'Description'), inp('description', 'text', { maxlength: 300 })),
        h('div', null, h('label', null, 'Prix (DA)'), inp('price_da', 'number', { min: 0 })),
        h('div', null, h('label', null, 'Durée (min)'), inp('duration_min', 'number', { min: 5, max: 480, step: 5 })),
        chk('to_confirm', 'Prix à confirmer'), chk('active', 'Visible sur le site'));
    }
    var list = h('div'); items.forEach(function (s) { list.appendChild(row(s)); });
    p.appendChild(list);
    var btn = h('button', { class: 'btn red' }, 'Enregistrer');
    btn.onclick = function () {
      if (items.some(function (s) { return !s.name || !(s.duration_min >= 5); })) return toast('Chaque prestation doit avoir un nom et une durée', true);
      items.forEach(function (s, i) { s.sort = i + 1; });
      save({ services: items }, btn);
    };
    p.appendChild(h('div', { class: 'savebar' }, h('button', { class: 'btn line', onclick: function () { var s = { name: 'Nouvelle prestation', description: '', price_da: null, duration_min: 30, to_confirm: true, active: true }; items.push(s); list.appendChild(row(s)); } }, '+ Ajouter'), btn));
    body.appendChild(p);
  }
  function barbers(body) {
    var items = CFG.barbers.map(function (s) { return Object.assign({}, s); });
    var p = h('div', { class: 'panel' }, h('p', { class: 'muted', text: 'Les clients choisissent leur barbier à la réservation. Décochez « actif » pour qu’un barbier ne reçoive plus de rendez-vous (ses RDV passés restent dans l’agenda).' }));
    function row(s) {
      var n = h('input', { value: s.name, maxlength: 40 }); n.oninput = function () { s.name = n.value; };
      var b = h('input', { value: s.bio || '', maxlength: 300, placeholder: 'ex. Spécialiste dégradés' }); b.oninput = function () { s.bio = b.value; };
      var c = h('input', { type: 'checkbox', checked: s.active }); c.onchange = function () { s.active = c.checked; };
      return h('div', { class: 'row' }, h('div', null, h('label', null, 'Prénom'), n), h('div', null, h('label', null, 'Présentation courte'), b), h('label', { class: 'chk' }, c, 'Actif'));
    }
    var list = h('div'); items.forEach(function (s) { list.appendChild(row(s)); }); p.appendChild(list);
    var btn = h('button', { class: 'btn red' }, 'Enregistrer');
    btn.onclick = function () {
      if (items.some(function (s) { return !s.name.trim(); })) return toast('Chaque barbier doit avoir un prénom', true);
      items.forEach(function (s, i) { s.sort = i + 1; }); save({ barbers: items }, btn);
    };
    p.appendChild(h('div', { class: 'savebar' }, h('button', { class: 'btn line', onclick: function () { var s = { name: '', bio: '', active: true }; items.push(s); list.appendChild(row(s)); } }, '+ Ajouter un barbier'), btn));
    body.appendChild(p);
  }
  function hoursTab(body) {
    var items = CFG.hours.map(function (s) { return Object.assign({}, s); });
    var p = h('div', { class: 'panel' }, h('p', { class: 'muted', text: 'Format 24 h, ex. 10:00 et 23:00. Mettez 24:00 pour minuit. Les créneaux de réservation suivent ces horaires.' }));
    [1, 2, 3, 4, 5, 6, 0].forEach(function (dow) {
      var s = items.filter(function (x) { return x.dow === dow; })[0]; if (!s) return;
      var o = h('input', { value: minToStr(s.open_min), inputmode: 'numeric' }), c = h('input', { value: minToStr(s.close_min), inputmode: 'numeric' });
      o.oninput = function () { s._o = o.value; }; c.oninput = function () { s._c = c.value; };
      var k = h('input', { type: 'checkbox', checked: s.closed }); k.onchange = function () { s.closed = k.checked; };
      p.appendChild(h('div', { class: 'hrow' }, h('b', { text: DAYS[dow][0].toUpperCase() + DAYS[dow].slice(1) }), o, c, h('label', { class: 'chk' }, k, 'Fermé')));
    });
    var btn = h('button', { class: 'btn red' }, 'Enregistrer');
    btn.onclick = function () {
      for (var i = 0; i < items.length; i++) {
        var s = items[i];
        if (s._o != null) { var v = strToMin(s._o); if (v == null) return toast('Heure invalide : ' + s._o, true); s.open_min = v; }
        if (s._c != null) { var w = strToMin(s._c); if (w == null) return toast('Heure invalide : ' + s._c, true); s.close_min = w; }
        if (!s.closed && s.close_min <= s.open_min) return toast(DAYS[s.dow] + ' : la fermeture doit être après l’ouverture', true);
      }
      save({ hours: items.map(function (s) { return { dow: s.dow, closed: s.closed, open_min: s.open_min, close_min: s.close_min }; }) }, btn);
    };
    p.appendChild(h('div', { class: 'savebar' }, btn));
    body.appendChild(p);
  }

  function consumeLoginLink() {
    var m = /^#connexion=([A-Za-z0-9_-]{20,200})$/.exec(location.hash);
    if (!m) return Promise.resolve(false);
    history.replaceState(null, '', location.pathname + location.search);
    var app = $('#app');
    app.innerHTML = '';
    app.appendChild(h('p', { class: 'muted pad', text: 'Connexion par lien sécurisé…' }));
    return sb.auth.verifyOtp({ type: 'magiclink', token_hash: m[1] }).then(function (r) {
      if (r.error) {
        showLogin('Ce lien de connexion a expiré ou a déjà été utilisé. Demandez un nouveau lien ou connectez-vous avec votre mot de passe.');
        return true;
      }
      start();
      return true;
    });
  }

  consumeLoginLink().then(function (used) {
    if (!used) sb.auth.getSession().then(function (s) { s.data.session ? start() : showLogin(); });
  });
})();
