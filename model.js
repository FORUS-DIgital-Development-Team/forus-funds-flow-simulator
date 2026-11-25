/* FORUS flow-of-funds simulator. Illustrative cash terms; all ledger arithmetic uses integer cents. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FlowModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const defaults = Object.freeze({
    benefit: Object.freeze({
      voucherAllocation: 500, couponAllocation: 300, vasAllocation: 200,
      voucherDraw: 250, couponDraw: 100, vasDraw: 50,
      funding: 1000, feePct: 2, couponCoPay: 200, outcome: 'success', multiplier: 1
    }),
    wow: Object.freeze({
      topup: 10000, fare: 6000, fareFeePct: 1, fuel: 4000, fuelPrice: 20,
      fuelRebatePerLitre: 1, fuelOperatorPct: 70, fuelDriverPct: 20,
      shopping: 2000, shopRebatePct: 2, feeCoopPct: 50, feeReferralPct: 0,
      coopExpense: 20, rewardFundingPct: 100, merchantSettlementPct: 100,
      providerPayoutPct: 100, cashout: 0, cashInSettled: true, multiplier: 1
    })
  });

  const LABELS = {
    voucherAllocation: 'Voucher allocation', couponAllocation: 'Coupon allocation',
    vasAllocation: 'VAS allocation', voucherDraw: 'Voucher draw', couponDraw: 'Coupon draw',
    vasDraw: 'VAS draw', funding: 'Programme cash funding', feePct: 'Provider fulfilment fee rate',
    couponCoPay: 'Coupon co-payment', topup: 'Cash top-up', fare: 'Fare value',
    fareFeePct: 'Fare fee rate', fuel: 'Fuel purchase', fuelPrice: 'Fuel price per litre',
    fuelRebatePerLitre: 'Fuel rebate per litre', fuelOperatorPct: 'Operator fuel rebate share',
    fuelDriverPct: 'Driver fuel rebate share', shopping: 'Shopping purchase',
    shopRebatePct: 'Shopping rebate rate', feeCoopPct: 'Cooperative fee share',
    feeReferralPct: 'Referral fee share', coopExpense: 'Cooperative operating expense',
    rewardFundingPct: 'Reward funding percentage', merchantSettlementPct: 'Merchant settlement percentage',
    providerPayoutPct: 'Provider payout percentage', cashout: 'Commuter cash-out'
  };

  function safe(n) {
    if (!Number.isSafeInteger(n)) throw new Error('Scenario exceeds safe cent calculation limits. Reduce the amounts or cohort multiplier.');
    return n;
  }
  function sum(values) { return safe(values.reduce((a, b) => a + b, 0)); }
  function cents(n) { return safe(Math.round(n * 100 + 1e-7)); }
  function ratio(numerator, denominator) {
    if (denominator <= 0n) throw new Error('A calculation denominator must be positive.');
    return safe(Number((numerator + denominator / 2n) / denominator));
  }
  function pct(c, p) { return ratio(BigInt(c) * BigInt(Math.round(p * 10000)), 1000000n); }
  // Largest remainder keeps proportional allocations exact, including one-cent inputs.
  function split(c, percentages) {
    const denominator = 1000000n;
    const portions = percentages.map((p, i) => {
      const numerator = BigInt(c) * BigInt(Math.round(p * 10000));
      return { index: i, amount: Number(numerator / denominator), remainder: numerator % denominator };
    });
    let left = c - portions.reduce((a, p) => a + p.amount, 0);
    const ranked = portions.slice().sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
    for (let i = 0; i < left; i += 1) ranked[i % ranked.length].amount += 1;
    return portions.map(p => safe(p.amount));
  }
  function entry(kind, from, to, amountCents, note) { return { kind, from, to, amountCents, note: note || '' }; }
  function normalize(model, supplied) {
    const errors = [];
    const source = supplied == null ? {} : supplied;
    if (typeof source !== 'object' || Array.isArray(source)) errors.push('Inputs must be an object.');
    const inputs = Object.assign({}, defaults[model]);
    if (!errors.length) Object.keys(inputs).forEach(k => { if (Object.prototype.hasOwnProperty.call(source, k)) inputs[k] = source[k]; });
    for (const key of Object.keys(inputs)) {
      if (key === 'outcome' || key === 'cashInSettled' || key === 'multiplier') continue;
      const raw = inputs[key];
      const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push((LABELS[key] || key) + ' must be a non-negative number.');
        inputs[key] = null;
      } else if (key.endsWith('Pct')) {
        if (n > 100) errors.push((LABELS[key] || key) + ' must be between 0 and 100.');
        inputs[key] = Math.round(n * 10000) / 10000;
      } else {
        if (n > 1000000000) errors.push((LABELS[key] || key) + ' must not exceed R1,000,000,000 per copy.');
        inputs[key] = cents(n) / 100;
      }
    }
    const m = Number(inputs.multiplier);
    if (!Number.isSafeInteger(m) || m < 1 || m > 1000000) errors.push('Cohort multiplier must be a whole number from 1 to 1,000,000.');
    inputs.multiplier = m;
    if (model === 'benefit' && !['success', 'pending', 'failure'].includes(inputs.outcome)) errors.push('Benefit outcome must be success, pending or failure.');
    if (model === 'wow' && typeof inputs.cashInSettled !== 'boolean') errors.push('Cash-in settled must be true or false.');
    return { inputs, errors };
  }
  function invalid(model, inputs, errors) {
    return {
      model, inputs, errors, steps: [],
      closing: { balances: {}, metrics: { status: 'invalid', cashSourcesCents: 0, cashPayoutsCents: 0, cashHeldCents: 0, pendingCents: 0, fundingGapCents: 0 }, checks: { valid: false } }
    };
  }
  function aggregate(object, multiplier) {
    const copy = {};
    Object.keys(object).forEach(k => {
      copy[k] = k.endsWith('Cents') ? safe(object[k] * multiplier) : (k === 'fuelLitres' ? object[k] * multiplier : object[k]);
    });
    return copy;
  }
  function recorder(model, inputs, state, calculate) {
    const steps = [];
    return {
      add(id, title, description, entries, status) {
        const calculated = calculate(status || 'intermediate');
        const snapshot = {
          id, title, description,
          entries: (entries || []).filter(e => e.amountCents !== 0).map(e => Object.assign({}, e, { amountCents: safe(e.amountCents * inputs.multiplier) })),
          balances: aggregate(state, inputs.multiplier),
          metrics: aggregate(calculated.metrics, inputs.multiplier),
          checks: aggregate(calculated.checks, inputs.multiplier)
        };
        steps.push(snapshot);
        return snapshot;
      },
      finish() {
        const last = steps[steps.length - 1];
        return { model, inputs, errors: [], steps, closing: { balances: Object.assign({}, last.balances), metrics: Object.assign({}, last.metrics), checks: Object.assign({}, last.checks) } };
      }
    };
  }

  function benefitCore(supplied) {
    const normalized = normalize('benefit', supplied);
    const p = normalized.inputs;
    const errors = normalized.errors;
    if (errors.length) return invalid('benefit', p, errors);
    const a = [cents(p.voucherAllocation), cents(p.couponAllocation), cents(p.vasAllocation)];
    const d = [cents(p.voucherDraw), cents(p.couponDraw), cents(p.vasDraw)];
    ['Voucher', 'Coupon', 'VAS'].forEach((name, i) => { if (d[i] > a[i]) errors.push(name + ' draw cannot exceed its separate allocation.'); });
    if (d[1] === 0 && p.couponCoPay > 0) errors.push('Coupon co-payment requires a coupon draw greater than zero. Set co-payment to zero when no coupon is selected.');
    if (errors.length) return invalid('benefit', p, errors);
    const allocation = sum(a);
    const draw = sum(d);
    const fee = pct(draw, p.feePct);
    const coPay = cents(p.couponCoPay);
    const state = {
      programmeCashCents: 0, providerCashCents: 0,
      voucherAvailableCents: 0, couponAvailableCents: 0, vasAvailableCents: 0,
      orderCents: 0, issuedVoucherCents: 0, issuedCouponCents: 0,
      platformFeesCents: 0, supplierReceiptsCents: 0, merchantReceiptsCents: 0
    };
    let sources = 0, allocated = 0, consumed = 0, paidFee = 0, paidCoPay = 0;
    const r = recorder('benefit', p, state, status => {
      const available = sum([state.voucherAvailableCents, state.couponAvailableCents, state.vasAvailableCents]);
      const claims = sum([state.issuedVoucherCents, state.issuedCouponCents]);
      const held = sum([state.programmeCashCents, state.providerCashCents]);
      const payouts = sum([state.platformFeesCents, state.supplierReceiptsCents, state.merchantReceiptsCents]);
      const obligation = sum([available, state.orderCents, claims]);
      const cashDifference = safe(sources - held - payouts);
      const entitlementDifference = safe(allocated - available - state.orderCents - claims - consumed);
      const fundingGap = Math.max(0, obligation - held);
      return {
        metrics: {
          status, cashSourcesCents: sources, cashPayoutsCents: payouts, cashHeldCents: held,
          availableCents: available, orderCents: state.orderCents, issuedClaimsCents: claims,
          consumedCents: consumed, fundingGapCents: fundingGap,
          settlementShortfallCents: state.orderCents > 0 ? Math.max(0, state.orderCents - held) : 0,
          allocationCents: allocated, drawCents: draw, feeCents: paidFee, copayCents: paidCoPay,
          pendingCents: sum([state.orderCents, claims])
        },
        checks: {
          cashConserved: cashDifference === 0, cashDifferenceCents: cashDifference,
          entitlementConserved: entitlementDifference === 0, entitlementDifferenceCents: entitlementDifference,
          nonnegative: Object.values(state).every(v => v >= 0), fullyFunded: fundingGap === 0
        }
      };
    });
    state.programmeCashCents = cents(p.funding);
    sources = state.programmeCashCents;
    r.add('programme_funding', 'Sponsor funds the programme', 'Illustrative cash arrangement: sponsor cash enters the programme account. Funding is separate from benefit allocation.', [entry('cash', 'Sponsor', 'Programme cash', state.programmeCashCents)]);
    state.voucherAvailableCents = a[0]; state.couponAvailableCents = a[1]; state.vasAvailableCents = a[2]; allocated = allocation;
    r.add('benefit_allocation', 'Allocate the three benefit balances', 'Separate Voucher, Coupon and VAS entitlements are credited. This journal event creates no additional cash.', [
      entry('entitlement', 'Programme allocation', 'Voucher available', a[0]),
      entry('entitlement', 'Programme allocation', 'Coupon available', a[1]),
      entry('entitlement', 'Programme allocation', 'VAS available', a[2])
    ]);
    state.voucherAvailableCents -= d[0]; state.couponAvailableCents -= d[1]; state.vasAvailableCents -= d[2]; state.orderCents = draw;
    r.add('basket_created', 'Create and debit one Provider basket', 'The basket is priced and checked against each benefit type. Its benefit debit is posted once at creation; no cash moves.', [
      entry('entitlement', 'Voucher available', 'Basket commitment', d[0]),
      entry('entitlement', 'Coupon available', 'Basket commitment', d[1]),
      entry('entitlement', 'VAS available', 'Basket commitment', d[2])
    ]);
    r.add('purchase_pending', 'Request fulfilment from the Provider', 'The Provider request uses the same basket reference. The existing debit remains; a pending or timed-out response is not a second purchase.', [], 'pending');
    if (p.outcome === 'pending') {
      r.add('outcome_pending', 'Await confirmed Provider outcome', 'The outcome is uncertain. Keep the original basket debit and reconcile the same Provider reference. Cash payment, fee and co-payment have not been posted in this scenario.', [], 'pending');
      return r.finish();
    }
    if (p.outcome === 'failure') {
      state.voucherAvailableCents += d[0]; state.couponAvailableCents += d[1]; state.vasAvailableCents += d[2]; state.orderCents = 0;
      r.add('basket_reversed', 'Restore the benefit after confirmed failure', 'One compensating credit restores the original draw. The original debit remains in the journal. This scenario assumes no Provider cash payment occurred.', [
        entry('entitlement', 'Reversed basket', 'Voucher available', d[0]),
        entry('entitlement', 'Reversed basket', 'Coupon available', d[1]),
        entry('entitlement', 'Reversed basket', 'VAS available', d[2])
      ], 'failure');
      return r.finish();
    }
    if (state.programmeCashCents < draw) {
      r.add('awaiting_funding', 'Await cash needed to settle the basket', 'The entitlement basket exists, but programme cash cannot cover its Provider cost. Settlement, fulfilment and fees are blocked until funding arrives. The funding-gap metric also includes all remaining entitlements.', [], 'awaiting_funding');
      return r.finish();
    }
    state.programmeCashCents -= draw; state.providerCashCents += draw;
    state.platformFeesCents += fee; sources += fee; paidFee = fee;
    r.add('provider_paid', 'Pay the Provider and the separate service fee', 'Illustrative settlement at face value: programme cash pays the Provider. The sponsor separately funds the service fee; member benefit principal does not pay it. No second benefit debit is posted.', [
      entry('cash', 'Programme cash', 'Provider cash', draw),
      entry('cash', 'Sponsor', 'Platform fee recipient', fee, 'Separate sponsor-funded service fee')
    ]);
    state.providerCashCents -= d[2]; state.supplierReceiptsCents += d[2]; state.orderCents -= d[2]; consumed += d[2];
    r.add('vas_delivered', 'Supply the VAS benefit', 'The Provider pays the VAS supplier and delivers the selected service. That portion of the basket commitment is consumed; available benefit balances stay unchanged.', [
      entry('cash', 'Provider cash', 'VAS supplier', d[2]),
      entry('entitlement', 'Basket commitment', 'VAS delivered', d[2])
    ]);
    state.issuedVoucherCents = d[0]; state.issuedCouponCents = d[1]; state.orderCents = 0;
    r.add('codes_issued', 'Issue voucher and coupon claims', 'The remaining basket commitment becomes issued voucher and coupon claims. Their face value is not new money. Provider cash backs these claims in the illustrative cash arrangement.', [
      entry('entitlement', 'Basket commitment', 'Issued voucher claim', d[0]),
      entry('entitlement', 'Basket commitment', 'Issued coupon claim', d[1])
    ]);
    const redemption = sum([d[0], d[1]]);
    state.providerCashCents -= redemption; state.merchantReceiptsCents += redemption + coPay;
    state.issuedVoucherCents = 0; state.issuedCouponCents = 0; consumed += redemption;
    sources += coPay; paidCoPay = coPay;
    r.add('merchant_redemption', 'Redeem the claims and settle the Merchant', 'Illustrative Merchant settlement: the Provider pays the voucher and coupon claim values, and the member pays the selected coupon co-payment separately. Issued claims are consumed. The benefit ledger is not debited again.', [
      entry('cash', 'Provider cash', 'Merchant', redemption),
      entry('cash', 'Member co-payment', 'Merchant', coPay),
      entry('entitlement', 'Issued voucher and coupon claims', 'Benefits redeemed', redemption)
    ], 'success');
    return r.finish();
  }

  function wowCore(supplied) {
    const normalized = normalize('wow', supplied);
    const p = normalized.inputs;
    const errors = normalized.errors;
    if (errors.length) return invalid('wow', p, errors);
    p.fuelCoopPct = Math.round((100 - p.fuelOperatorPct - p.fuelDriverPct) * 10000) / 10000;
    p.feeProviderPct = Math.round((100 - p.feeCoopPct - p.feeReferralPct) * 10000) / 10000;
    if (p.fuelCoopPct < 0) errors.push('Operator and driver fuel rebate shares cannot total more than 100%.');
    if (p.feeProviderPct < 0) errors.push('Cooperative and referral fee shares cannot total more than 100%.');
    if (p.fuel > 0 && p.fuelPrice <= 0) errors.push('Fuel price per litre must be greater than zero when fuel is purchased.');
    if (errors.length) return invalid('wow', p, errors);
    const topup = cents(p.topup), fare = cents(p.fare), fuel = cents(p.fuel), shopping = cents(p.shopping);
    const fareFee = pct(fare, p.fareFeePct);
    const feeSplit = split(fareFee, [p.feeCoopPct, p.feeReferralPct, p.feeProviderPct]);
    const fuelEarned = fuel > 0 ? ratio(BigInt(fuel) * BigInt(cents(p.fuelRebatePerLitre)), BigInt(cents(p.fuelPrice))) : 0;
    const fuelFunded = pct(fuelEarned, p.rewardFundingPct);
    const fuelSplit = split(fuelFunded, [p.fuelOperatorPct, p.fuelDriverPct, p.fuelCoopPct]);
    const shopEarned = pct(shopping, p.shopRebatePct), shopFunded = pct(shopEarned, p.rewardFundingPct);
    const fuelSettlement = pct(fuel, p.merchantSettlementPct), shopSettlement = pct(shopping, p.merchantSettlementPct);
    const providerPayout = pct(feeSplit[2], p.providerPayoutPct);
    const coopExpense = cents(p.coopExpense), cashout = cents(p.cashout);
    if (p.cashInSettled) {
      if (fare > topup) errors.push('Fare spending exceeds the funded commuter top-up.');
      if (fuel > fare - fareFee) errors.push('Fuel spending exceeds the operator balance after the fare fee.');
      if (shopping > topup - fare) errors.push('Shopping spending exceeds the commuter balance after fares.');
      if (coopExpense > feeSplit[0] + fuelSplit[2]) errors.push('Cooperative expense exceeds its funded fee and fuel-rebate shares.');
      if (cashout > topup - fare - shopping + shopFunded) errors.push('Cash-out exceeds the commuter balance after shopping and funded shopping rebate.');
    }
    if (errors.length) return invalid('wow', p, errors);
    const state = {
      agentCashCents: 0, reserveCashCents: 0,
      commuterValueCents: 0, operatorValueCents: 0, driverValueCents: 0,
      cooperativeValueCents: 0, providerValueCents: 0, referralValueCents: 0,
      fuelPayableCents: 0, merchantPayableCents: 0,
      fuelMerchantReceivedCents: 0, shopMerchantReceivedCents: 0,
      providerPaidCents: 0, coopExpensesPaidCents: 0, commuterCashoutPaidCents: 0,
      fuelRebatePendingCents: 0, shopRebatePendingCents: 0
    };
    let sources = 0, activity = 0, earnedFee = 0, earnedFuel = 0, fundedFuel = 0, earnedShop = 0, fundedShop = 0, litres = 0;
    const r = recorder('wow', p, state, status => {
      const held = sum([state.agentCashCents, state.reserveCashCents]);
      const wallets = sum([state.commuterValueCents, state.operatorValueCents, state.driverValueCents, state.cooperativeValueCents, state.providerValueCents, state.referralValueCents]);
      const payables = sum([state.fuelPayableCents, state.merchantPayableCents]);
      const payouts = sum([state.fuelMerchantReceivedCents, state.shopMerchantReceivedCents, state.providerPaidCents, state.coopExpensesPaidCents, state.commuterCashoutPaidCents]);
      const pending = sum([state.fuelRebatePendingCents, state.shopRebatePendingCents]);
      const cashDifference = safe(sources - held - payouts);
      const reserveDifference = safe(state.reserveCashCents - wallets - payables);
      return {
        metrics: {
          status, cashSourcesCents: sources, cashPayoutsCents: payouts, cashHeldCents: held,
          walletsCents: wallets, payablesCents: payables, pendingCents: pending, fundingGapCents: pending,
          grossActivityCents: activity, feeCents: earnedFee,
          fuelRebateEarnedCents: earnedFuel, fuelRebateFundedCents: fundedFuel,
          shopRebateEarnedCents: earnedShop, shopRebateFundedCents: fundedShop,
          totalRewardsEarnedCents: sum([earnedFuel, earnedShop]), totalRewardsFundedCents: sum([fundedFuel, fundedShop]),
          fuelLitres: litres
        },
        checks: {
          cashConserved: cashDifference === 0, cashDifferenceCents: cashDifference,
          reserveMatched: reserveDifference === 0, reserveDifferenceCents: reserveDifference,
          nonnegative: Object.values(state).every(v => v >= 0)
        }
      };
    });
    state.agentCashCents = topup; sources = topup;
    r.add('cash_collected', 'Collect cash at the agent', 'The commuter pays the cash agent. Cash held at the agent is not yet spendable wallet value.', [entry('cash', 'Commuter external cash', 'Cash agent', topup)]);
    if (!p.cashInSettled) {
      r.add('awaiting_cash_in', 'Await cash agent remittance', 'The agent still holds the top-up. Spendable wallets remain zero. Fare, fuel, shopping, reward and payout stages are blocked until cash-in settles; planned amounts have not been posted.', [], 'awaiting_cash_in');
      return r.finish();
    }
    state.agentCashCents = 0; state.reserveCashCents = topup; state.commuterValueCents = topup;
    r.add('cash_remitted', 'Remit cash and fund commuter value', 'The agent remits the cash to the programme reserve account. Matching spendable commuter value is recorded. These two records represent the same funded position.', [
      entry('cash', 'Cash agent', 'Programme reserve cash', topup),
      entry('value', 'Funded value issuance', 'Commuter wallet', topup)
    ]);
    state.commuterValueCents -= fare; state.operatorValueCents += fare - fareFee;
    state.cooperativeValueCents += feeSplit[0]; state.referralValueCents += feeSplit[1]; state.providerValueCents += feeSplit[2];
    activity += fare; earnedFee = fareFee;
    r.add('fare_paid', 'Pay the fare and allocate its fee', 'The commuter pays the full fare. The operator bears the configured fare fee. The fare collector acts for the operator and receives no separate wallet credit in this model. Cash stays in the reserve.', [
      entry('value', 'Commuter wallet', 'Operator wallet', fare, 'Full fare before operator-borne fee'),
      entry('value', 'Operator wallet', 'Cooperative wallet', feeSplit[0], 'Operator-borne fee withheld from fare proceeds'),
      entry('value', 'Operator wallet', 'Referral wallet', feeSplit[1], 'Operator-borne fee withheld from fare proceeds'),
      entry('value', 'Operator wallet', 'Provider wallet', feeSplit[2], 'Operator-borne fee withheld from fare proceeds')
    ]);
    state.operatorValueCents -= fuel; state.fuelPayableCents += fuel; activity += fuel;
    litres = fuel > 0 ? fuel / cents(p.fuelPrice) : 0;
    r.add('fuel_purchased', 'Purchase fuel and record the payable', 'Fuel spend moves funded value from the operator wallet to the fuel merchant payable. Cash remains in the reserve until settlement.', [entry('value', 'Operator wallet', 'Fuel merchant payable', fuel)]);
    state.fuelPayableCents -= fuelSettlement; state.reserveCashCents -= fuelSettlement; state.fuelMerchantReceivedCents += fuelSettlement;
    r.add('fuel_settled', 'Settle the fuel merchant', 'The configured portion of the fuel payable is paid from reserve cash. Any unsettled portion remains a funded payable; settlement is not new spending.', [entry('cash', 'Programme reserve cash', 'Fuel merchant', fuelSettlement)]);
    state.fuelRebatePendingCents += fuelEarned; earnedFuel = fuelEarned;
    r.add('fuel_rebate_earned', 'Earn the fuel rebate', 'Purchased litres earn the configured rebate. The receivable is pending until the sponsor actually funds it; it is not spendable wallet value.', [entry('pending', 'Fuel rebate sponsor', 'Pending fuel rebate', fuelEarned)]);
    state.reserveCashCents += fuelFunded; sources += fuelFunded; state.fuelRebatePendingCents -= fuelFunded; fundedFuel = fuelFunded;
    state.operatorValueCents += fuelSplit[0]; state.driverValueCents += fuelSplit[1]; state.cooperativeValueCents += fuelSplit[2];
    r.add('fuel_rebate_funded', 'Fund and distribute the fuel rebate', 'Only cash actually received from the rebate sponsor funds the operator, driver and cooperative shares. Unfunded earned rebate remains pending.', [
      entry('cash', 'Fuel rebate sponsor', 'Programme reserve cash', fuelFunded),
      entry('value', 'Funded fuel rebate', 'Operator wallet', fuelSplit[0]),
      entry('value', 'Funded fuel rebate', 'Driver wallet', fuelSplit[1]),
      entry('value', 'Funded fuel rebate', 'Cooperative wallet', fuelSplit[2])
    ]);
    state.commuterValueCents -= shopping; state.merchantPayableCents += shopping; activity += shopping;
    r.add('shopping_purchased', 'Shop at the participating spaza', 'Shopping moves funded commuter value to the merchant payable. The prior fare remains the operator’s value and is not available to the commuter again.', [entry('value', 'Commuter wallet', 'Shopping merchant payable', shopping)]);
    state.merchantPayableCents -= shopSettlement; state.reserveCashCents -= shopSettlement; state.shopMerchantReceivedCents += shopSettlement;
    r.add('shopping_settled', 'Settle the shopping merchant', 'The configured portion of the shopping payable is paid from reserve cash. The unpaid portion stays in the payable ledger.', [entry('cash', 'Programme reserve cash', 'Shopping merchant', shopSettlement)]);
    state.shopRebatePendingCents += shopEarned; earnedShop = shopEarned;
    r.add('shop_rebate_earned', 'Earn the shopping reward', 'A separate sponsor-funded shopping reward is earned. The pending claim cannot yet be spent.', [entry('pending', 'Shopping reward sponsor', 'Pending shopping reward', shopEarned)]);
    state.reserveCashCents += shopFunded; sources += shopFunded; state.shopRebatePendingCents -= shopFunded; fundedShop = shopFunded; state.commuterValueCents += shopFunded;
    r.add('shop_rebate_funded', 'Fund the commuter reward', 'Received sponsor cash funds the commuter reward. A reward labelled instant still needs this funding event; any remainder stays pending.', [
      entry('cash', 'Shopping reward sponsor', 'Programme reserve cash', shopFunded),
      entry('value', 'Funded shopping reward', 'Commuter wallet', shopFunded)
    ]);
    state.providerValueCents -= providerPayout; state.reserveCashCents -= providerPayout; state.providerPaidCents += providerPayout;
    r.add('provider_paid', 'Pay the service provider', 'The provider withdraws the configured portion of its earned fee share. Any referral share remains in its funded wallet and arises only from the earned fare fee.', [entry('cash', 'Programme reserve cash', 'Provider external account', providerPayout)]);
    state.cooperativeValueCents -= coopExpense; state.reserveCashCents -= coopExpense; state.coopExpensesPaidCents += coopExpense;
    r.add('cooperative_expense', 'Pay the cooperative operating expense', 'The cooperative spends only its own funded fee and rebate share on the configured operating expense. Member principal is not treated as cooperative revenue.', [entry('cash', 'Programme reserve cash', 'Cooperative operating supplier', coopExpense)]);
    state.commuterValueCents -= cashout; state.reserveCashCents -= cashout; state.commuterCashoutPaidCents += cashout;
    const hasPending = state.fuelRebatePendingCents + state.shopRebatePendingCents + state.fuelPayableCents + state.merchantPayableCents + state.providerValueCents > 0;
    r.add('closing_position', cashout > 0 ? 'Pay cash-out and reconcile the closing position' : 'Reconcile the closing position', 'Reserve cash equals all funded wallet balances plus merchant payables. Cumulative external cash sources equal cash still held plus external payouts. Transaction activity is circulation, not additional money.', [entry('cash', 'Programme reserve cash', 'Commuter cash-out', cashout)], hasPending ? 'pending' : 'success');
    return r.finish();
  }

  function run(model, core, inputs) {
    try { return core(inputs); }
    catch (error) { return invalid(model, Object.assign({}, defaults[model], inputs && typeof inputs === 'object' ? inputs : {}), [error && error.message ? error.message : 'Unable to calculate this scenario.']); }
  }
  return Object.freeze({
    defaults,
    simulateBenefit: inputs => run('benefit', benefitCore, inputs),
    simulateWow: inputs => run('wow', wowCore, inputs)
  });
});
