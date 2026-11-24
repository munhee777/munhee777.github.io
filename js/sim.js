/*
 * sim.js — 첫 화면의 객실 예약 동시성 시뮬레이션을 캔버스에 그린다.
 *
 * 로직은 sim-core.js(SimCore)가 맡는다. 여기서는 요청 하나하나의 상태를
 * 위치와 색으로 바꾸고, 재고 카운터와 로그, 결과 도장을 갱신한다.
 *   대기 인원 → (락 대기열) → 게이트(락) → 객실 카드
 * GSAP이 없어도 동작하고(requestAnimationFrame으로 대체),
 * prefers-reduced-motion이면 이동 없이 결과만 바로 보여 준다.
 */
(function () {
  'use strict';

  var SimCore = window.SimCore;
  var stage = document.querySelector('[data-sim]');
  if (!stage || !SimCore) return;

  var canvas = stage.querySelector('.sim-canvas');
  var ctx = canvas && canvas.getContext('2d');
  if (!ctx) return;

  function q(sel) { return stage.querySelector(sel); }
  var ui = {
    run: q('[data-sim-run]'),
    runLabel: q('[data-sim-run-label]'),
    lock: q('[data-sim-lock]'),
    lockState: q('[data-sim-lock-state]'),
    counter: q('[data-sim-counter]'),
    stock: q('[data-sim-stock]'),
    booked: q('[data-sim-booked]'),
    rejected: q('[data-sim-rejected]'),
    oversold: q('[data-sim-oversold]'),
    log: q('[data-sim-log]'),
    status: q('[data-sim-status]'),
    hint: q('[data-sim-hint]'),
    stamp: q('[data-sim-stamp]'),
  };

  var gsap = window.gsap;
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var N = SimCore.DEFAULTS.users;
  var STOCK = SimCore.DEFAULTS.stock;
  var MINUS = '−';

  // ---------- 색은 CSS 토큰에서 읽는다 ----------
  var C = {};
  function readColors() {
    var cs = getComputedStyle(stage);
    var v = function (name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; };
    C.ink = v('--ink', '#0D0F14');
    C.ink2 = v('--ink-2', '#4A515C');
    C.ink3 = v('--ink-3', '#8A919C');
    C.line = v('--line', '#DCE1E8');
    C.line2 = v('--line-2', '#C3CAD4');
    C.go = v('--go', '#2440FF');
    C.goSoft = v('--go-soft', '#E6EAFF');
    C.stop = v('--stop', '#E23A2B');
    C.card = v('--card', '#FFFFFF');
    C.font = getComputedStyle(document.body).fontFamily;
  }
  readColors();

  // ---------- 작은 수학 도구 ----------
  function hash(i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function bez(a, c, b, t) { var u = 1 - t; return u * u * a + 2 * u * t * c + t * t * b; }
  function signed(n) { return n < 0 ? MINUS + Math.abs(n) : String(n); }

  // ---------- 배치: 흐름 방향(main)과 그 직각(cross) 좌표로 정의한다 ----------
  // 가로 화면이면 왼쪽→오른쪽, 세로 화면이면 위→아래로 흐른다.
  var W = 0, H = 0, dpr = 1, vertical = false, L = 1, X = 1;
  var G = {};
  var particles = [];
  var rooms = [];
  var i;
  for (i = 0; i < STOCK; i++) rooms.push({ x: 0, y: 0, w: 0, h: 0, count: 0, pop: 0 });
  for (i = 0; i < N; i++) {
    particles.push({
      i: i, x: -40, y: -40, hx: 0, hy: 0,
      ph: hash(i, 1) * Math.PI * 2, fr: 0.6 + hash(i, 2) * 0.9,
      state: 'offstage', t0: 0, dur: 1,
      fx: 0, fy: 0, cx: 0, cy: 0, tx: 0, ty: 0, vx: 0, vy: 0,
      alpha: 0, tone: 'ink', slot: -1, trail: [],
    });
  }

  function at(mainPx, crossPx) { return vertical ? { x: crossPx, y: mainPx } : { x: mainPx, y: crossPx }; }

  function layout() {
    var rect = canvas.getBoundingClientRect();
    var oldW = W, oldH = H;
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    vertical = H > W * 1.05;
    L = vertical ? H : W;
    X = vertical ? W : H;

    G.r = Math.max(2, Math.min(3, Math.min(W, H) / 130));
    G.spacing = G.r * 3.3;
    G.crowd = vertical ? { m0: 0.05, m1: 0.25, c0: 0.1, c1: 0.9 } : { m0: 0.04, m1: 0.27, c0: 0.16, c1: 0.84 };
    G.queue = vertical ? { m0: 0.31, m1: 0.5 } : { m0: 0.32, m1: 0.52 };
    G.gate = vertical ? 0.555 : 0.57;
    G.proc = vertical ? { m0: 0.6, m1: 0.69, c0: 0.2, c1: 0.8 } : { m0: 0.615, m1: 0.705, c0: 0.26, c1: 0.74 };
    G.rooms = vertical ? { m0: 0.75, m1: 0.95 } : { m0: 0.755, m1: 0.955 };

    // 대기 인원: 지터를 준 격자
    var cr = G.crowd;
    var mainSpan = (cr.m1 - cr.m0) * L, crossSpan = (cr.c1 - cr.c0) * X;
    var cols = Math.max(4, Math.round(Math.sqrt(N * mainSpan / crossSpan)));
    var rows = Math.ceil(N / cols);
    particles.forEach(function (p, k) {
      var col = k % cols, row = Math.floor(k / cols);
      var m = cr.m0 * L + (col + 0.5) / cols * mainSpan + (hash(k, 3) - 0.5) * (mainSpan / cols) * 0.7;
      var c = cr.c0 * X + (row + 0.5) / rows * crossSpan + (hash(k, 4) - 0.5) * (crossSpan / rows) * 0.7;
      var h = at(m, c);
      p.hx = h.x; p.hy = h.y;
    });

    // 락 대기열: 게이트 축에서 시작해 한쪽으로 접히는 줄
    G.perRow = Math.max(4, Math.floor(((G.queue.m1 - G.queue.m0) * L) / G.spacing));
    var rowsNeeded = Math.ceil(N / G.perRow);
    var room = 0.86 * X - 0.5 * X;
    G.rowGap = Math.min(G.spacing * 1.25, room / Math.max(1, rowsNeeded - 1));

    // 객실 카드: 흐름 방향 2칸 × 직각 방향 3칸
    var nm = 2, nc = 3, gap = Math.max(6, G.r * 2.6);
    var rmSpan = (G.rooms.m1 - G.rooms.m0) * L, rcSpan = 0.66 * X;
    var cellM = (rmSpan - gap * (nm - 1)) / nm, cellC = (rcSpan - gap * (nc - 1)) / nc;
    var cardM, cardC;
    if (vertical) { cardC = Math.min(cellC, 96); cardM = Math.min(cellM, cardC * 0.62); }
    else { cardM = Math.min(cellM, 92); cardC = Math.min(cellC, cardM * 0.64); }
    // 캔버스가 아직 배치되기 전(높이 0)에도 음수 크기가 나오지 않게
    cardM = Math.max(6, cardM);
    cardC = Math.max(6, cardC);
    var gridM = nm * cardM + (nm - 1) * gap, gridC = nc * cardC + (nc - 1) * gap;
    var startM = ((G.rooms.m0 + G.rooms.m1) / 2) * L - gridM / 2;
    var startC = 0.5 * X - gridC / 2;
    rooms.forEach(function (rm, k) {
      var im = k % nm, ic = Math.floor(k / nm);
      var pos = at(startM + im * (cardM + gap) + cardM / 2, startC + ic * (cardC + gap) + cardC / 2);
      rm.x = pos.x; rm.y = pos.y;
      rm.w = vertical ? cardC : cardM;
      rm.h = vertical ? cardM : cardC;
    });
    G.roomsBox = { m0: startM, m1: startM + gridM, c0: startC, c1: startC + gridC };

    if (oldW && oldH && (oldW !== W || oldH !== H)) {
      var sx = W / oldW, sy = H / oldH;
      particles.forEach(function (p) {
        p.x *= sx; p.y *= sy; p.fx *= sx; p.fy *= sy;
        p.cx *= sx; p.cy *= sy; p.tx *= sx; p.ty *= sy;
        p.trail.length = 0;
      });
    }
  }

  function queueSlot(k) {
    var row = Math.floor(k / G.perRow), idx = k % G.perRow;
    var along = row % 2 === 0 ? idx : G.perRow - 1 - idx;
    return at(G.queue.m1 * L - along * G.spacing, 0.5 * X + row * G.rowGap);
  }
  function criticalPoint() { return at((G.gate + 0.018) * L, 0.5 * X); }
  function gateHalfTarget() { return lockOn ? G.spacing * 0.95 : 0.24 * X; }
  function entryPoint(k) {
    if (lockOn) {
      return at((G.queue.m0 + (G.queue.m1 - G.queue.m0) * 0.25) * L, (0.5 + (hash(k, 6) - 0.5) * 0.3) * X);
    }
    return at((G.gate - 0.03) * L, 0.5 * X + (hash(k, 6) - 0.5) * 2 * gateHalfTarget() * 0.8);
  }
  function lanePoint(k) {
    var pr = G.proc;
    return at((pr.m0 + (pr.m1 - pr.m0) * hash(k, 7)) * L, (pr.c0 + (pr.c1 - pr.c0) * hash(k, 8)) * X);
  }
  // 곡선 이동의 제어점: 직선 중간에서 수직으로 살짝 비켜 간다
  function setCurve(p, bend) {
    var mx = (p.fx + p.tx) / 2, my = (p.fy + p.ty) / 2;
    var dx = p.tx - p.fx, dy = p.ty - p.fy;
    var off = (hash(p.i, 5) - 0.5) * (bend || 0.5);
    p.cx = mx - dy * off;
    p.cy = my + dx * off;
  }

  // ---------- 상태 ----------
  var lockOn = true;
  var running = false;
  var model = null;
  var pendingStart = -1;
  var now = 0;
  var visible = true;
  var interacted = false;
  var gateHalf = 0;
  var holderPulse = 0;
  var logBuffer = [];
  var logDirty = false;
  var lastLogFlush = 0;
  var reduce = reduceMQ.matches;

  // ---------- 화면 바깥 DOM 갱신 ----------
  function setStock(v, animate) {
    ui.stock.textContent = signed(v);
    ui.counter.classList.toggle('is-negative', v < 0);
    if (animate && gsap && !reduce) {
      gsap.fromTo(ui.stock, { yPercent: 40, opacity: 0.55 }, { yPercent: 0, opacity: 1, duration: 0.24, ease: 'power3.out', overwrite: true });
      if (v < 0) gsap.fromTo(ui.counter, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
    }
  }
  function setStats(m) {
    ui.booked.textContent = m ? m.booked : 0;
    ui.rejected.textContent = m ? m.rejected : 0;
    ui.oversold.textContent = m ? m.oversold : 0;
    ui.counter.classList.toggle('has-over', !!(m && m.oversold > 0));
  }

  function pad(id) { return '#' + String(id).padStart(3, '0'); }
  function logLine(e) {
    var t = '+' + e.t.toFixed(2) + 's';
    if (model.options.lock) {
      if (e.type === 'book') return [t, pad(e.id), '락 획득 → 재고 ' + e.before + '→' + e.after, '확정', 'is-go'];
      return [t, pad(e.id), '락 획득 → 재고 0 확인', '매진', 'is-stop'];
    }
    if (e.type === 'book') {
      return [t, pad(e.id), '재고 ' + signed(e.read) + ' 확인 → 차감 ' + signed(e.before) + '→' + signed(e.after),
        e.oversold ? '초과' : '확정', e.oversold ? 'is-stop' : 'is-go'];
    }
    return [t, pad(e.id), '재고 ' + signed(e.read) + ' 확인', '매진', 'is-stop'];
  }
  function pushLog(e) {
    logBuffer.unshift(logLine(e));
    if (logBuffer.length > 4) logBuffer.length = 4;
    logDirty = true;
  }
  function el(tag, text, className) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function flushLog(force) {
    if (!logDirty || (!force && now - lastLogFlush < 0.09)) return;
    lastLogFlush = now;
    logDirty = false;
    var items = logBuffer.map(function (l) {
      var li = document.createElement('li');
      li.append(el('span', l[0]), el('span', l[1]), el('span', l[2], 'log-msg'), el('b', l[3], l[4]));
      return li;
    });
    ui.log.replaceChildren.apply(ui.log, items);
  }
  function clearLog() {
    logBuffer = [];
    logDirty = false;
    ui.log.replaceChildren(el('li', '요청을 보내는 중입니다.', 'is-empty'));
  }

  function showStamp(text, tone) {
    ui.stamp.firstElementChild.textContent = text;
    ui.stamp.className = 'sim-stamp is-' + tone;
    if (gsap && !reduce) {
      gsap.fromTo(ui.stamp, { autoAlpha: 0, scale: 1.8, rotation: -18 },
        { autoAlpha: 1, scale: 1, rotation: -7, duration: 0.55, ease: 'back.out(2.2)', overwrite: true });
    } else {
      ui.stamp.style.visibility = 'visible';
      ui.stamp.style.opacity = '1';
    }
  }
  function hideStamp() {
    if (gsap) gsap.to(ui.stamp, { autoAlpha: 0, duration: 0.2, overwrite: true });
    else { ui.stamp.style.visibility = 'hidden'; ui.stamp.style.opacity = '0'; }
  }

  // ---------- 실행 흐름 ----------
  function sendRun() {
    if (running) return;
    running = true;
    model = null; // 이전 실행의 끝난 모델을 보고 바로 finish()가 불리지 않게
    pendingStart = -1;
    ui.run.disabled = true;
    ui.lock.disabled = true;
    ui.runLabel.textContent = '처리 중';
    ui.hint.hidden = true;
    ui.status.textContent = '';
    hideStamp();
    setStock(STOCK, false);
    setStats(null);
    clearLog();

    if (reduce) { instantRun(); return; }

    var scattered = particles.some(function (p) { return p.state !== 'idle'; });
    if (scattered) {
      regroup(false);
      pendingStart = now + 0.95;
    } else {
      beginModel();
    }
  }

  function beginModel() {
    pendingStart = -1;
    model = SimCore.create({ lock: lockOn });
  }

  // 모두 대기 자리로 돌려보낸다 (처음 등장할 때와 다시 보내기 전)
  function regroup(fromOffstage) {
    rooms.forEach(function (rm) { rm.count = 0; rm.pop = 0; });
    particles.forEach(function (p, k) {
      var delay;
      if (fromOffstage) {
        var s = at(-0.05 * L, (0.2 + hash(k, 10) * 0.6) * X);
        p.x = s.x; p.y = s.y; p.alpha = 0;
        delay = 0.25 + ((p.hx / Math.max(1, W)) + (p.hy / Math.max(1, H))) * 0.22 + hash(k, 9) * 0.35;
        p.dur = 0.95 + hash(k, 11) * 0.5;
      } else {
        if (p.state === 'gone' || p.alpha <= 0.05) {
          var back = at((G.crowd.m0 * L) - 18, 0); // 바깥에서 페이드인
          p.x = vertical ? p.hx : back.x; p.y = vertical ? back.y : p.hy;
          p.alpha = 0;
        }
        delay = hash(k, 9) * 0.3;
        p.dur = 0.55 + hash(k, 11) * 0.25;
      }
      p.fx = p.x; p.fy = p.y; p.tx = p.hx; p.ty = p.hy;
      setCurve(p, 0.35);
      p.t0 = now + delay;
      p.state = 'assemble';
      p.tone = 'ink';
      p.trail.length = 0;
    });
  }

  function onEvent(e) {
    var p = particles[e.index];
    var a = model.agents[e.index];
    switch (e.type) {
      case 'launch': {
        p.state = 'launch';
        p.alpha = 1;
        p.tone = 'ink';
        p.fx = p.x; p.fy = p.y;
        var tgt = entryPoint(p.i);
        p.tx = tgt.x; p.ty = tgt.y;
        setCurve(p, 0.6);
        p.t0 = now;
        p.dur = Math.max(0.05, a.arriveAt - a.launchAt);
        break;
      }
      case 'queue': p.state = 'queued'; break;
      case 'read': p.state = 'processing'; break;
      case 'acquire': p.state = 'critical'; holderPulse = 1; break;
      case 'book': {
        p.slot = e.order % STOCK;
        var rm = rooms[p.slot];
        var stack = Math.floor(e.order / STOCK);
        p.state = 'toRoom';
        p.tone = e.oversold ? 'stop' : 'go';
        p.fx = p.x; p.fy = p.y;
        p.tx = rm.x + (stack ? (hash(p.i, 12) - 0.5) * rm.w * 0.5 : 0);
        p.ty = rm.y + (stack ? (hash(p.i, 13) - 0.5) * rm.h * 0.4 : 0);
        setCurve(p, 0.3);
        p.t0 = now;
        p.dur = 0.45;
        setStock(e.after, true);
        setStats(model);
        pushLog(e);
        break;
      }
      case 'reject': {
        p.state = 'bounce';
        p.tone = 'stop';
        var speed = 130 + hash(p.i, 14) * 150, side = (hash(p.i, 15) - 0.5) * 200;
        p.vx = vertical ? side : -speed;
        p.vy = vertical ? -speed : side;
        setStats(model);
        pushLog(e);
        break;
      }
    }
  }

  function inTransit(p) {
    return p.state === 'launch' || p.state === 'arrived' || p.state === 'queued' ||
      p.state === 'critical' || p.state === 'processing' || p.state === 'toRoom' || p.state === 'bounce';
  }

  function finish() {
    running = false;
    ui.run.disabled = false;
    ui.lock.disabled = false;
    ui.runLabel.textContent = '다시 보내기';
    flushLog(true);
    var m = model;
    if (m.options.lock) {
      ui.status.textContent = '예약 확정 ' + m.booked + '건, 매진 응답 ' + m.rejected + '건, 초과 예약 0건. 분산 락이 재고 확인과 차감을 한 번에 묶었습니다.';
      ui.hint.textContent = '이번엔 락을 끄고 보내 보세요.';
      showStamp('정확히 ' + m.booked + '건', 'go');
    } else {
      ui.status.textContent = '예약 확정 ' + m.booked + '건, 그중 ' + m.oversold + '건이 초과 예약입니다. 재고 확인과 차감 사이에 다른 요청이 끼어들었습니다.';
      ui.hint.textContent = '락을 켜고 보내면 정확히 ' + STOCK + '건만 확정됩니다.';
      showStamp('초과 예약 ' + m.oversold + '건', 'stop');
    }
    ui.hint.hidden = false;
  }

  // 움직임을 줄인 환경: 끝까지 계산한 뒤 결과 화면만 그린다
  function instantRun() {
    model = SimCore.create({ lock: lockOn });
    var events = SimCore.runToEnd(model);
    rooms.forEach(function (rm) { rm.count = 0; rm.pop = 0; });
    particles.forEach(function (p) { p.state = 'gone'; p.alpha = 0; p.trail.length = 0; });
    events.forEach(function (e) {
      if (e.type === 'book' || e.type === 'reject') pushLog(e);
      if (e.type !== 'book') return;
      var p = particles[e.index];
      p.slot = e.order % STOCK;
      p.tone = e.oversold ? 'stop' : 'go';
      p.state = 'inRoom';
      rooms[p.slot].count += 1;
    });
    setStock(model.stock, false);
    setStats(model);
    finish();
    draw();
  }

  // ---------- 프레임마다 ----------
  function update(dt) {
    var k = 1 - Math.exp(-dt * 11);
    var targetHalf = gateHalfTarget();
    gateHalf += (targetHalf - gateHalf) * (1 - Math.exp(-dt * 8));
    holderPulse = Math.max(0, holderPulse - dt * 2.2);
    var crit = criticalPoint();
    var wob = reduce ? 0 : G.r * 0.9;

    particles.forEach(function (p) {
      var a = model && model.agents[p.i];
      switch (p.state) {
        case 'idle':
          p.x = p.hx + Math.sin(now * p.fr + p.ph) * wob;
          p.y = p.hy + Math.cos(now * p.fr * 1.3 + p.ph) * wob;
          break;
        case 'assemble':
        case 'launch':
        case 'toRoom': {
          var t = clamp01((now - p.t0) / p.dur);
          if (p.state === 'assemble' && now >= p.t0) p.alpha = Math.min(1, p.alpha + dt * 3);
          var e = p.state === 'launch' ? easeInOut(t) : easeOut(t);
          p.x = bez(p.fx, p.cx, p.tx, e);
          p.y = bez(p.fy, p.cy, p.ty, e);
          if (t >= 1) {
            if (p.state === 'assemble') { p.state = 'idle'; p.alpha = 1; }
            else if (p.state === 'toRoom') { p.state = 'inRoom'; rooms[p.slot].count += 1; rooms[p.slot].pop = 1; }
            else p.state = 'arrived';
          }
          break;
        }
        case 'queued': {
          var s = queueSlot(a.queueIndex);
          p.x += (s.x - p.x) * k;
          p.y += (s.y - p.y) * k;
          break;
        }
        case 'critical':
          p.x += (crit.x - p.x) * Math.min(1, k * 1.6);
          p.y += (crit.y - p.y) * Math.min(1, k * 1.6);
          break;
        case 'processing': {
          var lp = lanePoint(p.i);
          p.x += (lp.x + Math.sin(now * 9 + p.ph) * G.r * 0.7 - p.x) * k;
          p.y += (lp.y + Math.cos(now * 8 + p.ph) * G.r * 0.7 - p.y) * k;
          break;
        }
        case 'bounce': {
          var damp = Math.pow(0.15, dt);
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= damp; p.vy *= damp;
          p.alpha -= dt / 0.85;
          if (p.alpha <= 0) { p.alpha = 0; p.state = 'gone'; }
          break;
        }
      }

      if (p.state === 'launch' || p.state === 'toRoom' || p.state === 'bounce') {
        p.trail.push(p.x, p.y);
        if (p.trail.length > 10) p.trail.splice(0, 2);
      } else if (p.trail.length) {
        p.trail.length = 0;
      }
    });

    rooms.forEach(function (rm) { rm.pop = Math.max(0, rm.pop - dt * 3.2); });
  }

  // ---------- 그리기 ----------
  function roundRect(x, y, w, h, r) {
    w = Math.max(0, w);
    h = Math.max(0, h);
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function label(text, x, y, align, color, weight) {
    ctx.font = (weight || 600) + ' 12px ' + C.font;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.card;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || C.ink2;
    ctx.fillText(text, x, y);
  }
  function drawLock(x, y, s, closed, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.6, s * 0.16);
    ctx.lineCap = 'round';
    var lift = closed ? 0 : s * 0.32;
    var top = y - s * 0.12;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, top);
    ctx.lineTo(x - s * 0.34, top - s * 0.22 - lift);
    ctx.arc(x, top - s * 0.22 - lift, s * 0.34, Math.PI, 0);
    ctx.lineTo(x + s * 0.34, top - s * 0.22 - lift + (closed ? s * 0.22 : s * 0.06));
    ctx.stroke();
    roundRect(x - s * 0.55, top, s * 1.1, s * 0.82, s * 0.16);
    ctx.fill();
    ctx.restore();
  }

  function drawScene() {
    var mid = 0.5 * X;
    var gm = G.gate * L;
    var postW = Math.max(3, G.r * 1.3);
    var gateC0 = 0.2 * X, gateC1 = 0.8 * X;
    var held = !!(model && model.holder && running);

    // 대기 인원 라벨
    var cr = G.crowd;
    if (vertical) label('동시 접속 ' + N + '명', 0.5 * W, cr.m1 * H + 12);
    else label('동시 접속 ' + N + '명', ((cr.m0 + cr.m1) / 2) * W, cr.c1 * H + 18);

    // 락 대기열 인원
    // (몰려오는 요청이 지나가는 폭보다 바깥에 적어 겹치지 않게)
    if (lockOn && model && running) {
      var waiting = model.queue.length;
      if (vertical) label('대기 ' + waiting + '명', 0.26 * W, ((G.queue.m0 + G.queue.m1) / 2) * H, 'right');
      else label('대기 ' + waiting + '명', ((G.queue.m0 + G.queue.m1) / 2) * W, 0.3 * H);
    }

    // 게이트: 락이 있으면 한 줄만 지나가는 좁은 문, 없으면 활짝 열린 문
    ctx.fillStyle = lockOn ? C.ink : C.ink3;
    var a1 = mid - gateHalf - G.r * 1.4, b1 = mid + gateHalf + G.r * 1.4;
    var seg = function (c0, c1) {
      if (c1 - c0 < 2) return;
      var p0 = at(gm - postW / 2, c0);
      if (vertical) roundRect(p0.x, p0.y, c1 - c0, postW, postW / 2);
      else roundRect(p0.x, p0.y, postW, c1 - c0, postW / 2);
      ctx.fill();
    };
    seg(gateC0, a1);
    seg(b1, gateC1);

    // 락 아이콘과 이름
    var lockPos = at(gm, gateC0 - 18);
    var lockColor = !lockOn ? C.ink3 : held ? C.go : C.ink;
    drawLock(lockPos.x, lockPos.y + 4, 15, lockOn && held, lockColor);
    var namePos = at(gm, gateC0 - 40);
    if (vertical) label(lockOn ? 'Redisson 락' : '락 없음', lockPos.x - 22, lockPos.y, 'right', lockOn ? C.ink : C.ink3, 700);
    else label(lockOn ? 'Redisson 락' : '락 없음', namePos.x, namePos.y, 'center', lockOn ? C.ink : C.ink3, 700);

    // 락을 쥔 요청 주변 고리
    if (held) {
      var cp = criticalPoint();
      ctx.beginPath();
      ctx.strokeStyle = C.go;
      ctx.globalAlpha = 0.25 + holderPulse * 0.5;
      ctx.lineWidth = 1.5;
      ctx.arc(cp.x, cp.y, G.r * (3.2 + holderPulse * 2.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 처리 구역: 확인과 차감이 어떻게 묶이는지
    var pr = G.proc;
    var tl = at(pr.m0 * L, pr.c0 * X), br = at(pr.m1 * L, pr.c1 * X);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = lockOn ? C.line : C.line2;
    ctx.lineWidth = 1;
    roundRect(Math.min(tl.x, br.x) - 6, Math.min(tl.y, br.y) - 6, Math.abs(br.x - tl.x) + 12, Math.abs(br.y - tl.y) + 12, 10);
    ctx.stroke();
    ctx.restore();
    var procText = lockOn ? '확인 + 차감, 한 번에 하나' : '확인 → 차감, 동시에';
    if (vertical) label(procText, 0.5 * W, pr.m1 * H + 16, 'center', lockOn ? C.ink2 : C.stop, 650);
    else label(procText, ((pr.m0 + pr.m1) / 2) * W, pr.c1 * H + 22, 'center', lockOn ? C.ink2 : C.stop, 650);

    // 객실 카드
    rooms.forEach(function (rm, k) {
      var s = 1 + 0.16 * easeOut(rm.pop);
      var w = rm.w * s, h = rm.h * s;
      var over = rm.count > 1;
      roundRect(rm.x - w / 2, rm.y - h / 2, w, h, Math.min(8, h * 0.22));
      if (rm.count === 0) {
        ctx.fillStyle = C.card; ctx.fill();
        ctx.strokeStyle = C.line2; ctx.lineWidth = 1.2; ctx.stroke();
      } else {
        ctx.fillStyle = over ? C.stop : C.go; ctx.fill();
      }
      ctx.font = '700 ' + Math.round(Math.max(10, Math.min(13, h * 0.32))) + 'px ' + C.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rm.count === 0 ? C.ink3 : '#fff';
      ctx.fillText(over ? (100 + k + 1) + ' ×' + rm.count : String(100 + k + 1), rm.x, rm.y + 0.5);
    });
    var rb = G.roomsBox;
    if (vertical) label('객실 ' + STOCK + '개', 0.5 * W, rb.m0 - 12);
    else label('객실 ' + STOCK + '개', ((rb.m0 + rb.m1) / 2), rb.c1 + 18);
  }

  function drawParticles() {
    var r = G.r;
    var tones = { ink: C.ink, go: C.go, stop: C.stop };
    particles.forEach(function (p) {
      if (p.state === 'gone' || p.state === 'inRoom' || p.state === 'offstage' || p.alpha <= 0) return;
      var color = p.state === 'critical' ? C.go : tones[p.tone] || C.ink;
      var alpha = p.state === 'idle' ? 0.5 * p.alpha : p.alpha;

      if (p.trail.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0], p.trail[1]);
        for (var t = 2; t < p.trail.length; t += 2) ctx.lineTo(p.trail[t], p.trail[t + 1]);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.22;
        ctx.lineWidth = r * 1.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.state === 'critical' ? r * 1.35 : r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawScene();
    drawParticles();
  }

  var last = 0;
  function frame() {
    var t = performance.now() / 1000;
    var dt = last ? Math.min(0.05, t - last) : 0;
    last = t;
    if (!visible) return;
    now += dt;

    if (pendingStart >= 0 && now >= pendingStart) beginModel();
    if (running && model && !model.done) {
      var events = SimCore.step(model, dt);
      for (var e = 0; e < events.length; e++) onEvent(events[e]);
    }
    update(dt);
    flushLog(false);
    if (running && model && model.done && !particles.some(inTransit)) finish();
    draw();
  }

  // ---------- 입력 ----------
  ui.run.addEventListener('click', function () {
    interacted = true;
    sendRun();
  });
  ui.lock.addEventListener('click', function () {
    if (running) return;
    interacted = true;
    lockOn = !lockOn;
    ui.lock.setAttribute('aria-checked', String(lockOn));
    ui.lockState.textContent = lockOn ? '켜짐' : '꺼짐';
    if (reduce) draw();
  });

  // 첫 등장 연출이 끝나면 한 번 자동으로 보내 본다 (사용자가 먼저 만지지 않았을 때만)
  var autoQueued = false;
  function autoRun() {
    if (autoQueued || reduce) return;
    autoQueued = true;
    setTimeout(function () {
      if (!interacted && !running && visible) sendRun();
    }, 900);
  }
  window.addEventListener('intro:done', autoRun);
  setTimeout(autoRun, 5000);

  // ---------- 크기, 가시성, 접근성 설정 변화 ----------
  layout();
  gateHalf = gateHalfTarget();
  if (reduce) {
    particles.forEach(function (p) { p.x = p.hx; p.y = p.hy; p.alpha = 1; p.state = 'idle'; });
  } else {
    // 첫 화면 등장 연출이 시작될 때 사람들이 모여든다 (모션 스크립트가 없으면 2초 뒤)
    var entered = false;
    var enter = function () {
      if (entered) return;
      entered = true;
      regroup(true);
    };
    window.addEventListener('intro:start', enter);
    setTimeout(enter, 2000);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { layout(); draw(); }).observe(canvas);
  } else {
    window.addEventListener('resize', function () { layout(); draw(); });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting; // 한 번에 여러 개가 오면 마지막이 최신
      last = 0;
    }, { threshold: 0.05 }).observe(stage);
  }
  reduceMQ.addEventListener('change', function (e) { reduce = e.matches; });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { readColors(); draw(); });

  if (gsap) gsap.ticker.add(frame);
  else (function loop() { frame(); requestAnimationFrame(loop); })();
  draw();
})();
