/*
 * sim-core.js — 객실 예약 동시성 시뮬레이션의 순수 로직
 *
 * 화면 그리기와 분리되어 있어 브라우저와 Node 양쪽에서 돌아간다.
 *   락이 있을 때: 대기열 → 락 획득 → 재고 확인과 차감을 한 번에 → 락 반납
 *   락이 없을 때: 재고 확인 → (처리 지연) → 차감
 *                 확인과 차감 사이에 다른 요청이 끼어들어 재고가 음수로 내려간다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SimCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 같은 시드면 같은 결과가 나오도록 하는 작은 난수 생성기 (mulberry32)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DEFAULTS = {
    users: 100,
    stock: 6,
    lock: true,
    launchSpread: 0.7,        // 초: 사용자들이 버튼을 누르는 시점이 흩어진 정도
    flight: [0.55, 0.95],     // 초: 요청이 서버에 닿기까지
    holdHit: 0.14,            // 초: 락 안에서 재고 확인 + 차감 (재고가 남았을 때)
    holdMiss: 0.012,          // 초: 락 안에서 재고 0을 확인하고 매진 응답
    handoff: 0.004,           // 초: 락 반납 뒤 다음 대기자가 획득하기까지
    processing: [0.1, 0.22],  // 초: 락이 없을 때 재고 확인과 차감 사이의 지연
    tick: 1 / 480,
  };

  function create(options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in options) if (options[k] !== undefined) o[k] = options[k];

    var seed = o.seed != null ? o.seed : Math.floor(Math.random() * 4294967296);
    var rand = mulberry32(seed);
    var between = function (r) { return r[0] + rand() * (r[1] - r[0]); };

    var agents = [];
    for (var i = 0; i < o.users; i++) {
      var launchAt = rand() * o.launchSpread;
      agents.push({
        id: i + 1,
        index: i,
        // waiting → flying → queued | processing → critical → booked | rejected
        state: 'waiting',
        launchAt: launchAt,
        arriveAt: launchAt + between(o.flight),
        readStock: null,
        doneAt: null,
        stockAfter: null,
        oversold: false,
        queueIndex: -1,
        order: -1,
      });
    }

    return {
      options: o,
      seed: seed,
      between: between,
      t: 0,
      stock: o.stock,
      initialStock: o.stock,
      booked: 0,
      rejected: 0,
      oversold: 0,
      settled: 0,
      queue: [],
      holder: null,
      lockFreeAt: 0,
      processing: [],
      agents: agents,
      events: [],
      done: false,
    };
  }

  function emit(m, e) {
    e.t = m.t;
    m.events.push(e);
  }

  // 확인 시점에 본 재고가 남아 있었다면 차감하고 예약을 확정한다.
  // 락이 없으면 그 사이 다른 요청이 이미 차감했을 수 있다.
  function settle(m, a) {
    var before = m.stock;
    if (a.readStock > 0) {
      m.stock -= 1;
      a.state = 'booked';
      a.order = m.booked;
      m.booked += 1;
      a.stockAfter = m.stock;
      a.oversold = m.stock < 0;
      if (a.oversold) m.oversold += 1;
      emit(m, {
        type: 'book', id: a.id, index: a.index, read: a.readStock,
        before: before, after: m.stock, oversold: a.oversold, order: a.order,
      });
    } else {
      a.state = 'rejected';
      m.rejected += 1;
      emit(m, { type: 'reject', id: a.id, index: a.index, read: a.readStock });
    }
    m.settled += 1;
  }

  function tick(m, dt) {
    var o = m.options;
    var i, a;
    m.t += dt;
    var t = m.t;

    for (i = 0; i < m.agents.length; i++) {
      a = m.agents[i];
      if (a.state === 'waiting' && t >= a.launchAt) {
        a.state = 'flying';
        emit(m, { type: 'launch', id: a.id, index: a.index });
      }
      if (a.state === 'flying' && t >= a.arriveAt) {
        if (o.lock) {
          a.state = 'queued';
          a.queueIndex = m.queue.length;
          m.queue.push(a);
          emit(m, { type: 'queue', id: a.id, index: a.index, position: a.queueIndex });
        } else {
          a.state = 'processing';
          a.readStock = m.stock;
          a.doneAt = t + m.between(o.processing);
          m.processing.push(a);
          emit(m, { type: 'read', id: a.id, index: a.index, read: a.readStock });
        }
      }
    }

    if (o.lock) {
      if (m.holder && t >= m.holder.doneAt) {
        var released = m.holder;
        settle(m, released);
        m.holder = null;
        m.lockFreeAt = t + o.handoff;
        emit(m, { type: 'release', id: released.id, index: released.index });
      }
      if (!m.holder && m.queue.length && t >= m.lockFreeAt) {
        a = m.queue.shift();
        for (i = 0; i < m.queue.length; i++) m.queue[i].queueIndex = i;
        a.queueIndex = -1;
        a.state = 'critical';
        a.readStock = m.stock;
        a.doneAt = t + (m.stock > 0 ? o.holdHit : o.holdMiss);
        m.holder = a;
        emit(m, { type: 'acquire', id: a.id, index: a.index, read: a.readStock, waiting: m.queue.length });
      }
    } else if (m.processing.length) {
      var due = [];
      m.processing = m.processing.filter(function (p) {
        if (t >= p.doneAt) { due.push(p); return false; }
        return true;
      });
      due.sort(function (x, y) { return x.doneAt - y.doneAt; });
      for (i = 0; i < due.length; i++) settle(m, due[i]);
    }

    if (m.settled === m.agents.length) m.done = true;
  }

  // dt초만큼 진행하고 그 사이 일어난 이벤트를 돌려준다
  function step(m, dt) {
    var len = m.options.tick;
    while (dt > 1e-9 && !m.done) {
      var d = Math.min(len, dt);
      tick(m, d);
      dt -= d;
    }
    var out = m.events;
    m.events = [];
    return out;
  }

  function runToEnd(m, maxSeconds) {
    var all = [];
    var limit = maxSeconds || 60;
    while (!m.done && m.t < limit) all = all.concat(step(m, 0.05));
    return all;
  }

  return { create: create, step: step, runToEnd: runToEnd, DEFAULTS: DEFAULTS };
});
