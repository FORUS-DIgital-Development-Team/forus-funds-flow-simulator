/* Chart measures read the same cumulative, cent-denominated snapshots as the journal. */
(function (root) {
  'use strict';

  const balance = field => step => step.balances[field];
  const measured = (name, basis, amount) => ({name, basis, amount});
  const views = {
    benefit: {
      note: 'The merchant and VAS supplier receive sales proceeds. Their costs are unknown. The platform earns a separate sponsor-funded fee.',
      people: [
        measured('Merchant', 'Sales receipts, including the member co-payment', balance('merchantReceiptsCents')),
        measured('VAS supplier', 'Cash received for delivered services', balance('supplierReceiptsCents')),
        measured('Platform fee recipient', 'Service fees received', balance('platformFeesCents'))
      ]
    },
    wow: {
      note: 'Operator and cooperative figures include their modelled expenses. Merchant figures show cash collected. Rewards enter the chart when funded.',
      people: [
        measured('Taxi operator', 'Fares and funded rebates after fare fees and fuel', balance('operatorValueCents')),
        measured('Fuel merchant', 'Cash received for fuel sales, before costs', balance('fuelMerchantReceivedCents')),
        measured('Shopping merchant', 'Cash received for shop sales, before costs', balance('shopMerchantReceivedCents')),
        measured('Driver', 'Funded fuel rebate', balance('driverValueCents')),
        measured('Commuter', 'Funded shopping reward', step => step.metrics.shopRebateFundedCents),
        measured('Cooperative', 'Fees and funded rebates after operating expenses', balance('cooperativeValueCents')),
        measured('Service provider', 'Fare fees earned, including any amount withdrawn', step => step.balances.providerValueCents + step.balances.providerPaidCents),
        measured('Referral partner', 'Funded share of fare fees', balance('referralValueCents')),
        measured('Operating supplier', 'Cash received from the cooperative, before costs', balance('coopExpensesPaidCents'))
      ]
    },
    portfolio: {
      note: 'Investor amounts show coupons paid during the term. At maturity, any unrecovered capital reduces the result. Provider amounts show gross receipts.',
      people: [
        measured('Senior investors', 'Coupons received less capital shortfall at maturity', step => step.balances.seniorCouponPaidCents - step.metrics.seniorPrincipalShortfallCents),
        measured('Junior investors', 'Coupons received less capital shortfall at maturity', step => step.balances.juniorCouponPaidCents - step.metrics.juniorPrincipalShortfallCents),
        measured('First-loss investors', 'Capital shortfall recognised at maturity', step => -step.metrics.firstLossShortfallCents || 0),
        measured('Setup and onboarding providers', 'Setup payments received, before costs', balance('setupPaidCents')),
        measured('Servicing and tax recipients', 'Servicing and tax payments received', balance('operatingCostsPaidCents')),
        measured('Residual beneficiaries', 'Cash distributed after the investor waterfall', balance('residualPaidCents'))
      ]
    },
    facility: {
      note: 'Farmer and cooperative figures show proceeds from cleared buyer receipts before production costs. Issuer earnings include only the premium collected.',
      people: [
        measured('Cooperative', 'Sale proceeds retained after protection and repayment', balance('cooperativeRetainedPaidCents')),
        measured('Farmers and designated recipients', 'Protected proceeds paid out', balance('protectedPaidCents')),
        measured('Input suppliers', 'Cash received for approved inputs, before costs', balance('advancePaidCents')),
        measured('Facility issuer', 'Finance premium received above returned principal', balance('premiumRepaidCents'))
      ]
    }
  };

  function measuresFor(result) {
    return views[result.model === 'bond' ? result.view : result.model];
  }

  function create({money, esc, goTo}) {
    const element = id => document.getElementById('earnings-' + id);
    const period = element('period');
    const person = element('person');
    const ranking = element('ranking');
    const axisNumber = new Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:2});
    let scenario, view, currentStep = 0, followStep = false;

    period.addEventListener('change', () => {
      followStep = period.value !== 'full';
      if (followStep) goTo(Number(period.value));
      else draw();
    });
    person.addEventListener('change', draw);
    ranking.addEventListener('click', event => {
      const row = event.target.closest('button[data-person]');
      if (!row) return;
      person.value = row.dataset.person;
      draw();
      ranking.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
    });

    function render(result, index) {
      currentStep = index;
      if (result !== scenario) {
        scenario = result;
        const nextView = measuresFor(result);
        if (view !== nextView) {
          view = nextView;
          element('basis').textContent = view.note;
          person.replaceChildren(...view.people.map((p, i) => new Option(p.name, i)));
          const closing = result.steps[result.steps.length - 1];
          const leader = view.people.reduce((best, p) => p.amount(closing) > best.amount(closing) ? p : best);
          person.value = String(view.people.indexOf(leader));
        }
        period.replaceChildren(new Option('Full scenario', 'full'), ...result.steps.map((step, i) =>
          new Option('Step ' + (i + 1) + ' · ' + step.title, i)));
      }
      draw();
    }

    function draw() {
      const index = followStep ? currentStep : scenario.steps.length - 1;
      period.value = followStep ? String(index) : 'full';
      const step = scenario.steps[index];
      const rows = view.people.map((p, i) => ({...p, id:i, value:p.amount(step)})).sort((a, b) => b.value - a.value);
      const low = Math.min(0, ...rows.map(r => r.value));
      const high = Math.max(0, ...rows.map(r => r.value));
      const scale = high - low || 1;
      const zero = -low / scale * 100;

      ranking.innerHTML = rows.map(row => {
        const left = (Math.min(row.value, 0) - low) / scale * 100;
        const width = Math.abs(row.value) / scale * 100;
        return '<li><button type="button" class="earnings-row" data-person="' + row.id + '" aria-pressed="' + (row.id === Number(person.value)) + '">' +
          '<span class="earnings-name">' + esc(row.name) + '</span><strong class="earnings-value' + (row.value < 0 ? ' negative' : '') + '">' + esc(money(row.value)) + '</strong>' +
          '<small>' + esc(row.basis) + '</small><span class="earnings-track" aria-hidden="true"><span class="earnings-zero" style="left:' + zero + '%"></span>' +
          '<span class="earnings-fill' + (row.value < 0 ? ' negative' : '') + '" style="left:' + left + '%;width:' + width + '%"></span></span></button></li>';
      }).join('');

      const selected = view.people[Number(person.value)];
      const steps = scenario.steps.slice(0, index + 1);
      const values = [0, ...steps.map(selected.amount)];
      const closing = values[values.length - 1];
      element('amount').textContent = money(closing);
      element('amount').classList.toggle('negative', closing < 0);
      element('through').textContent = followStep ? 'Through step ' + (index + 1) : 'Full scenario · ' + (index + 1) + ' steps';
      drawTrend(values, selected.name);
      const changes = [];
      steps.forEach((s, i) => {
        const delta = values[i + 1] - values[i];
        if (!delta) return;
        changes.push('<li><span>Step ' + (i + 1) + ' · ' + esc(s.title) + '</span><strong>' +
          (delta > 0 ? '+' : '') + esc(money(delta)) + '</strong></li>');
      });
      element('events').innerHTML = changes.join('') || '<li>No changes through this step.</li>';
    }

    function drawTrend(values, name) {
      const low = Math.min(...values), high = Math.max(...values);
      const plot = element('plot');
      if (low === high) {
        plot.innerHTML = '<p class="earnings-empty">No amount recorded for this participant through this step.</p>';
        return;
      }
      const last = values.length - 1;
      const x = i => 62 + 366 * i / last;
      const y = v => 143 - 122 * (v - low) / (high - low);
      let path = 'M ' + x(0) + ' ' + y(0);
      for (let i = 1; i <= last; i++) path += ' H ' + x(i) + ' V ' + y(values[i]);
      const ticks = low < 0 && high > 0 ? [high, 0, low] : [high, low];
      const grid = ticks.map(v => '<line x1="62" x2="428" y1="' + y(v) + '" y2="' + y(v) + '" class="' + (v === 0 ? 'axis' : 'grid') + '"/>' +
        '<text x="55" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(axisNumber.format(v / 100)) + '</text>').join('');
      const currency = scenario.model === 'bond' ? 'USD' : 'ZAR';
      const middle = Math.floor(last / 2);
      const midpoint = last < 4 ? '' : '<text x="' + x(middle) + '" y="166" text-anchor="middle">Step ' + middle + '</text>';
      plot.innerHTML = '<svg class="earnings-line" viewBox="0 0 440 174" role="img" aria-label="' +
        esc(name + ', ' + money(values[last]) + ' through step ' + last + '. Exact changes follow the chart.') + '">' +
        '<text x="55" y="11" text-anchor="end">' + currency + '</text>' + grid +
        '<path d="' + path + '"/><circle cx="' + x(last) + '" cy="' + y(values[last]) + '" r="4"/>' +
        '<text x="62" y="166">Start</text>' + midpoint + '<text x="428" y="166" text-anchor="end">Step ' + last + '</text></svg>';
    }

    return {render};
  }

  const api = {create, measuresFor};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParticipantCharts = api;
})(globalThis);
