// 시뮬레이션 로직 검증: node tests/sim-core.test.cjs
// 락이 켜져 있으면 어떤 시드에서도 정확히 6건만 확정되고,
// 락이 꺼져 있으면 재고 = 6 - 확정 건수로 음수까지 내려가는지 확인한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const SimCore = require(path.join(__dirname, '..', 'js', 'sim-core.js'));

const SEEDS = 1000;

for (let seed = 1; seed <= SEEDS; seed++) {
  const m = SimCore.create({ lock: true, seed });
  const events = SimCore.runToEnd(m);
  assert.equal(m.booked, 6, `lock seed ${seed}: booked ${m.booked}`);
  assert.equal(m.rejected, 94);
  assert.equal(m.stock, 0);
  assert.equal(m.oversold, 0);

  // 임계 구역에는 한 번에 하나만 들어간다
  let holders = 0;
  for (const e of events) {
    if (e.type === 'acquire') assert.equal(++holders, 1, `lock seed ${seed}: two holders`);
    if (e.type === 'release') holders--;
  }
}

let minOver = Infinity, maxOver = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const m = SimCore.create({ lock: false, seed });
  SimCore.runToEnd(m);
  assert.equal(m.booked + m.rejected, 100);
  assert.equal(m.stock, 6 - m.booked);
  assert.equal(m.oversold, Math.max(0, m.booked - 6));
  minOver = Math.min(minOver, m.oversold);
  maxOver = Math.max(maxOver, m.oversold);
}

console.log(`락 켜짐: ${SEEDS}번 모두 정확히 6건 확정`);
console.log(`락 꺼짐: 초과 예약 ${minOver}~${maxOver}건`);
