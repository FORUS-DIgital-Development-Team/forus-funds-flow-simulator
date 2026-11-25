/* WOW fuel-only annual projections. Source months and cash assumptions stay distinct. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const {ratio, pct, split} = node ? require('./model') : root.FlowModel;
  const {savingsOn} = node ? require('./velocity') : root.Velocity;
  const months = [
    {id:'2025-10', label:'October 2025', litres:200},
    {id:'2025-11', label:'November 2025', litres:1735},
    {id:'2025-12', label:'December 2025', litres:3630},
    {id:'2026-01', label:'January 2026', litres:11569}
  ];
  const report = {litres:17135, distributionCents:3355600};
  const measures = [
    {key:'investor', title:'Investor earnings', note:'Share of processing savings less annual investor costs.'},
    {key:'sponsor', title:'Sponsor savings retained', note:'Processing savings retained before paying for rebates.'},
    {key:'members', title:'Member fuel rebates', note:'Funded rebates credited to operators and drivers.'}
  ];

  function project(fleet, inputs, terms, baseTurns) {
    const month = months.find(item => item.id === fleet.month);
    if (!month) throw new Error('Select a reported WOW fuel month.');
    for (const [value, min, max, label] of [
      [fleet.start, 1, 1000000, 'Starting vehicles'], [fleet.target, 0, 1000000, 'Participating vehicles'],
      [fleet.turns, 0, 360, 'Target turns'], [baseTurns, 1, 360, 'Baseline turns']
    ]) {
      if (!Number.isInteger(value) || value < min || value > max)
        throw new Error(label + ' must be a whole number from ' + min.toLocaleString('en-ZA') + ' to ' + max.toLocaleString('en-ZA') + '.');
    }
    if (inputs.cashInSettled && inputs.fuelPrice <= 0) throw new Error('Set a positive WOW fuel price in the transaction assumptions.');
    const denominator = BigInt(fleet.start) * BigInt(baseTurns);
    function point(label, vehicles, turns) {
      const usableTurns = fleet.extraDemand ? turns : Math.min(turns, baseTurns);
      const numerator = inputs.cashInSettled ? BigInt(month.litres * 12) * BigInt(vehicles) * BigInt(usableTurns) : 0n;
      const litres = Number(numerator) / Number(denominator);
      const sales = ratio(numerator * BigInt(Math.round(inputs.fuelPrice * 100)), denominator);
      const settled = pct(sales, inputs.merchantSettlementPct);
      const savings = savingsOn(settled, terms);
      const grossRebate = ratio(numerator * BigInt(report.distributionCents), denominator * BigInt(report.litres));
      const rebate = pct(grossRebate, inputs.rewardFundingPct);
      const [operators, drivers, cooperative] = split(rebate, [inputs.fuelOperatorPct, inputs.fuelDriverPct, inputs.fuelCoopPct]);
      return {label, vehicles, turns, litres, settled, savings, fundedRebates:rebate, operators, drivers, cooperative,
        investor:savings.investor - Math.round(terms.expense * 100), sponsor:savings.sponsor,
        members:operators + drivers, sponsorFunding:rebate - savings.sponsor};
    }
    return {
      basis:{month:month.id, monthlyLitres:month.litres, periodLitres:report.litres, periodDistributionCents:report.distributionCents},
      assumptions:{...fleet, baseTurns}, points:[
        point('Starting fleet', fleet.start, baseTurns),
        point('Target fleet', fleet.target, baseTurns),
        point('Target fleet + turns', fleet.target, fleet.turns)
      ]
    };
  }

  function create({money, esc}) {
    const el = id => document.getElementById(id);
    const monthInput = el('fleet-month'), turnsInput = el('fleet-turns'), follow = el('fleet-follow');
    const number = new Intl.NumberFormat('en-ZA', {maximumFractionDigits:2});
    const volume = litres => number.format(litres) + ' L';
    const largestMonth = Math.max(...months.map(m => m.litres));
    monthInput.innerHTML = months.map(m => '<option value="' + m.id + '">' + m.label + ' · ' + volume(m.litres) + '</option>').join('');
    monthInput.value = months.at(-1).id;
    el('wow-history-months').innerHTML = months.map(m => '<li><span>' + m.label + '</span><strong>' + volume(m.litres) +
      '</strong><span class="impact-track" aria-hidden="true"><i style="width:' + (100 * m.litres / largestMonth) + '%"></i></span></li>').join('');
    let scenario, terms, comparison, last, manualTurns = false;

    function chart(metric, points) {
      const values = points.map(p => p[metric.key]);
      const low = Math.min(0, ...values), high = Math.max(0, ...values), range = high - low || 1;
      const zero = -low / range * 100;
      const bars = points.map(p => {
        const amount = p[metric.key], left = (Math.min(0, amount) - low) / range * 100;
        return '<li><span>' + p.label + '</span><strong>' + esc(money(amount)) + '</strong><div class="fleet-track" aria-hidden="true">' +
          '<i style="left:' + left + '%;width:' + (Math.abs(amount) / range * 100) + '%"></i><b style="left:' + zero + '%"></b></div></li>';
      }).join('');
      return '<section class="fleet-chart fleet-' + metric.key + '"><h4>' + metric.title + '</h4><p>' + metric.note + '</p><ul>' + bars + '</ul></section>';
    }

    function draw() {
      if (scenario?.model !== 'wow') return;
      const results = el('fleet-results');
      last = null;
      if (!comparison) {
        results.innerHTML = '<p class="velocity-error" role="alert">Review the cycle time and commercial assumptions below to calculate fleet earnings.</p>';
        return;
      }
      if (!manualTurns) turnsInput.value = comparison.fastTurns;
      follow.hidden = !manualTurns;
      follow.textContent = 'Use scenario turns (' + comparison.fastTurns + ')';
      const fleet = {month:monthInput.value, start:el('fleet-start').valueAsNumber, target:el('fleet-target').valueAsNumber,
        turns:turnsInput.valueAsNumber, extraDemand:el('fleet-demand').checked};
      try { last = project(fleet, scenario.inputs, terms, comparison.baseTurns); }
      catch (e) {
        results.innerHTML = '<p class="velocity-error" role="alert">' + esc(e.message) + '</p>';
        return;
      }
      const [start, , target] = last.points;
      const litresPerVehicle = last.basis.monthlyLitres / fleet.start;
      const stages = last.points.map(p => '<div><span>' + p.label + '</span><strong>' + volume(p.litres) + '</strong><small>' +
        number.format(p.vehicles) + ' vehicles · ' + p.turns + ' turns</small></div>').join('');
      const funding = target.sponsorFunding < 0 ? 'Savings above rebate spend' : 'Sponsor funding after savings';
      const settlementNote = scenario.inputs.cashInSettled ? '' : ' Cash-in is unremitted in this transaction scenario, so projected purchases are zero.';
      const demandNote = fleet.extraDemand ? '' : ' Annual demand per vehicle is capped at the starting rate.';
      results.innerHTML = '<p class="fleet-basis">' + esc(volume(last.basis.monthlyLitres) + ' in the selected month implies ' + volume(litresPerVehicle) +
        ' per starting vehicle that month. The starting pace is ' + start.turns + ' funded turns per 360-day year.' + settlementNote + demandNote) +
        '</p><h4>Projected annual fuel purchases</h4><div class="fleet-stages">' + stages + '</div>' +
        '<h4>Who earns what over the year?</h4><div class="fleet-charts">' + measures.map(m => chart(m, last.points)).join('') + '</div>' +
        '<p class="fleet-foot">Each chart has its own rand scale. All three cases use the same price and commercial terms.</p>' +
        '<div class="fleet-funding"><strong>' + esc(funding + ' · ' + money(Math.abs(target.sponsorFunding))) + '</strong><p>' +
        esc('At ' + number.format(target.vehicles) + ' vehicles and ' + target.turns + ' turns, sponsors fund ' + money(target.fundedRebates) +
          ' in rebates and retain ' + money(target.sponsor) + ' in estimated savings. At ' + scenario.inputs.rewardFundingPct +
          '% rebate funding, the illustrative split pays operators ' + money(target.operators) + ' (' + scenario.inputs.fuelOperatorPct +
          '%), drivers ' + money(target.drivers) + ' (' + scenario.inputs.fuelDriverPct + '%) and the cooperative ' +
          money(target.cooperative) + ' (' + scenario.inputs.fuelCoopPct + '%).') + '</p></div>' +
        '<p class="fleet-foot">' + esc('Investor and sponsor savings use ' + money(Math.round(scenario.inputs.fuelPrice * 100)) +
          ' per litre, ' + scenario.inputs.merchantSettlementPct + '% merchant settlement, a ' + terms.cost + '% processing cost and a ' + terms.reduction +
          '% reduction in that cost. Customers receive ' + terms.customer + '% of savings, investors receive ' + terms.investor +
          '% and the sponsor keeps the balance. Annual investor costs are ' + money(Math.round(terms.expense * 100)) + '.') + '</p>';
    }
    for (const id of ['fleet-month','fleet-start','fleet-target','fleet-turns','fleet-demand']) {
      el(id).addEventListener('input', () => { if (id === 'fleet-turns') manualTurns = true; draw(); });
    }
    follow.addEventListener('click', () => { manualTurns = false; draw(); turnsInput.focus(); });
    function render(result, assumptions, next) {
      scenario = result; terms = assumptions; comparison = next; draw();
    }
    return {render, snapshot:() => last || {status:'invalid assumptions'}};
  }
  const api = {project, create};
  if (node) module.exports = api;
  else root.WowFleet = api;
})(globalThis);
