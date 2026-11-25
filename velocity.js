/* Scenario comparisons use integer cents. Only the bond engine posts bond cash flows. */
(function (root) {
  'use strict';
  const Impact = typeof module === 'object' && module.exports ? require('./impact') : root.FundingImpact;
  const presets = {none:[0, 0], cautious:[2, 10], central:[5, 20], high:[9, 30]};
  const defaults = {days:30, saved:5, cost:5, reduction:20, customer:50, investor:25, expense:0};

  function cents(value) {
    if (!Number.isSafeInteger(value)) throw new Error('This illustration exceeds the cent limit. Reduce the scenario size.');
    return value;
  }
  function fraction(value, numerator, denominator) {
    const d = BigInt(denominator);
    return cents(Number((BigInt(cents(value)) * BigInt(numerator) + d / 2n) / d));
  }
  const percent = (value, rate) => fraction(value, Math.round(rate * 100), 10000);
  const row = (label, baseline, same, faster, note) => ({label, baseline, same, faster, note});

  function validate(terms, isBond) {
    const {days, saved} = terms;
    if (!Number.isInteger(days) || days < 1 || days > 360 || !Number.isInteger(saved) || saved < 0 || saved >= days)
      throw new Error('Enter a cycle of 1–360 whole days and remove fewer days than the cycle length.');
    if (isBond) return;
    for (const key of ['cost', 'reduction', 'customer', 'investor']) {
      const rate = terms[key];
      if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6)
        throw new Error('Enter percentages between 0 and 100, with up to two decimal places.');
    }
    if (Math.round(terms.customer * 100) + Math.round(terms.investor * 100) > 10000)
      throw new Error('The customer and investor shares together cannot exceed 100%. The sponsor retains the balance.');
    if (!Number.isFinite(terms.expense) || terms.expense < 0 || terms.expense > 1e9 || Math.abs(terms.expense * 100 - Math.round(terms.expense * 100)) > 1e-4)
      throw new Error('Enter non-negative annual investor costs up to R1 billion, rounded to cents.');
  }

  function savingsOn(sales, t) {
    const pool = percent(percent(sales, t.cost), t.reduction);
    const customer = percent(pool, t.customer);
    const investor = Math.min(pool - customer, percent(pool, t.investor));
    return {pool, customer, investor, sponsor:pool - customer - investor};
  }

  function retail(result, t, baseTurns, fastTurns) {
    const b = result.closing.balances, m = result.closing.metrics;
    const benefit = result.model === 'benefit';
    const sales = cents(benefit ? b.merchantReceiptsCents + b.supplierReceiptsCents : b.fuelMerchantReceivedCents + b.shopMerchantReceivedCents);
    const funding = cents(benefit ? m.consumedCents + b.platformFeesCents : m.totalRewardsFundedCents);
    const {pool, customer, investor, sponsor} = savingsOn(sales, t);
    const expense = Math.round(t.expense * 100);
    const annual = (perTurn, turns) => cents(perTurn * turns);
    const earnings = turns => cents(annual(investor, turns) - expense);
    const rows = [
      row('Investor earnings', 0, earnings(baseTurns), earnings(fastTurns), 'Hypothetical savings share less annual investor costs'),
      row('Sponsor savings retained', 0, annual(sponsor, baseTurns), annual(sponsor, fastTurns), 'Avoided operating cost retained by the sponsor'),
      row('Customer savings', 0, annual(customer, baseTurns), annual(customer, fastTurns), 'Assumed price or fee reduction passed to customers'),
      row('Sponsor funding after savings', annual(funding, baseTurns), annual(funding - sponsor, baseTurns), annual(funding - sponsor, fastTurns),
        benefit ? 'Benefit delivered plus platform fees, less retained savings. Positive values are funding required.' : 'Fuel and shopping rewards funded, less retained savings. Positive values are funding required.'),
      row('Settled merchant sales', annual(sales, baseTurns), annual(sales, baseTurns), annual(sales, fastTurns), 'Purchases settled over the year')
    ];
    const points = [...new Set([Math.max(1, Math.floor(baseTurns / 2)), baseTurns, fastTurns, Math.min(360, fastTurns * 2)])].sort((a,b) => a - b);
    const sensitivity = points.map(turns => ({turns, investor:earnings(turns), sponsor:annual(sponsor, turns)}));
    return {rows, sales, pool, sensitivity, impact:Impact.measure(result, fastTurns), baselineImpact:Impact.measure(result, baseTurns), horizon:'360-day year',
      summary:'Estimated earnings assume an agreement to share processing savings. The sponsor also funds the benefits or rewards shown below.',
      method:'Each turn repeats the selected batch of settled '+(benefit?'merchant and VAS purchases, including member co-payments':'fuel and shopping purchases')+
        '. Assume sufficient demand, a bridge equal to one settled batch repaid in full each turn, and fresh funding for benefits or rewards. '+
        'Start with the addressable processing cost, apply the reduction, then divide the savings once. Sponsor savings offset programme spending. Annual investor costs apply to each digital case; the default is zero. The comparison excludes taxes and compounds no earnings.'};
  }

  function bond(result, baseTurns, fastTurns, simulateBond) {
    const p = {...result.inputs, scenario:'custom'};
    const portfolio = result.view === 'portfolio';
    if (portfolio) p.salesMultiple = result.inputs.salesMultiple * fastTurns / baseTurns;
    else {
      for (let i = 1; i <= p.periodCount; i++) {
        for (const key of ['receipt' + i, 'protected' + i])
          p[key] = fraction(Math.round(result.inputs[key] * 100), fastTurns, baseTurns) / 100;
      }
    }
    const next = baseTurns === fastTurns ? result : simulateBond(p);
    if (next.errors.length) throw new Error('The scaled case exceeds a bond-model limit. ' + next.errors[0]);
    const compare = (label, measure, note) => row(label, cents(measure(result.closing)), null, cents(measure(next.closing)), note);
    const rows = portfolio ? [
      compare('Senior investors', s => s.balances.seniorCouponPaidCents - s.metrics.seniorPrincipalShortfallCents, 'Coupons paid less capital unrecovered at maturity'),
      compare('Junior investors', s => s.balances.juniorCouponPaidCents - s.metrics.juniorPrincipalShortfallCents, 'Coupons paid less capital unrecovered at maturity'),
      compare('First-loss capital provider', s => 0 - s.metrics.firstLossShortfallCents, 'Capital returned less capital contributed'),
      compare('Residual beneficiaries', s => s.balances.residualPaidCents, 'Distribution after expenses and investor priorities')
    ] : [
      compare('Facility issuer earnings', s => s.balances.premiumRepaidCents, 'Premium collected above returned principal'),
      compare('Principal still outstanding', s => s.balances.principalOutstandingCents, 'Uncollected capital at the end of the schedule'),
      compare('Cooperative proceeds retained', s => s.balances.cooperativeRetainedPaidCents, 'Cash from buyers retained before production costs'),
      compare('Protected farmer proceeds', s => s.balances.protectedPaidCents, 'Protected cash paid before the revenue sweep')
    ];
    return {rows, impact:Impact.measure(next), baselineImpact:Impact.measure(result), horizon:portfolio?'five-year bond term':'selected facility schedule',
      summary:portfolio?'Compare the same funded bond at two trading speeds. Coupons and repayment caps can leave investor earnings flat even when cooperatives sell more.':'Compare the same facility advance at two trading speeds. The issuer collects principal first, then premium up to the contract cap.',
      method:portfolio?'The baseline is the selected five-year waterfall. Faster supply-chain turns scale eligible annual sales per advance by the ratio of turn counts. The original annual deployment schedule, arrears rules, costs, coupon rates and cap still apply. No extra bond issuance, compounding or separate sponsor fee is assumed.':
        'The selected schedule is treated as one fixed comparison window. Each period’s buyer receipts and protected amounts scale with the ratio of turn counts. The advance, sweep percentage, number of periods and lifetime cap stay fixed. Remaining principal is shown separately from earned premium.'};
  }

  function compare(result, terms, simulateBond) {
    const isBond = result.model === 'bond';
    validate(terms, isBond);
    const baseTurns = Math.floor(360 / terms.days), fastTurns = Math.floor(360 / (terms.days - terms.saved));
    const data = isBond ? bond(result, baseTurns, fastTurns, simulateBond) : retail(result, terms, baseTurns, fastTurns);
    return {...data, baseTurns, fastTurns, isBond};
  }

  function create({money, esc, simulateBond, fleet}) {
    const el = id => document.getElementById(id);
    const panel = el('projection-panel'), selector = el('velocity-case'), fields = el('velocity-assumptions');
    const impact = Impact.create({money, esc});
    const inputs = Object.fromEntries(Object.keys(defaults).map(key => [key, el('v-' + key)]));
    let scenario, lastComparison;
    const terms = () => Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.valueAsNumber]));

    const views = {fleet:'fleet-panel', capital:'velocity-panel', impact:'impact-panel', participants:'participant-panel'};
    let preferred = new URLSearchParams(location.search).get('view');
    function chooseView(view) {
      panel.dataset.view = view;
      for (const [name, id] of Object.entries(views)) {
        el(id).hidden = name !== view;
        el('show-' + name).setAttribute('aria-pressed', String(name === view));
      }
      panel.hidden = view === 'participants';
      el('participant-period').hidden = view !== 'participants';
    }
    for (const view of Object.keys(views)) {
      el('show-' + view).addEventListener('click', () => {
        preferred = view;
        chooseView(view);
        const url = new URL(location.href);
        url.searchParams.set('view', view);
        history.replaceState(null, '', url);
      });
    }
    el('open-fleet').addEventListener('click', () => {
      el('show-fleet').click();
      el('show-fleet').focus();
    });
    selector.addEventListener('change', () => {
      if (selector.value === 'custom') { fields.open = true; inputs.days.focus(); draw(); return; }
      const [saved, reduction] = presets[selector.value];
      inputs.saved.value = saved;
      inputs.reduction.value = reduction;
      draw();
    });
    fields.addEventListener('input', () => { selector.value = 'custom'; draw(); });

    function draw() {
      if (!scenario) return;
      const t = terms(), isBond = scenario.model === 'bond';
      for (const field of panel.querySelectorAll('.savings-field')) field.hidden = isBond;
      let d;
      try { d = compare(scenario, t, simulateBond); }
      catch (error) {
        lastComparison = null;
        impact.render(scenario, null);
        fleet.render(scenario, t, null);
        for (const key of ['turns','days','summary','method']) el('velocity-' + key).textContent = '';
        el('velocity-results').innerHTML = '<p class="velocity-error" role="alert">' + esc(error.message) + '</p>';
        return;
      }
      lastComparison = {assumptions:t, preset:selector.value, ...d};
      impact.render(scenario, d);
      fleet.render(scenario, t, d);
      el('velocity-turns').textContent = d.baseTurns + ' → ' + d.fastTurns + ' potential turns per year';
      el('velocity-days').textContent = t.days + ' → ' + (t.days - t.saved) + ' days per cash cycle · 360-day year';
      el('velocity-summary').textContent = d.summary;
      el('velocity-method').textContent = d.method;
      const headings = isBond ? ['Baseline', 'At comparison speed', 'Change'] : ['Current process', 'Digital at baseline speed', 'Digital at comparison speed'];
      const valuesFor = r => isBond ? [r.baseline, r.faster, r.faster - r.baseline] : [r.baseline, r.same, r.faster];
      const rows = d.rows.map(r => {
        const values = valuesFor(r);
        const peak = Math.max(1, ...values.map(Math.abs));
        const cells = values.map((v, i) => '<td data-column="' + headings[i] + '"><strong class="' + (v < 0 ? 'negative' : '') + '">' + esc(money(v)) +
          '</strong><span aria-hidden="true" class="velocity-track"><i style="width:' + (Math.abs(v)/peak*100) + '%" class="' + (v < 0 ? 'loss' : '') + '"></i></span></td>').join('');
        return '<tr><th scope="row">' + esc(r.label) + '<small>' + esc(r.note) + '</small></th>' + cells + '</tr>';
      }).join('');
      const caption = isBond ? 'Returns over the ' + d.horizon : 'Estimated amounts over one 360-day year';
      let captionNote;
      if (isBond) {
        const capital = scenario.view === 'portfolio' ? scenario.closing.metrics.fundingCents : scenario.closing.metrics.advanceCents;
        captionNote = 'Capital held fixed in both cases: ' + money(capital) + '.';
      } else {
        const sponsorShare = Math.round((100 - t.customer - t.investor) * 100) / 100;
        captionNote = 'Each turn settles ' + money(d.sales) + ' in sales and saves an estimated ' + money(d.pool) + ' in processing costs. Customers receive ' + t.customer + '%, investors receive ' + t.investor + '% and sponsors retain ' + sponsorShare + '%.';
      }
      const lead = d.rows[0], speedGain = lead.faster - (isBond ? lead.baseline : lead.same);
      const extra = speedGain === 0 ? 'No change from trading speed alone' : money(speedGain) + ' change from trading speed alone';
      const headline = '<div class="capital-headline"><span>' + esc(lead.label + ' · ' + d.horizon) + '</span><strong>' + esc(money(lead.faster)) +
        '</strong><small>' + esc(extra) + '</small></div>';
      const netFunding = isBond ? 0 : d.rows[3].faster;
      const fundingLabel = netFunding < 0 ? ' in savings above programme spending' : ' net funding required after savings';
      const sponsor = isBond ? '' : '<div class="sponsor-headline"><span>Sponsor savings retained · ' + esc(d.horizon) + '</span><strong>' + esc(money(d.rows[1].faster)) +
        '</strong><small>' + esc(money(Math.abs(netFunding)) + fundingLabel) + '</small></div>';
      const sensitivity = isBond ? '' : '<details class="turn-sensitivity"><summary>How much could each funder earn at other trading speeds?</summary>' +
        '<p>Each point repeats the same settled batch and keeps the savings agreement and annual costs fixed. More turns require matching demand, liquidity and fresh reward or benefit funding.</p>' +
        '<table><thead><tr><th scope="col">Turns in 360 days</th><th scope="col">Investor earnings</th><th scope="col">Sponsor savings</th></tr></thead><tbody>' +
        d.sensitivity.map(s => '<tr><th scope="row">' + s.turns + '</th><td>' + esc(money(s.investor)) + '</td><td>' + esc(money(s.sponsor)) + '</td></tr>').join('') +
        '</tbody></table></details>';
      el('velocity-results').innerHTML = '<div class="capital-highlights">' + headline + sponsor + '</div><table class="velocity-table"><caption>' + esc(caption) + '</caption><thead><tr><th scope="col">Recipient or measure</th>' +
        headings.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table><p class="velocity-foot">' + esc(captionNote) + '</p>' + sensitivity;
    }

    function render(result) {
      scenario = result;
      const wow = result.model === 'wow';
      el('show-fleet').hidden = !wow;
      const selected = Object.hasOwn(views, preferred) && (preferred !== 'fleet' || wow);
      chooseView(selected ? preferred : wow ? 'fleet' : 'capital');
      draw();
    }
    function snapshot() { return lastComparison ? {...lastComparison, fundingComparison:impact.snapshot(), fleetProjection:scenario.model === 'wow' ? fleet.snapshot() : undefined} : {status:'invalid assumptions'}; }
    return {render, snapshot};
  }

  const api = {compare, create, defaults, savingsOn};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Velocity = api;
})(globalThis);
