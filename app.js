'use strict';
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Telegram ----------
  if (tg) {
    try { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0c11'); tg.setBackgroundColor('#0a0c11'); tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (_) {}
  }
  const haptic = (t = 'light') => { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(t); } catch (_) {} };
  const hapticN = (t) => { try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(t); } catch (_) {} };

  const params = new URLSearchParams(location.search);
  let devName = params.get('dev') || sessionStorage.getItem('devName');
  if (!devName) devName = 'Sinov' + Math.floor(100 + Math.random() * 900);
  sessionStorage.setItem('devName', devName);
  const AUTH = tg && tg.initData ? tg.initData : 'dev:' + devName;

  // ---------- Holat ----------
  const S = { me: null, room: null, tour: null, tourDone: null, bot: '', screen: 'home', first: true, qms: 15000, joinCode: '' };
  let G = null; // joriy o'yin
  let roomTotal = 10;
  let tourTick = null;

  const startParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  const m = /^room_([A-Z0-9]{4})$/i.exec(startParam || '') || null;
  S.joinCode = (m && m[1].toUpperCase()) || (params.get('room') || '').toUpperCase().slice(0, 4);

  // ---------- Yordamchilar ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  async function api(path, body) {
    try {
      const r = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Init-Data': AUTH, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.error && j.error !== 'auth') toast(j.error); else if (j.error === 'auth') toast('Avtorizatsiya xatosi. Botdan qayta oching.'); return { ok: false, ...j }; }
      return j;
    } catch (_) { toast('Tarmoq xatosi'); return { ok: false }; }
  }
  function show(name) {
    S.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-' + name));
    window.scrollTo(0, 0);
    clearInterval(tourTick);
    if (tg) {
      try {
        const back = !['home', 'game', 'search', 'result'].includes(name);
        back ? tg.BackButton.show() : tg.BackButton.hide();
        name === 'game' ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation();
      } catch (_) {}
    }
  }
  const medal = (p) => ['🥇', '🥈', '🥉'][p - 1] || p;
  const fmtMs = (ms) => (ms / 1000).toFixed(1) + ' s';

  // ---------- Bosh sahifa ----------
  function renderHome() {
    const u = S.me;
    if (!u) return;
    $('#p-name').textContent = u.name;
    $('#p-avatar').textContent = (u.name || '?').trim().charAt(0).toUpperCase();
    $('#p-title').textContent = u.title;
    $('#p-rating').textContent = u.rating;
    $('#st-rank').textContent = '#' + u.rank;
    $('#st-wins').textContent = u.wins;
    $('#st-games').textContent = u.games;
    $('#st-xp').textContent = u.xp;
  }
  async function refreshMe() {
    const d = await api('/api/me');
    if (d && d.me) { S.me = d.me; renderHome(); }
  }
  function route() {
    if (S.screen === 'game') return;
    if (S.queueing) return show('search');
    if (S.room) { renderRoom(); return show('room'); }
    if (S.tour) { renderTour(); return show('tour'); }
    show('home');
  }

  $$('.mode,.ghost[data-mode]').forEach((b) => b.addEventListener('click', () => {
    haptic();
    const mode = b.dataset.mode;
    if (mode === 'duel') startSearch();
    else if (mode === 'tour') { api('/api/tour/join', {}).then((r) => { if (r.ok) { S.tourDone = null; renderTour(); show('tour'); } }); }
    else if (mode === 'room') { renderRoom(); show('room'); }
    else if (mode === 'top') openTop();
  }));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { haptic(); goHome(); }));
  function goHome() {
    if (S.screen === 'room' && S.room) api('/api/room/leave', {});
    if (S.screen === 'tour' && S.tour && S.tour.state === 'lobby') api('/api/tour/leave', {});
    if (S.screen === 'tour' && S.tour && S.tour.state !== 'lobby') api('/api/tour/leave', {});
    S.room = null; if (!(S.tour && S.tour.state === 'running' && false)) S.tour = null;
    show('home'); refreshMe();
  }
  if (tg) tg.BackButton.onClick(() => { if (S.screen !== 'game') goHome(); });

  // ---------- Duel qidiruvi ----------
  async function startSearch() {
    const r = await api('/api/duel/find', {});
    if (!r.ok) return;
    S.queueing = true; show('search');
  }
  $('#search-cancel').addEventListener('click', async () => { await api('/api/duel/cancel', {}); S.queueing = false; show('home'); });

  // ---------- Xona ----------
  $$('#room-total button').forEach((b) => b.addEventListener('click', () => {
    roomTotal = +b.dataset.v; $$('#room-total button').forEach((x) => x.classList.toggle('on', x === b)); haptic();
  }));
  $('#room-create').addEventListener('click', async () => { const r = await api('/api/room/create', { total: roomTotal }); if (r.ok) haptic('medium'); });
  $('#room-join').addEventListener('click', () => joinRoom($('#room-code').value));
  $('#room-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  async function joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 4) return toast('4 belgili kodni kiriting');
    const r = await api('/api/room/join', { code });
    if (r.ok) haptic('medium');
  }
  $('#rl-leave').addEventListener('click', async () => { await api('/api/room/leave', {}); S.room = null; renderRoom(); });
  $('#rl-start').addEventListener('click', async () => { const r = await api('/api/room/start', {}); if (r.ok) haptic('heavy'); });
  $('#rl-share').addEventListener('click', () => {
    if (!S.room) return;
    const code = S.room.code;
    const link = S.bot ? `https://t.me/${S.bot}?startapp=room_${code}` : '';
    const text = `⚔️ Huquq Oktagoni: men bilan bellashing! Xona kodi: ${code}`;
    if (link && tg) tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
    else if (navigator.clipboard) navigator.clipboard.writeText(text + (link ? '\n' + link : '')).then(() => toast('Nusxa olindi'));
    else toast(text);
  });
  function renderRoom() {
    const r = S.room;
    $('#room-entry').hidden = !!r; $('#room-lobby').hidden = !r;
    if (!r) return;
    $('#rl-code').textContent = r.code;
    $('#rl-count').textContent = r.players.length + ' / ' + r.max;
    $('#rl-list').innerHTML = r.players.map((p) => `<li><span class="dot"></span>${esc(p.name)}${p.id === r.host ? '<span class="crown">👑 xona egasi</span>' : ''}</li>`).join('');
    const isHost = S.me && r.host === S.me.id;
    const start = $('#rl-start');
    start.hidden = !isHost;
    start.disabled = r.players.length < 2 || r.state !== 'lobby';
    $('#rl-info').textContent = (isHost
      ? (r.players.length < 2 ? 'Kamida 2 ta ishtirokchi kerak. Kodni do\'stlaringizga yuboring.' : `Hamma tayyor bo'lsa boshlang. Savollar: ${r.total} ta.`)
      : 'Xona egasi o\'yinni boshlashini kuting.') + (r.state === 'playing' ? ' O\'yin ketmoqda…' : '');
  }

  // ---------- Turnir ----------
  $('#tour-leave').addEventListener('click', async () => { await api('/api/tour/leave', {}); S.tour = null; show('home'); });
  $('#tour-home').addEventListener('click', async () => { await api('/api/tour/leave', {}); S.tour = null; S.tourDone = null; show('home'); refreshMe(); });
  function renderTour() {
    const t = S.tour;
    if (!t) return;
    const lobby = t.state === 'lobby';
    $('#tour-lobby').hidden = !lobby; $('#tour-bracket').hidden = lobby;
    $('#tour-title').textContent = lobby ? 'Turnir: ro\'yxat' : 'Turnir';
    clearInterval(tourTick);
    if (lobby) {
      const off = t.now - Date.now();
      const tick = () => { $('#tour-cd').textContent = Math.max(0, Math.ceil((t.startsAt - (Date.now() + off)) / 1000)); };
      tick(); tourTick = setInterval(tick, 250);
      const slots = [];
      for (let i = 0; i < t.size; i++) {
        const p = t.players[i];
        slots.push(p ? `<div class="slot full">⚔️ ${esc(p.name)}</div>` : '<div class="slot empty">Bo\'sh o\'rin</div>');
      }
      $('#tour-slots').innerHTML = slots.join('');
      return;
    }
    const name = {}; t.players.forEach((p) => { name[p.id] = p; });
    const meId = S.me && S.me.id;
    const cell = (id, m) => {
      if (!id) return '<div class="tbd">Kutilmoqda</div>';
      const p = name[id]; let cls = '';
      if (m.winner) cls = m.winner === id ? 'w' : 'l'; else if (id === meId) cls = 'me';
      return `<div class="${cls}">${esc(p ? p.name : '?')}</div>`;
    };
    const sizes = [4, 2, 1], titles = ['Chorak final', 'Yarim final', 'Final'];
    $('#bracket').innerHTML = sizes.map((n, ri) => {
      const matches = t.rounds[ri] || [];
      let h = `<div class="bcol"><h4>${titles[ri]}</h4>`;
      for (let i = 0; i < n; i++) {
        const mt = matches[i];
        h += mt ? `<div class="bm ${mt.live ? 'live' : ''}">${cell(mt.a, mt)}${cell(mt.b, mt)}</div>` : '<div class="bm"><div class="tbd">Kutilmoqda</div><div class="tbd">Kutilmoqda</div></div>';
      }
      return h + '</div>';
    }).join('');
    // mening holatim
    let eliminated = false, inLive = false;
    t.rounds.forEach((r) => r.forEach((mt) => {
      const mine = mt.a === meId || mt.b === meId;
      if (mine && mt.winner && mt.winner !== meId) eliminated = true;
      if (mine && !mt.winner && mt.live) inLive = true;
    }));
    const b = $('#tour-banner'); b.className = 'banner';
    const done = S.tourDone;
    if (t.state === 'done' && t.champion) {
      const won = t.champion.id === meId;
      if (won) b.classList.add('win');
      b.textContent = (won ? '🏆 Siz chempionsiz!' : '🏆 Chempion: ' + t.champion.name) + (done && done.xp ? ` (+${done.xp} ball)` : '');
    } else if (eliminated) b.textContent = 'Siz turnirdan chiqdingiz. Davomini kuzating';
    else if (inLive) b.textContent = 'Jangingiz davom etmoqda';
    else b.textContent = (t.roundName || 'Turnir') + ': keyingi jang tez orada';
    $('#tour-home').hidden = !(eliminated || t.state === 'done');
  }

  // ---------- Reyting ----------
  async function openTop() {
    show('top');
    $('#top-list').innerHTML = '<p class="muted">Yuklanmoqda…</p>';
    const d = await api('/api/leaderboard');
    if (!d.top) return;
    const meId = d.me && d.me.id;
    let h = d.top.map((r) => `<div class="rr ${r.id === meId ? 'me' : ''}"><span class="pl">${medal(r.place)}</span><span class="nm">${esc(r.name)}<small>${esc(r.title)} · ${r.wins} g'alaba</small></span><span class="pt">${r.rating}</span></div>`).join('');
    if (d.me && !d.top.some((r) => r.id === meId)) h += `<div class="rr me"><span class="pl">#${d.me.rank}</span><span class="nm">${esc(d.me.name)}</span><span class="pt">${d.me.rating}</span></div>`;
    $('#top-list').innerHTML = h || '<p class="muted">Hali hech kim o\'ynamagan. Birinchi bo\'ling!</p>';
  }

  // ---------- Jang ----------
  const timerBar = $('#timer-bar'), timerNum = $('#timer-num');
  let raf = 0, lastNum = -1;
  function loopTimer() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!G || G.phase !== 'q') return;
      const rem = G.endsAt - (Date.now() + G.offset);
      const f = clamp(rem / S.qms, 0, 1);
      timerBar.style.transform = `scaleX(${f})`;
      const n = Math.max(0, Math.ceil(rem / 1000));
      if (n !== lastNum) { lastNum = n; timerNum.textContent = n; }
      if (rem > -300) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function setHp(id, v) { $(id).style.transform = `scaleX(${clamp(v, 0.06, 1)})`; }
  function updateScores(scores) {
    G.scores = {}; scores.forEach((s) => { G.scores[s.id] = s; });
    if (G.mode === 'room') {
      const sorted = scores.slice().sort((a, b) => b.score - a.score);
      const my = G.scores[G.meId];
      $('#rb-score').textContent = my ? my.score : 0;
      $('#rb-rank').textContent = my ? sorted.findIndex((s) => s.id === G.meId) + 1 + ' / ' + sorted.length : '–';
    } else {
      const me = G.scores[G.meId] || { score: 0 }, op = G.scores[G.oppId] || { score: 0 };
      $('#sc-me').textContent = me.score; $('#sc-opp').textContent = op.score;
      const maxS = G.total * 220;
      setHp('#hp-me', 1 - op.score / maxS); setHp('#hp-opp', 1 - me.score / maxS);
    }
  }

  function onGameStart(d) {
    clearTimeout(G && G.introTimer);
    S.queueing = false;
    const meId = S.me.id;
    const opp = d.players.find((p) => p.id !== meId);
    G = { id: d.gameId, mode: d.mode, total: d.total, players: d.players, meId, oppId: opp && opp.id, phase: 'intro', offset: 0, scores: {}, myChoice: null, ansCount: 0, idx: -1 };
    S.qms = d.questionMs || 15000;
    const duelLike = d.mode !== 'room';
    $('#arena').hidden = !duelLike; $('#roombar').hidden = duelLike;
    const meP = d.players.find((p) => p.id === meId);
    $('#f-me-name').textContent = meP ? meP.name : 'Siz';
    $('#f-opp-name').textContent = opp ? opp.name : '';
    $('#sc-me').textContent = '0'; $('#sc-opp').textContent = '0'; $('#rb-score').textContent = '0'; $('#rb-rank').textContent = '–'; $('#rb-ans').textContent = '0';
    setHp('#hp-me', 1); setHp('#hp-opp', 1);
    $('#opp-dot').classList.remove('on');
    $('#q-text').textContent = '…'; $('#opts').innerHTML = ''; $('#reveal').hidden = true;
    timerBar.style.transform = 'scaleX(1)'; timerNum.textContent = Math.round(S.qms / 1000);
    // kirish ekrani
    const modeTitle = d.mode === 'tour' ? (d.meta && d.meta.roundName) || 'Turnir jangi' : d.mode === 'room' ? 'Xona jangi · ' + d.players.length + ' ishtirokchi' : 'Duel';
    $('#intro-sub').textContent = modeTitle;
    $('#intro-title').textContent = 'Tayyor bo\'ling';
    $('#in-me').textContent = meP ? meP.name : 'Siz';
    $('#in-opp').textContent = duelLike ? (opp ? opp.name : '') : d.players.length - 1 + ' raqib';
    $('#intro').classList.add('show');
    show('game'); hapticN('warning');
  }
  function onQuestion(d) {
    if (!G || G.id !== d.gameId) return;
    $('#intro').classList.remove('show');
    G.phase = 'q'; G.idx = d.idx; G.endsAt = d.endsAt; G.offset = d.now - Date.now(); G.myChoice = d.myChoice == null ? null : d.myChoice; G.ansCount = 0;
    $('#q-num').textContent = `${d.idx + 1} / ${d.total}`;
    $('#q-cat').textContent = d.category || '';
    $('#q-text').textContent = d.text;
    $('#reveal').hidden = true;
    $('#opp-dot').classList.remove('on'); $('#rb-ans').textContent = '0';
    $$('.fscore em').forEach((e) => e.classList.remove('show'));
    const letters = ['A', 'B', 'C', 'D'];
    $('#opts').innerHTML = d.options.map((o, i) => `<button class="opt${G.myChoice === i ? ' picked' : ''}" data-i="${i}"${G.myChoice != null ? ' disabled' : ''}><span class="k">${letters[i]}</span><span>${esc(o)}</span></button>`).join('');
    lastNum = -1; loopTimer();
  }
  $('#opts').addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b || !G || G.phase !== 'q' || G.myChoice != null) return;
    const i = +b.dataset.i;
    G.myChoice = i; haptic('medium');
    $$('#opts .opt').forEach((x) => { x.disabled = true; });
    b.classList.add('picked');
    api('/api/answer', { gameId: G.id, idx: G.idx, choice: i });
  });
  function onAnswered(d) {
    if (!G || G.id !== d.gameId || d.idx !== G.idx) return;
    if (d.playerId === G.meId) return;
    if (G.mode === 'room') { G.ansCount++; $('#rb-ans').textContent = G.ansCount + ' / ' + (G.players.length - 1); }
    else if (d.playerId === G.oppId) $('#opp-dot').classList.add('on');
  }
  function onReveal(d) {
    if (!G || G.id !== d.gameId) return;
    cancelAnimationFrame(raf); G.phase = 'reveal';
    const my = d.results[G.meId] || {};
    $$('#opts .opt').forEach((b) => {
      const i = +b.dataset.i; b.disabled = true; b.classList.remove('picked');
      if (i === d.correct) b.classList.add('right');
      else if (i === my.choice) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    const rv = $('#reveal');
    const head = my.choice == null ? '<div class="rh no">Vaqt tugadi</div>' : my.ok ? `<div class="rh ok">To'g'ri! +${my.pts} ball · ${fmtMs(my.ms)}${my.streak > 1 ? ' · seriya ×' + my.streak : ''}</div>` : '<div class="rh no">Noto\'g\'ri</div>';
    rv.innerHTML = head + esc(d.explanation || ''); rv.hidden = false;
    my.ok ? hapticN('success') : hapticN('error');
    updateScores(d.scores);
    if (G.mode !== 'room') {
      const op = d.results[G.oppId] || {};
      const pm = $('#pts-me'), po = $('#pts-opp');
      pm.textContent = my.pts ? '+' + my.pts : ''; po.textContent = op.pts ? '+' + op.pts : '';
      pm.classList.toggle('show', !!my.pts); po.classList.toggle('show', !!op.pts);
      const hit = (sel) => { const f = $(sel); f.classList.remove('hit'); void f.offsetWidth; f.classList.add('hit'); };
      if (my.pts) hit('.fighter.opp'); if (op.pts) hit('.fighter.me');
    }
  }
  function onGameEnd(d) {
    if (!G || G.id !== d.gameId) return;
    cancelAnimationFrame(raf);
    const meId = G.meId, mode = G.mode;
    G.phase = 'done';
    const t = $('#r-title'), sub = $('#r-sub'), rk = $('#r-rank');
    const my = d.ranking.find((r) => r.id === meId);
    let cls = 'draw', title = 'DURRANG', subHtml = '';
    if (mode === 'room') {
      cls = my && my.place === 1 ? 'win' : 'draw';
      title = my && my.place === 1 ? 'G\'OLIB!' : (my ? my.place + '-o\'rin' : 'Yakun');
      subHtml = my ? `${my.score} ball · ${my.correct}/${d.total} to'g'ri` : '';
    } else if (mode === 'tour') {
      const adv = d.advances === meId;
      cls = adv ? 'win' : 'loss'; title = adv ? 'KEYINGI BOSQICH' : 'CHETLASHDINGIZ';
      subHtml = adv ? 'Siz g\'alaba qozondingiz!' : 'Turnirni kuzatishingiz mumkin';
    } else {
      cls = d.result === 'draw' ? 'draw' : d.result === meId ? 'win' : 'loss';
      title = cls === 'win' ? 'G\'ALABA' : cls === 'loss' ? 'MAG\'LUBIYAT' : 'DURRANG';
      const dl = d.deltas && d.deltas[meId];
      if (dl) { subHtml = `Reyting: <span class="${dl.delta >= 0 ? 'up' : 'down'}">${dl.delta >= 0 ? '+' : ''}${dl.delta}</span> → <b>${dl.rating}</b> · ${esc(dl.title)}`; }
    }
    t.className = 'rtitle ' + cls; t.textContent = title; sub.innerHTML = subHtml;
    const names = {}; G.players.forEach((p) => { names[p.id] = p.name; });
    rk.innerHTML = d.ranking.slice(0, 10).map((r) => `<div class="rr ${r.id === meId ? 'me' : ''}"><span class="pl">${medal(r.place)}</span><span class="nm">${esc(names[r.id] || r.name)}</span><span class="pt">${r.score}</span></div>`).join('');
    const again = $('#r-again');
    again.textContent = mode === 'duel' ? 'Yana jang' : mode === 'tour' ? 'Turnir jadvali' : 'Xonaga qaytish';
    again.onclick = () => {
      haptic();
      if (mode === 'duel') startSearch();
      else if (mode === 'tour') { renderTour(); show('tour'); }
      else { renderRoom(); show('room'); }
    };
    $('#r-home').onclick = () => { haptic(); if (mode === 'room') api('/api/room/leave', {}), (S.room = null); if (mode === 'tour' && S.tour && S.tour.state === 'done') S.tour = null; show('home'); refreshMe(); };
    G = null;
    cls === 'win' ? hapticN('success') : hapticN('warning');
    show('result');
    refreshMe();
  }

  // ---------- SSE ----------
  function connect() {
    const es = new EventSource('/api/events?auth=' + encodeURIComponent(AUTH));
    const on = (ev, fn) => es.addEventListener(ev, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(ev, err); } });
    es.onopen = () => { $('#offline').hidden = true; };
    es.onerror = () => { $('#offline').hidden = false; };
    on('sync', (d) => {
      S.me = d.me; S.bot = d.bot || ''; S.room = d.room; S.tour = d.tour; S.queueing = d.queue;
      if (d.cfg) S.qms = d.cfg.questionMs;
      renderHome();
      if (!d.inGame && G) { G = null; cancelAnimationFrame(raf); }
      if (S.first) {
        S.first = false;
        if (S.joinCode && !d.inGame && !d.room) { joinRoom(S.joinCode).then(() => { S.joinCode = ''; }); return; }
        if (!d.inGame) route();
      } else if (!d.inGame && S.screen === 'game') route();
    });
    on('room:update', (d) => { S.room = d; renderRoom(); if (S.screen === 'home' || S.screen === 'room' || S.screen === 'result') { if (S.screen !== 'result') show('room'); } });
    on('tour:update', (d) => { S.tour = d; if (S.screen === 'tour') renderTour(); });
    on('tour:done', (d) => { S.tourDone = d; if (S.screen === 'tour') renderTour(); if (d.youWon) hapticN('success'); });
    on('game:start', onGameStart);
    on('game:question', onQuestion);
    on('game:answered', onAnswered);
    on('game:reveal', onReveal);
    on('game:end', onGameEnd);
  }
  connect();
  api('/api/me').then((d) => { if (d && d.me) { S.me = d.me; renderHome(); } });
})();
