/*
 * main.js — 모션과 상관없이 늘 동작해야 하는 화면 동작
 * 헤더 상태, 현재 섹션 표시, 문제 해결 아코디언, 설계 자료 탭, 처리량 격자
 */
(function () {
  'use strict';

  function refreshTriggers() {
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  // ---------- 헤더: 스크롤하면 배경을 깐다 ----------
  var header = document.querySelector('.site-header');
  function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- 현재 보고 있는 섹션을 메뉴에 표시 ----------
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  if ('IntersectionObserver' in window && links.length) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
        var link = byId[entry.target.id];
        if (link) { link.classList.add('is-active'); link.setAttribute('aria-current', 'true'); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) io.observe(section);
    });
  }

  // ---------- 문제 해결 아코디언 ----------
  document.querySelectorAll('.incident-toggle').forEach(function (button) {
    button.addEventListener('click', function () {
      var item = button.closest('.incident');
      var open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      item.classList.toggle('is-open', open);
      // 패널 높이가 바뀌면 아래쪽 스크롤 트리거 위치를 다시 잰다
      setTimeout(refreshTriggers, 480);
    });
  });

  // ---------- 설계 자료 탭 (좌우 화살표로도 이동) ----------
  document.querySelectorAll('[data-tabs]').forEach(function (wrap) {
    var tabs = Array.prototype.slice.call(wrap.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        panel.hidden = !on;
        if (on && window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          window.gsap.fromTo(panel, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out' });
        }
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        select(next);
      });
    });
  });

  // ---------- 커넥션 풀 칸 50개 ----------
  var pool = document.querySelector('[data-pool]');
  if (pool) {
    for (var s = 0; s < 50; s++) {
      var slot = document.createElement('i');
      slot.className = s < 10 ? 'pool-slot' : 'pool-slot is-extra';
      pool.appendChild(slot);
    }
  }

  // ---------- 초당 처리량 격자: 칸 하나가 요청 하나 ----------
  // 정해진 무작위 순서로 켜져서 숫자가 늘수록 화면이 고르게 채워진다
  function TpsGrid(canvas) {
    var ctx = canvas.getContext('2d');
    var cols = 45, rows = 10, total = cols * rows;
    var rank = new Array(total);
    var order = [];
    var n, seed = 7;
    for (n = 0; n < total; n++) order.push(n);
    for (n = total - 1; n > 0; n--) {
      seed = (seed * 16807) % 2147483647;
      var j = seed % (n + 1);
      var tmp = order[n]; order[n] = order[j]; order[j] = tmp;
    }
    order.forEach(function (cell, position) { rank[cell] = position; });

    var lit = Number(canvas.getAttribute('data-lit')) || 439;
    var colors = {};
    function readColors() {
      var cs = getComputedStyle(canvas);
      colors.on = cs.getPropertyValue('--go').trim() || '#2440FF';
      colors.off = cs.getPropertyValue('--shade').trim() || '#ECEFF4';
    }
    function draw(count) {
      if (count != null) lit = count;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      var gap = rect.width < 420 ? 2 : 3;
      var size = Math.min((rect.width - gap * (cols - 1)) / cols, (rect.height - gap * (rows - 1)) / rows);
      for (var c = 0; c < total; c++) {
        ctx.fillStyle = rank[c] < lit ? colors.on : colors.off;
        ctx.fillRect((c % cols) * (size + gap), Math.floor(c / cols) * (size + gap), size, size);
      }
    }
    readColors();
    if ('ResizeObserver' in window) new ResizeObserver(function () { draw(); }).observe(canvas);
    draw();
    return { draw: draw };
  }

  var gridCanvas = document.querySelector('[data-tps-grid]');
  if (gridCanvas && gridCanvas.getContext) window.tpsGrid = TpsGrid(gridCanvas);
})();
