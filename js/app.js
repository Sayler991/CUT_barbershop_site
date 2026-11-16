/* .CUT barbershop — site client : prestations, horaires et réservation (Supabase, fonctions public.cutbarber_*). */
(function () {
  'use strict';
  var C = window.CUT_CONFIG, OFF = C.TZ_OFFSET_MIN * 60000, STEP = C.STEP_MIN;
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var INFO = null, BUSY = [], S = { step: 1, service: null, barber: undefined, day: null, start: null };

  function h(tag, a) {
    var e = document.createElement(tag); a = a || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) [].concat(arguments[i]).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  // --- heure du salon (Algérie, UTC+1) ---
  function localNow() { var d = new Date(Date.now() + OFF); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  function dayKey(o) { return o.y + '-' + o.m + '-' + o.d; }
  function addDays(o, n) { var d = new Date(Date.UTC(o.y, o.m, o.d + n)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; }
  function toUtc(o, min) { return Date.UTC(o.y, o.m, o.d) + min * 60000 - OFF; }
  function hm(min) { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  function fmtRange(o) { return o.closed ? 'Fermé' : hm(o.open_min) + ' – ' + (o.close_min >= 1440 ? '00:00' : hm(o.close_min)); }
  function price(s) { return s.price_da == null ? 'Prix à confirmer' : s.price_da.toLocaleString('fr-FR') + ' DA' + (s.to_confirm ? ' (à confirmer)' : ''); }
  function priceShort(s) { return s.price_da == null ? 'Sur demande' : s.price_da.toLocaleString('fr-FR') + ' DA'; }
  function dur(m) { return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '') : m + ' min'; }
  function hoursOf(dow) { return INFO.hours.filter(function (x) { return x.dow === dow; })[0]; }
  function longDate(o) { return DAYS[o.dow] + ' ' + o.d + ' ' + MONTHS[o.m]; }

  function renderStatic() {
    var list = $('#svcList'); list.innerHTML = '';
    var anyTc = false;
    INFO.services.forEach(function (s) {
      if (s.to_confirm) anyTc = true;
      var ic = h('span', { class: 'ico' }); ic.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.4 20 17M8.2 16.6 20 7"/></g></svg>';
      list.appendChild(h('div', { class: 'svc', onclick: function (e) { if (e.target.closest('a')) return; pickService(s); $('#reserver').scrollIntoView({ behavior: 'smooth' }); } }, ic,
        h('div', { class: 't' }, h('h3', { text: s.name }), s.description ? h('p', { text: s.description }) : null),
        h('div', { class: 'meta' }, h('b', { text: priceShort(s) }), h('span', { class: 'dchip', text: '⏱ ' + dur(s.duration_min) }), s.to_confirm ? h('div', null, h('span', { class: 'tag', text: 'à confirmer' })) : null),
        h('a', { class: 'btn btn-line sm', href: '#reserver', onclick: function () { pickService(s); } }, 'Choisir')));
    });
    $('#priceNote').hidden = !anyTc;
    var t = $('#hours'), now = localNow(); t.innerHTML = '';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (dow) {
      var o = hoursOf(dow); if (!o) return;
      t.appendChild(h('tr', { class: dow === now.dow ? 'today' : null }, h('td', { text: DAYS[dow][0].toUpperCase() + DAYS[dow].slice(1) }), h('td', { text: fmtRange(o) })));
    });
    var o = hoursOf(now.dow), el = $('#openNow');
    if (o && !o.closed && now.min >= o.open_min && now.min < o.close_min) el.innerHTML = '<b>Ouvert</b> · jusqu’à ' + (o.close_min >= 1440 ? 'minuit' : hm(o.close_min));
    else {
      for (var i = 0; i < 8; i++) {
        var dd = addDays(now, i), oo = hoursOf(dd.dow);
        if (oo && !oo.closed && (i > 0 || now.min < oo.open_min)) { el.innerHTML = '<b class="c">Fermé</b> · ouvre ' + (i === 0 ? 'à ' : i === 1 ? 'demain à ' : DAYS[dd.dow] + ' à ') + hm(oo.open_min); break; }
      }
    }
  }

  // --- réservation ---
  function setStep(n) {
    S.step = n;
    [].forEach.call(document.querySelectorAll('#steps li'), function (li) { var k = +li.dataset.s; li.className = k === n ? 'on' : k < n ? 'ok' : ''; });
    $('#prog').style.width = Math.min(100, n * 25) + '%';
    render();
    var bk = $('#book').getBoundingClientRect();
    if (S.touched && (bk.top < 60 || bk.top > innerHeight * .6)) window.scrollTo({ top: scrollY + bk.top - 70, behavior: 'smooth' });
    S.touched = true;
  }
  function pickService(s) { S.service = s; S.start = null; if (INFO.barbers.length <= 1) S.barber = INFO.barbers[0] ? INFO.barbers[0].id : null; setStep(INFO.barbers.length > 1 ? 2 : 3); }
  function barberName(id) { var b = INFO.barbers.filter(function (x) { return x.id === id; })[0]; return b ? b.name : 'Peu importe'; }
  function recap() {
    return h('div', { class: 'recap' }, h('div', null, h('b', { text: S.service.name }), ' · ' + dur(S.service.duration_min) + ' · ' + price(S.service)),
      S.step > 2 ? h('div', { text: 'Barbier : ' + (S.barber == null ? 'peu importe (premier disponible)' : barberName(S.barber)) }) : null,
      S.step > 3 && S.start ? h('div', { text: longDate(S.day) + ' à ' + hm(S.startMin) }) : null);
  }
  function freeFor(barberId, a, b) { return !BUSY.some(function (x) { return x.barber_id === barberId && x.s < b && x.e > a; }); }
  function slotsFor(day) {
    var o = hoursOf(day.dow), out = []; if (!o || o.closed) return out;
    var now = Date.now(), d = S.service.duration_min;
    var ids = S.barber == null ? INFO.barbers.map(function (b) { return b.id; }) : [S.barber];
    for (var m = o.open_min; m + d <= o.close_min; m += STEP) {
      var a = toUtc(day, m), b = a + d * 60000;
      if (a < now + 15 * 60000) continue;
      if (ids.some(function (id) { return freeFor(id, a, b); })) out.push(m);
    }
    return out;
  }
  function nextFree(ids, d) {
    var n = localNow(), now = Date.now();
    for (var i = 0; i < C.DAYS_AHEAD; i++) {
      var day = addDays(n, i), o = hoursOf(day.dow); if (!o || o.closed) continue;
      for (var m = o.open_min; m + d <= o.close_min; m += STEP) {
        var a = toUtc(day, m), b = a + d * 60000; if (a < now + 15 * 60000) continue;
        if (ids.some(function (id) { return freeFor(id, a, b); })) return { i: i, day: day, m: m };
      }
    }
    return null;
  }
  function nxLabel(x) { return !x ? 'Complet sur 14 jours' : 'Prochaine dispo : ' + (x.i === 0 ? 'aujourd’hui' : x.i === 1 ? 'demain' : DAYS[x.day.dow] + ' ' + x.day.d) + ' à ' + hm(x.m); }
  function heroNext() {
    var el = $('#nextSlot'); if (!INFO.services.length) return;
    var d = Math.min.apply(null, INFO.services.map(function (s) { return s.duration_min; }));
    var x = nextFree(INFO.barbers.map(function (b) { return b.id; }), d);
    if (x) { el.textContent = '⚡ ' + nxLabel(x); el.hidden = false; }
  }
  function loadBusy() {
    var n = localNow(), from = new Date(toUtc(n, 0)).toISOString(), to = new Date(toUtc(addDays(n, C.DAYS_AHEAD + 1), 0)).toISOString();
    return sb.rpc('cutbarber_busy', { p_from: from, p_to: to }).then(function (r) {
      if (r.error) throw r.error;
      BUSY = (r.data || []).map(function (x) { return { barber_id: x.barber_id, s: Date.parse(x.starts_at), e: Date.parse(x.ends_at) }; });
    });
  }
  function render() {
    var p = $('#pane'); p.innerHTML = ''; p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
    if (S.step === 1) {
      p.appendChild(h('h3', { text: 'Choisissez une prestation' }));
      INFO.services.forEach(function (s) {
        p.appendChild(h('button', { class: 'choice', type: 'button', onclick: function () { pickService(s); } },
          h('span', { class: 't' }, h('b', { text: s.name }), h('small', { text: dur(s.duration_min) + ' · ' + price(s) })), h('span', { class: 'chev', text: '›' })));
      });
    } else if (S.step === 2) {
      p.appendChild(h('button', { class: 'back', type: 'button', onclick: function () { setStep(1); } }, '‹ Changer de prestation'));
      p.appendChild(recap()); p.appendChild(h('h3', { text: 'Avec qui ?' }));
      p.appendChild(h('button', { class: 'choice', type: 'button', onclick: function () { S.barber = null; setStep(3); } },
        h('span', { class: 'av any', text: '★' }), h('span', { class: 't' }, h('b', { text: 'Peu importe' }), h('small', { text: 'Le premier barbier disponible' }), h('span', { class: 'nx', text: nxLabel(nextFree(INFO.barbers.map(function (b) { return b.id; }), S.service.duration_min)) })), h('span', { class: 'chev', text: '›' })));
      INFO.barbers.forEach(function (b) {
        p.appendChild(h('button', { class: 'choice', type: 'button', onclick: function () { S.barber = b.id; setStep(3); } },
          h('span', { class: 'av', text: b.name.charAt(0).toUpperCase() }), h('span', { class: 't' }, h('b', { text: b.name }), h('small', { text: b.bio || 'Barbier' }), h('span', { class: 'nx', text: nxLabel(nextFree([b.id], S.service.duration_min)) })), h('span', { class: 'chev', text: '›' })));
      });
    } else if (S.step === 3) {
      p.appendChild(h('button', { class: 'back', type: 'button', onclick: function () { setStep(INFO.barbers.length > 1 ? 2 : 1); } }, '‹ Retour'));
      p.appendChild(recap()); p.appendChild(h('h3', { text: 'Choisissez un jour et une heure' }));
      var days = h('div', { class: 'days' }), slotsBox = h('div'), n = localNow(), first = null;
      for (var i = 0; i < C.DAYS_AHEAD; i++) (function (day) {
        var sl = slotsFor(day), btn = h('button', { class: 'day', type: 'button', disabled: !sl.length, 'data-k': dayKey(day) },
          h('small', { text: i === 0 ? 'auj.' : DAYS[day.dow].slice(0, 3) }), h('b', { text: String(day.d) }), h('em', { text: sl.length ? MONTHS[day.m] : 'complet' }));
        btn.onclick = function () { S.day = day; showSlots(); };
        days.appendChild(btn); if (sl.length && !first) first = day;
      })(addDays(n, i));
      p.appendChild(days); p.appendChild(slotsBox);
      if (!S.day || !slotsFor(S.day).length) S.day = first;
      function showSlots() {
        [].forEach.call(days.children, function (b) { b.classList.toggle('on', S.day && b.dataset.k === dayKey(S.day)); });
        slotsBox.innerHTML = '';
        if (!S.day) { slotsBox.appendChild(h('p', { class: 'muted', text: 'Aucun créneau libre sur les 14 prochains jours. Appelez le salon.' })); return; }
        var sl = slotsFor(S.day), groups = [['Matin', 0, 720], ['Après-midi', 720, 1080], ['Soir', 1080, 1441]];
        groups.forEach(function (g) {
          var xs = sl.filter(function (m) { return m >= g[1] && m < g[2]; }); if (!xs.length) return;
          slotsBox.appendChild(h('p', { class: 'period' }, g[0], h('span', { text: xs.length + ' créneau' + (xs.length > 1 ? 'x' : '') })));
          var grid = h('div', { class: 'slots' });
          xs.forEach(function (m) { grid.appendChild(h('button', { class: 'slot', type: 'button', onclick: function () { S.start = toUtc(S.day, m); S.startMin = m; setStep(4); } }, hm(m))); });
          slotsBox.appendChild(grid);
        });
      }
      showSlots();
    } else if (S.step === 4) {
      p.appendChild(h('button', { class: 'back', type: 'button', onclick: function () { setStep(3); } }, '‹ Changer de créneau'));
      p.appendChild(recap()); p.appendChild(h('h3', { text: 'Vos coordonnées' }));
      var name = h('input', { id: 'bName', autocomplete: 'name', required: true, maxlength: 60, placeholder: 'Prénom et nom' });
      var tel = h('input', { id: 'bTel', type: 'tel', autocomplete: 'tel', inputmode: 'tel', required: true, maxlength: 20, placeholder: '06 12 34 56 78' });
      var err = h('p', { class: 'err', role: 'alert' }), go = h('button', { class: 'btn btn-red', type: 'submit' }, 'Confirmer le rendez-vous');
      var f = h('form', { class: 'form', novalidate: true }, h('label', { for: 'bName' }, 'Nom'), name, h('label', { for: 'bTel' }, 'Téléphone'), tel, err, go,
        h('p', { class: 'muted', style: 'font-size:13px;margin-top:10px', text: 'Le salon peut vous appeler pour confirmer. Votre numéro sert uniquement à ce rendez-vous.' }));
      f.onsubmit = function (ev) {
        ev.preventDefault(); err.textContent = '';
        var nm = name.value.trim(), ph = tel.value.trim();
        if (nm.length < 2) { err.textContent = 'Indiquez votre nom.'; return name.focus(); }
        if (!/^\+?[0-9 .-]{8,20}$/.test(ph)) { err.textContent = 'Numéro de téléphone invalide.'; return tel.focus(); }
        go.disabled = true; go.textContent = 'Envoi…';
        sb.rpc('cutbarber_book', { p_service_id: S.service.id, p_barber_id: S.barber == null ? null : S.barber, p_starts_at: new Date(S.start).toISOString(), p_name: nm, p_phone: ph }).then(function (r) {
          if (r.error) {
            var m = r.error.message || '';
            go.disabled = false; go.textContent = 'Confirmer le rendez-vous';
            if (/slot_taken/.test(m)) { err.textContent = 'Ce créneau vient d’être pris. Choisissez-en un autre.'; loadBusy().then(function () { setTimeout(function () { setStep(3); }, 1400); }); }
            else if (/too_many/.test(m)) err.textContent = 'Vous avez déjà 3 rendez-vous à venir. Appelez le salon pour en ajouter.';
            else if (/closed|bad_time/.test(m)) err.textContent = 'Ce créneau n’est plus disponible.';
            else err.textContent = 'Erreur, réessayez ou appelez le 0672 01 57 99.';
            return;
          }
          S.result = r.data; S.name = nm; setStep(5);
          loadBusy().then(heroNext);
        });
      };
      p.appendChild(f); setTimeout(function () { name.focus(); }, 50);
    } else if (S.step === 5) {
      [].forEach.call(document.querySelectorAll('#steps li'), function (li) { li.className = 'ok'; });
      p.appendChild(h('div', { class: 'done' }, h('div', { class: 'ic', text: '✓' }), h('h3', { text: 'Rendez-vous enregistré' }),
        h('div', { class: 'recap' }, h('b', { text: S.result.service }), h('div', { text: longDate(S.day) + ' à ' + hm(S.startMin) }), h('div', { text: 'Avec ' + S.result.barber_name }), h('div', { text: 'Au nom de ' + S.name })),
        h('p', { class: 'muted', text: 'Le salon peut vous appeler pour confirmer. Un empêchement ? Appelez le 0672 01 57 99.' }),
        h('button', { class: 'btn btn-line', type: 'button', onclick: function () { S = { step: 1, touched: true }; setStep(1); } }, 'Nouveau rendez-vous')));
    }
  }

  // --- galerie ---
  var lb = $('#lb');
  [].forEach.call(document.querySelectorAll('#gal button'), function (b) { b.onclick = function () { $('img', lb).src = b.dataset.big; $('img', lb).alt = $('img', b).alt; lb.hidden = false; }; });
  lb.onclick = function (e) { if (e.target !== $('img', lb)) lb.hidden = true; };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.hidden = true; });

  $('#book').appendChild(h('div', { class: 'trust' }, h('span', { text: '✓ Gratuit' }), h('span', { text: '✓ Sans compte' }), h('span', { text: '✓ Confirmation immédiate' })));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    [].forEach.call(document.querySelectorAll('.rv'), function (el) { io.observe(el); });
  } else [].forEach.call(document.querySelectorAll('.rv'), function (el) { el.classList.add('in'); });
  sb.rpc('cutbarber_public_info').then(function (r) {
    if (r.error || !r.data) { $('#pane').innerHTML = '<p class="err">Réservation indisponible pour le moment. Appelez le 0672 01 57 99.</p>'; return; }
    INFO = r.data; renderStatic();
    return loadBusy().then(function () { setStep(1); heroNext(); });
  }).catch(function () { $('#pane').innerHTML = '<p class="err">Réservation indisponible pour le moment. Appelez le 0672 01 57 99.</p>'; });
})();
