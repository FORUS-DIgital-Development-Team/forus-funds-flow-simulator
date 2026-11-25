'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {simulateWow} = require('../model');
const {project} = require('../fuel-fleet');
const {defaults} = require('../velocity');
function fleet(overrides = {}, transaction = {}, pricing = {}) {
  const result = simulateWow(transaction);
  assert.deepEqual(result.errors, []);
  return project({month:'2026-01', start:100, target:200, turns:14, extraDemand:true, ...overrides},
    result.inputs, {...defaults, ...pricing}, 12);
}

test('January litres annualise once and isolate fleet growth from cycle velocity', () => {
  const {basis, points} = fleet();
  assert.equal(basis.monthlyLitres,11569);
  assert.deepEqual(points.map(p => p.litres), [138828,277656,323932]);
  const target = points[2];
  assert.equal(target.investor,1619660);
  assert.equal(target.sponsor,1619660);
  assert.equal(target.members,57092945);
  assert.equal(target.sponsorFunding,61816945);
  for (const p of points) {
    assert.equal(p.fundedRebates,Math.round(p.litres * 3355600 / 17135));
    assert.equal(p.operators + p.drivers + p.cooperative,p.fundedRebates);
    assert.equal(p.savings.customer + p.savings.investor + p.savings.sponsor,p.savings.pool);
  }
});

test('each reported month can anchor the same fleet without assumed growth', () => {
  for (const [month, litres] of [['2025-10',200],['2025-11',1735],['2025-12',3630],['2026-01',11569]]) {
    const p = fleet({month, start:27, target:27, turns:12}).points;
    assert.ok(p.every(s => s.litres === litres * 12 && s.members === p[0].members));
  }
  assert.equal(fleet({extraDemand:false}).points[2].litres,277656);
  assert.equal(fleet({extraDemand:false, turns:6}).points[2].litres,138828);
  assert.equal(fleet({target:0}).points[2].litres,0);
  assert.equal(fleet({turns:0}).points[2].members,0);
});

test('settlement, funding and annual expenses follow their separate cash flows', () => {
  const p = fleet().points[2];
  const pending = fleet({}, {rewardFundingPct:0}).points[2];
  assert.equal(pending.members,0);
  assert.equal(pending.investor,p.investor);
  const half = fleet({}, {merchantSettlementPct:50}, {expense:500}).points[2];
  assert.equal(half.investor,p.investor / 2 - 50000);
  assert.equal(half.members,p.members);
  const blocked = fleet({}, {cashInSettled:false}, {expense:400}).points[2];
  assert.deepEqual([blocked.litres,blocked.members,blocked.sponsor,blocked.investor], [0,0,0,-40000]);
  assert.equal(fleet({}, {multiplier:10}).points[2].litres,p.litres);
  assert.equal(fleet({}, {fuelOperatorPct:0, fuelDriverPct:0}).points[2].members,0);
  assert.equal(fleet({}, {}, {reduction:0}).points[2].sponsor,0);
});

test('invalid numeric inputs do not yield earnings', () => {
  for (const o of [{start:0},{start:NaN},{target:-1},{target:1.5},{turns:361},{month:'invalid'}]) {
    assert.throws(() => fleet(o));
  }
});
