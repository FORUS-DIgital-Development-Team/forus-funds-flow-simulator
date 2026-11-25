/* Scenario outcomes drawn from posted model entries. All monetary amounts use cents. */
(function (root) {
  'use strict';
  function exact(value) {
    if (!Number.isSafeInteger(value)) throw new Error('Reduce the batch size or the number of turns to calculate impact in whole cents.');
    return value;
  }

  function measure(result, turns) {
    const {metrics, balances} = result.closing;
    const annual = value => exact(value * turns);
    if (result.model === 'wow') {
      const rewards = result.steps.filter(s => s.id === 'fuel_rebate_funded' || s.id === 'shop_rebate_funded')
        .flatMap(s => s.entries).filter(e => e.kind === 'value');
      const recipients = ['Operator', 'Driver', 'Cooperative', 'Commuter'].map(name => ({
        label:name, amount:annual(rewards.filter(e => e.to === name + ' wallet').reduce((n, e) => n + e.amountCents, 0))
      }));
      return {
        activity:annual(balances.fuelMerchantReceivedCents + balances.shopMerchantReceivedCents),
        activityLabel:'Settled fuel and shop sales', benefit:annual(metrics.totalRewardsFundedCents),
        benefitLabel:'Rebates credited to wallets', recipients, breakdown:'Who receives the funded rebates?',
        fundingNote:'Commuter top-ups fund purchases. Reward sponsors separately fund fuel and shopping rebates. Fares, wallet transfers and merchant settlements are successive movements of money, so this sales figure counts only the settled fuel and shop purchases.',
        litres:metrics.fuelLitres * turns, fuelRebates:annual(metrics.fuelRebateFundedCents),
        pending:annual(metrics.totalRewardsEarnedCents - metrics.totalRewardsFundedCents)
      };
    }
    if (result.model === 'benefit') {
      return {
        activity:annual(balances.merchantReceiptsCents + balances.supplierReceiptsCents),
        activityLabel:'Settled merchant and service sales', benefit:annual(metrics.consumedCents),
        benefitLabel:'Benefits delivered to members', breakdown:'How did members use their benefits?',
        recipients:[
          {label:'Voucher and coupon redemptions', amount:annual(metrics.consumedCents - balances.supplierReceiptsCents)},
          {label:'Value-added services delivered', amount:annual(balances.supplierReceiptsCents)}
        ],
        fundingNote:'Merchant sales include member co-payments. Delivered benefits count just the sponsor-funded value redeemed or used. Unused allocations and pending claims contribute zero to delivery.'
      };
    }
    if (result.view === 'facility') {
      return {
        activity:metrics.grossReceiptsCents, activityLabel:'Buyer receipts', benefit:metrics.localProceedsCents,
        benefitLabel:'Proceeds retained locally', breakdown:'Who retains proceeds from buyers?',
        recipients:[
          {label:'Protected farmer proceeds', amount:balances.protectedPaidCents},
          {label:'Cooperative proceeds after the sweep', amount:balances.cooperativeRetainedPaidCents}
        ],
        fundingNote:'The facility pays input suppliers up front. The selected buyer schedule determines gross receipts. Local proceeds are amounts paid to farmers and cooperatives before their production costs.'
      };
    }
    return {
      activity:exact(result.annualRows.reduce((n, year) => n + year.eligibleSalesCents, 0)),
      activityLabel:'Eligible cooperative sales', benefit:metrics.totalAdvancesCents, benefitLabel:'Advances deployed to cooperatives',
      breakdown:'Where does the bond capital go?',
      recipients:result.annualRows.map(y => ({label:'Year ' + y.year + ' advances', amount:y.advancesCents})),
      fundingNote:'Eligible sales are projected from each year’s deployed advances. Cooperative advances measure access to working capital and may include redeployed funds. Household earnings and farmer counts require facility and member records.'
    };
  }

  function attribution(activity, alternativePct) {
    if (!Number.isInteger(alternativePct) || alternativePct < 0 || alternativePct > 100)
      throw new Error('Enter a whole percentage from 0 to 100 for sales that would happen anyway.');
    const without = Number((BigInt(exact(activity)) * BigInt(alternativePct) + 50n) / 100n);
    return {without, withFunding:activity, additional:activity - without};
  }

  function create({money, esc}) {
    const el = id => document.getElementById(id);
    const slider = el('impact-alternative'), scope = el('impact-scope');
    let result, comparison, snapshot, programmeAlternative = 0;
    const number = new Intl.NumberFormat('en-ZA', {maximumFractionDigits:2});

    function card(label, amount, note, accent) {
      return '<div class="impact-card' + (accent ? ' accent' : '') + '"><span>' + esc(label) + '</span><strong>' +
        esc(money(amount)) + '</strong><small>' + esc(note) + '</small></div>';
    }

    function draw() {
      if (!comparison) return;
      const data = comparison.impact, baseline = comparison.baselineImpact;
      const wow = result.model === 'wow';
      const rewardOnly = wow && scope.value === 'rewards';
      slider.disabled = rewardOnly;
      slider.value = rewardOnly ? 100 : programmeAlternative;
      el('impact-percent').textContent = slider.value + '%';
      el('impact-scope-field').hidden = !wow;
      const alternativePct = Number(slider.value);
      const amounts = attribution(data.activity, alternativePct);
      snapshot = {scope:rewardOnly ? 'reward sponsors' : 'programme', alternativeSalesPct:alternativePct, ...amounts};
      const horizon = comparison.horizon;
      const note = rewardOnly
        ? 'Removing only the rebate sponsor leaves commuter-funded purchases in place at the selected volume. The funded rebates below would fall to zero without a replacement sponsor.'
        : 'The default assumes all selected sales depend on programme funding. Move the slider to allow for purchases through cash, another merchant or another lender.';
      const cards = card('Sales without this funding', amounts.without, alternativePct + '% of selected sales') +
        card('Sales with this funding', amounts.withFunding, data.activityLabel) +
        card('Additional sales enabled', amounts.additional, 'Funded sales less sales that would happen anyway', true);
      const peak = Math.max(1, ...data.recipients.map(r => r.amount));
      const rows = data.recipients.map(r => '<li><span>' + esc(r.label) + '</span><strong>' + esc(money(r.amount)) +
        '</strong><span class="impact-track" aria-hidden="true"><i style="width:' + (r.amount / peak * 100) + '%"></i></span></li>').join('');
      let fuel = '';
      if (wow) {
        const rate = data.litres > 0 ? money(Math.round(data.fuelRebates / data.litres)) + ' funded per litre purchased' : 'No litres purchased';
        fuel = '<p>' + esc(rate + ' · ' + number.format(data.litres) + ' litres · ' + money(data.pending) + ' in pending rebates excluded.') + '</p>';
      }
      el('impact-results').innerHTML = '<p>' + esc(note) + '</p><h4>Modelled economic activity · ' + esc(horizon) + '</h4><div class="impact-cards">' + cards +
        '</div><p class="velocity-foot">' + esc(data.fundingNote) + '</p><div class="impact-distribution"><div><h4>' + esc(data.benefitLabel) +
        '</h4><strong class="impact-total">' + esc(money(data.benefit)) + '</strong><p>' + esc('At baseline speed: ' + money(baseline.benefit) + ' over the same period.') +
        '</p>' + fuel + '</div><div><h4>' + esc(data.breakdown) + '</h4><ul>' + rows + '</ul></div></div>' +
        '<p class="velocity-foot">These amounts describe the funded scenario. Repeat transactions can benefit the same people. Unique members, household income changes and jobs created require separate evidence.</p>';
    }

    slider.addEventListener('input', () => { programmeAlternative = Number(slider.value); draw(); });
    scope.addEventListener('change', draw);
    function render(scenario, next) {
      result = scenario;
      comparison = next;
      el('wow-reported').hidden = result.model !== 'wow';
      if (comparison) draw();
      else {
        snapshot = null;
        el('impact-results').innerHTML = '<p role="alert">Review the cycle and commercial assumptions below to calculate impact.</p>';
      }
    }
    return {render, snapshot:() => snapshot};
  }
  const api = {measure, attribution, create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FundingImpact = api;
})(globalThis);
