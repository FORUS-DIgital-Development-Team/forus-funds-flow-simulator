'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../model');
const bond = require('../bond-model');
const velocity = require('../velocity');
const impact = require('../impact');
const compare = (result, changes) => velocity.compare(result, {...velocity.defaults, ...changes}, bond.simulate);

test('extra turns increase earnings only on the agreed share of addressable cost savings', () => {
  const d = compare(flow.simulateWow());
  assert.deepEqual([d.baseTurns, d.fastTurns, d.sales, d.pool], [12, 14, 600000, 6000]);
  assert.deepEqual(d.rows.map(r => r.faster), [21000, 21000, 42000, 315000, 8400000]);
  assert.equal(d.rows[0].faster - d.rows[0].same, 3000);
  assert.deepEqual(d.sensitivity.map(p => [p.turns, p.investor, p.sponsor]), [[6,9000,9000],[12,18000,18000],[14,21000,21000],[28,42000,42000]]);
  assert.equal(compare(flow.simulateWow(), {expense:225}).rows[0].faster, -1500);
  assert.equal(compare(flow.simulateWow(), {saved:0}).rows[0].faster, 18000);
  assert.equal(compare(flow.simulateWow(), {reduction:0}).rows[0].faster, 0);
  assert.throws(() => compare(flow.simulateWow(), {saved:30}), /cycle/);
  assert.throws(() => compare(flow.simulateWow(), {customer:80}), /cannot exceed/);
});

test('credits reconcile to funded rewards when some merchants or sponsors have yet to settle', () => {
  for (const pct of [0, 25, 100]) {
    const d = compare(flow.simulateWow({rewardFundingPct:pct, merchantSettlementPct:25, multiplier:3})).impact;
    assert.equal(d.activity, 150000 * 3 * 14);
    assert.equal(d.benefit, 24000 * pct / 100 * 3 * 14);
    assert.equal(d.recipients.reduce((n,r) => n + r.amount, 0), d.benefit);
    assert.equal(d.pending + d.benefit, 24000 * 3 * 14);
    assert.equal(d.litres, 200 * 3 * 14);
    assert.equal(d.fuelRebates / d.litres, pct);
  }
  const blocked = compare(flow.simulateWow({cashInSettled:false})).impact;
  assert.deepEqual([blocked.activity, blocked.benefit, blocked.litres], [0,0,0]);
});

test('alternative funding assumptions change incremental sales independently of funded credits', () => {
  assert.deepEqual(impact.attribution(8400000,0), {without:0,withFunding:8400000,additional:8400000});
  assert.equal(impact.attribution(8400000,50).additional, 4200000);
  assert.equal(impact.attribution(8400000,100).additional, 0);
  assert.deepEqual(impact.attribution(3,50), {without:2,withFunding:3,additional:1});
  assert.throws(() => impact.attribution(0,101), /percentage/);
});

test('delivered benefit excludes co-payments, fees and failed or unfunded baskets', () => {
  const d = compare(flow.simulateBenefit()).impact;
  assert.deepEqual([d.activity, d.benefit], [60000 * 14, 40000 * 14]);
  assert.equal(d.recipients.reduce((n,r) => n + r.amount,0), d.benefit);
  for (const input of [{outcome:'failure'}, {outcome:'pending'}, {funding:250}]) {
    const blocked = compare(flow.simulateBenefit(input)).impact;
    assert.deepEqual([blocked.activity, blocked.benefit], [0,0]);
  }
});

test('speed changes bond sales while respecting financial terms and the original horizon', () => {
  const portfolio = compare(bond.simulate({view:'portfolio'}));
  assert.equal(portfolio.rows[0].faster, portfolio.rows[0].baseline);
  assert.ok(portfolio.impact.activity > portfolio.baselineImpact.activity);
  assert.equal(portfolio.impact.recipients.length, 5);
  assert.equal(portfolio.impact.recipients.reduce((n,r) => n + r.amount,0), portfolio.impact.benefit);
  const facility = compare(bond.simulate({view:'facility'}));
  assert.equal(facility.rows[0].faster, 15000 * 100);
  assert.equal(facility.impact.activity, 700000 * 100);
  const trade = compare(bond.simulate({view:'facility', ...bond.presets.facility.find(p => p.id === 'trade').changes}));
  assert.equal(trade.rows[0].faster, 0);
  assert.equal(trade.impact.recipients[0].amount, 46667);
  assert.equal(trade.impact.recipients.reduce((n,r) => n + r.amount,0), trade.impact.benefit);
});
