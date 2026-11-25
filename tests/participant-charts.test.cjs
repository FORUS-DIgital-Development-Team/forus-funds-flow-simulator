'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../model');
const Bond = require('../bond-model');
const {measuresFor} = require('../participant-charts');

function amounts(scenario, step = scenario.steps.at(-1)) {
  assert.deepEqual(scenario.errors, []);
  return Object.fromEntries(measuresFor(scenario).people.map(person => [person.name, person.amount(step)]));
}

test('Benefit receipts include the co-payment, exclude pass-through funding and scale once', () => {
  const three = Flow.simulateBenefit({multiplier:3});
  assert.deepEqual(amounts(three), {Merchant:165000, 'VAS supplier':15000, 'Platform fee recipient':2400});
  for (const step of three.steps) {
    assert.equal(Object.values(amounts(three, step)).reduce((a, n) => a + n, 0), step.metrics.cashPayoutsCents);
  }
  for (const outcome of ['failure', 'pending']) {
    assert.ok(Object.values(amounts(Flow.simulateBenefit({outcome}))).every(n => n === 0));
  }
});

test('WOW recognises funded earnings once, excludes wallet top-ups and respects partial cash settlement', () => {
  const wow = Flow.simulateWow({merchantSettlementPct:50, providerPayoutPct:50, cashout:100});
  const terminal = amounts(wow);
  assert.equal(terminal['Fuel merchant'], 200000);
  assert.equal(terminal['Shopping merchant'], 100000);
  assert.equal(terminal['Taxi operator'], 208000);
  assert.equal(terminal.Commuter, 4000);
  assert.equal(terminal.Cooperative, 3000);
  assert.equal(terminal['Service provider'], 3000);
  assert.equal(amounts(wow, wow.steps.find(s => s.id === 'fare_paid'))['Service provider'], 3000);
  assert.equal(amounts(wow, wow.steps.find(s => s.id === 'fuel_rebate_earned')).Driver, 0);
  assert.equal(amounts(wow, wow.steps.find(s => s.id === 'fuel_rebate_funded')).Driver, 4000);
  assert.ok(Object.values(amounts(Flow.simulateWow({cashInSettled:false}))).every(n => n === 0));
});

test('At bond maturity each investor receives the cash distributions less the original investment', () => {
  for (const preset of Bond.presets.portfolio) {
    const bond = Bond.simulate({view:'portfolio', ...preset.changes});
    const final = bond.steps.at(-1);
    const values = amounts(bond);
    for (const [actor, subscribed] of [['Senior investors','seniorFundingCents'], ['Junior investors','juniorFundingCents'], ['First-loss investors','firstLossFundingCents']]) {
      const paid = bond.steps.flatMap(step => step.entries).filter(e => e.kind === 'cash' && e.to === actor)
        .reduce((sum, e) => sum + e.amountCents, 0);
      assert.equal(values[actor], paid - final.metrics[subscribed]);
    }
    assert.equal(amounts(bond, bond.steps[0])['First-loss investors'], 0);
  }
  assert.equal(amounts(Bond.simulate({view:'portfolio'}))['First-loss investors'], -395000000);
});

test('Facility premium excludes returned principal and separates protected and retained proceeds', () => {
  const workbook = amounts(Bond.simulate({view:'facility'}));
  assert.equal(workbook['Facility issuer'], 1500000);
  const trade = amounts(Bond.simulate({view:'facility', ...Bond.presets.facility.find(p => p.id === 'trade').changes}));
  assert.equal(trade['Facility issuer'], 0);
  assert.equal(trade['Farmers and designated recipients'], 40000);
  assert.equal(trade.Cooperative, 120000);
});
