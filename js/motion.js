/*
 * motion.js — GSAP(ScrollTrigger, SplitText, ScrambleText) + Lenis
 *
 * 움직임은 세 군데에만 쓴다.
 *   1) 첫 화면 등장: 한 번의 짜인 시퀀스
 *   2) 성능 개선 섹션: 스크롤로 9.01초 → 226ms 과정을 재생 (데스크톱에서 고정)
 *   3) 사용자 동작에 대한 반응: 시뮬레이션, 탭, 아코디언, 버튼
 * 콘텐츠는 이 파일 없이도 모두 보이고, prefers-reduced-motion이면 모션을 끈다.
 * 규칙은 GreenSock 공식 gsap-skills(core, timeline, scrolltrigger, plugins, performance)를 따른다.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var SplitText = window.SplitText;

  function emit(name) { window.dispatchEvent(new CustomEvent(name)); }
  function ready() { root.classList.add('motion-ready'); }

  if (!gsap || !ScrollTrigger || !SplitText) {
    ready();
    emit('intro:start');
    emit('intro:done');
    return;
  }

  gsap.registerPlugin(ScrollTrigger, SplitText);
  if (window.ScrambleTextPlugin) gsap.registerPlugin(window.ScrambleTextPlugin);

  var EASE = 'expo.out';
  var introPlayed = false;

  function cssColor(name, fallback) {
    return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  }
  function headerOffset() {
    var header = document.querySelector('.site-header');
    return (header ? header.offsetHeight : 68) + 12;
  }

  // ---------- 부드러운 스크롤 (Lenis를 GSAP ticker 하나로 구동) ----------
  function smoothScroll() {
    if (!window.Lenis) return null;
    var lenis = new window.Lenis({ autoRaf: false, lerp: 0.1 });
    lenis.on('scroll', ScrollTrigger.update);
    var tick = function (time) { lenis.raf(time * 1000); };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    var onClick = function (e) {
      var link = e.target.closest && e.target.closest('a[href^="#"]');
      if (!link || link.classList.contains('skip')) return;
      var hash = link.getAttribute('href');
      var target = hash.length > 1 && document.getElementById(hash.slice(1));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -headerOffset(), duration: 1.3 });
      history.replaceState(null, '', hash);
    };
    document.addEventListener('click', onClick);

    return function () {
      lenis.destroy();
      gsap.ticker.remove(tick);
      document.removeEventListener('click', onClick);
    };
  }

  // ---------- 1) 첫 화면 등장 ----------
  function intro() {
    if (introPlayed) { ready(); return; }
    introPlayed = true;

    var split = SplitText.create('.hero-title', { type: 'lines', mask: 'lines', linesClass: 'line' });
    var tl = gsap.timeline({
      defaults: { ease: EASE },
      onStart: function () { emit('intro:start'); },
      onComplete: function () { split.revert(); emit('intro:done'); },
    });

    // fromTo로 도착값까지 적는다. from()은 현재 상태를 도착값으로 읽는데,
    // 가림막(visibility: hidden) 안의 요소는 투명도 0으로 읽혀 그대로 멈춘다.
    function enter(extra) { var v = { autoAlpha: 1, y: 0 }; for (var k in extra) v[k] = extra[k]; return v; }
    tl.fromTo('.site-header .wordmark, .site-header .nav a', { autoAlpha: 0, y: -10 }, enter({ duration: 0.8, stagger: 0.04 }), 0)
      .fromTo(split.lines, { yPercent: 108 }, { yPercent: 0, duration: 1.15, stagger: 0.1 }, 0.05)
      .fromTo('.hero-lede', { autoAlpha: 0, y: 16 }, enter({ duration: 0.9 }), 0.4)
      .fromTo('.hero-actions .btn', { autoAlpha: 0, y: 12 }, enter({ duration: 0.8, stagger: 0.07 }), 0.5)
      .fromTo('.stage', { autoAlpha: 0, y: 48 }, enter({ duration: 1.2 }), 0.3)
      .fromTo('.stage-caption', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 1.0);

    // 제목 속 숫자는 POS 단말기 화면처럼 숫자가 굴러가다 멈춘다
    if (window.ScrambleTextPlugin) {
      gsap.utils.toArray('.hero-title .num').forEach(function (num, k) {
        tl.to(num, { duration: 0.9, ease: 'none', scrambleText: { text: num.textContent, chars: '0123456789', speed: 0.7 } }, 0.3 + k * 0.08);
      });
    }

    // from() 트윈이 시작 상태를 먼저 깔았으니 이제 가림막을 걷는다
    ready();
  }

  // 섹션 제목: 줄 단위로 마스크 안에서 올라온다 (폰트·폭이 바뀌면 다시 나눈다)
  function revealTitle(el) {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'line',
      autoSplit: true,
      onSplit: function (self) {
        return gsap.from(self.lines, {
          yPercent: 108,
          duration: 1.1,
          ease: EASE,
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
        });
      },
    });
  }

  // ---------- 작업: 티켓이 프린터에서 나오듯 위에서부터 인쇄된다 ----------
  function workSection() {
    var title = document.getElementById('work-title');
    if (title) revealTitle(title);

    var tickets = gsap.utils.toArray('.ticket');
    var hidden = 'inset(0% 0% 100% 0% round 14px)';
    var shown = 'inset(0% 0% 0% 0% round 14px)';
    gsap.set(tickets, { clipPath: hidden, y: -18 });
    ScrollTrigger.batch(tickets, {
      start: 'top 88%',
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { clipPath: shown, y: 0, duration: 1.15, ease: 'power3.out', stagger: 0.12, overwrite: true, clearProps: 'clipPath,transform' });
      },
    });

    var cover = document.querySelector('.ticket-cover img');
    if (cover) {
      gsap.set(cover, { scale: 1.14 });
      gsap.fromTo(cover, { yPercent: -6 }, {
        yPercent: 6,
        ease: 'none',
        scrollTrigger: { trigger: '.ticket-cover', start: 'top bottom', end: 'bottom top', scrub: true },
      });
    }
  }

  // ---------- 2) 성능 개선: 스크롤로 재생 ----------
  function latencyStory(pin) {
    var sec = document.querySelector('.latency');
    if (!sec) return null;

    var title = document.getElementById('latency-title');
    if (title) revealTitle(title);

    var steps = gsap.utils.toArray('.step', sec);
    var valueEl = sec.querySelector('[data-latency-value]');
    var unitEl = sec.querySelector('[data-latency-unit]');
    var fill = sec.querySelector('.bar-fill');
    var poolEl = sec.querySelector('[data-pool-size]');
    var base = gsap.utils.toArray('.pool-slot:not(.is-extra)', sec);
    var extra = gsap.utils.toArray('.pool-slot.is-extra', sec);
    var cache = sec.querySelector('.cache-badge');
    var tpsEl = sec.querySelector('[data-tps]');
    var color = { go: cssColor('--go', '#2440FF'), stop: cssColor('--stop', '#E23A2B'), card: cssColor('--card', '#FFFFFF') };
    var after = 226 / 9010;
    var s = { ms: 9010, tps: 10, pool: 10 };

    function render() {
      if (s.ms >= 1000) { valueEl.textContent = (s.ms / 1000).toFixed(2); unitEl.textContent = 's'; }
      else { valueEl.textContent = String(Math.round(s.ms)); unitEl.textContent = 'ms'; }
      poolEl.textContent = String(Math.round(s.pool));
      tpsEl.textContent = String(Math.round(s.tps));
      if (window.tpsGrid) window.tpsGrid.draw(Math.round(s.tps));
    }
    function setStep(active) {
      steps.forEach(function (step, k) {
        step.classList.toggle('is-active', k === active);
        step.classList.toggle('is-done', k < active);
      });
    }

    if (!pin) {
      // 모바일·낮은 화면: 고정하지 않고 화면에 들어올 때 한 번 재생
      s.pool = 50;
      render();
      gsap.set(fill, { scaleX: 1 });
      gsap.timeline({ scrollTrigger: { trigger: '.latency-visual', start: 'top 78%', once: true } })
        .to(s, { ms: 226, tps: 439, duration: 1.8, ease: 'power3.inOut', onUpdate: render }, 0)
        .to(fill, { scaleX: after, duration: 1.8, ease: 'power3.inOut' }, 0);
      return null;
    }

    sec.classList.add('is-scrubbing');
    gsap.set(fill, { scaleX: 0, backgroundColor: color.stop });
    gsap.set(extra, { autoAlpha: 0, scale: 0.4 });
    gsap.set(cache, { autoAlpha: 0 });
    render();
    setStep(0);

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: function () {
        var t = tl.time();
        setStep(t < 1 ? 0 : t < 2 ? 1 : t < 3.15 ? 2 : 3);
        render();
      },
      scrollTrigger: {
        trigger: sec,
        start: 'top top',
        end: function () { return '+=' + Math.round(window.innerHeight * 2.4); },
        pin: true,
        scrub: 0.6,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    tl.to(fill, { scaleX: 1, duration: 1, ease: 'power1.inOut' }, 0)                 // 측정: 9초짜리 응답이 차오른다
      .to(base, { backgroundColor: color.stop, stagger: 0.05, duration: 0.35 }, 1.05) // 원인: 커넥션 10개가 모두 사용 중
      .to(s, { pool: 50, duration: 0.6, ease: 'power2.out' }, 2.05)                  // 조치: 풀 50개
      .to(extra, { autoAlpha: 1, scale: 1, stagger: 0.012, duration: 0.3 }, 2.05)
      .to(base, { backgroundColor: color.card, duration: 0.3 }, 2.45)
      .to(cache, { autoAlpha: 1, duration: 0.3 }, 2.5)                               // 조치: Redis 캐시
      .to(fill, { backgroundColor: color.go, duration: 0.3 }, 2.6)
      .to(s, { ms: 226, tps: 439, duration: 1, ease: 'power2.inOut' }, 3.2)          // 결과
      .to(fill, { scaleX: after, duration: 1, ease: 'power2.inOut' }, 3.2)
      .to({}, { duration: 0.45 });

    return function () { sec.classList.remove('is-scrubbing'); setStep(-1); };
  }

  // 성능 개선 섹션 아래 제목들: 고정 구간이 만든 여백까지 계산되도록 그 뒤에 만든다
  function laterTitles() {
    ['incidents-title', 'spec-title', 'contact-title'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) revealTitle(el);
    });
  }

  // ---------- 3) 버튼이 커서 쪽으로 살짝 끌려온다 (화면당 1~2개만) ----------
  function magnetic() {
    var offs = [];
    gsap.utils.toArray('[data-magnetic]').forEach(function (el) {
      var xTo = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3' });
      var yTo = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3' });
      var move = function (e) {
        var r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.28);
      };
      var leave = function () { xTo(0); yTo(0); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      offs.push(function () {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerleave', leave);
        gsap.set(el, { x: 0, y: 0 });
      });
    });
    return function () { offs.forEach(function (off) { off(); }); };
  }

  // ---------- 조건별 실행 ----------
  var fonts = document.fonts && document.fonts.ready
    ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1200); })])
    : Promise.resolve();

  fonts.then(function () {
    var mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: reduce)', function () {
      ready();
      emit('intro:start');
      emit('intro:done');
    });

    // 페이지 위쪽부터 순서대로 만든다 (ScrollTrigger는 생성 순서대로 위치를 다시 잰다)
    mm.add('(prefers-reduced-motion: no-preference)', function () {
      var offScroll = smoothScroll();
      intro();
      workSection();
      var offMagnetic = window.matchMedia('(hover: hover) and (pointer: fine)').matches ? magnetic() : null;
      return function () {
        if (offScroll) offScroll();
        if (offMagnetic) offMagnetic();
      };
    });

    // 화면 크기가 기준을 넘나들면 이 부분만 되돌리고 다시 만든다
    mm.add({
      motion: '(prefers-reduced-motion: no-preference)',
      pin: '(min-width: 900px) and (min-height: 700px)',
    }, function (context) {
      if (!context.conditions.motion) return undefined;
      var off = latencyStory(context.conditions.pin);
      laterTitles();
      return off || undefined;
    });

    ScrollTrigger.refresh();
  });
})();
