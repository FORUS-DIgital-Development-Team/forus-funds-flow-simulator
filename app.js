(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const formatters = { ZAR: new Intl.NumberFormat('en-ZA', {style:'currency',currency:'ZAR',minimumFractionDigits:2,maximumFractionDigits:2}), USD: new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}) };
  const currencyCode = () => mode === 'bond' ? 'USD' : 'ZAR';
  const num = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 });
  const money = value => formatters[currencyCode()].format((Number(value) || 0) / 100).replace(/\u00a0/g, ' ');
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const clone = object => JSON.parse(JSON.stringify(object));
  let mode = location.hash === '#bond' ? 'bond' : location.hash === '#wow' ? 'wow' : 'benefit';
  let bondView = 'portfolio';
  let result = null;
  let stepIndex = 0;
  let timer = null;
  let currentInputs = null;
  let diagram = null;
  let earningsCharts;
  const modelStates = {};

  const definitions = {
    benefit: {
      title: 'Aggregated Benefit Ledger',
      description: 'Trace a sponsor-funded benefit through allocation, basket creation, fulfilment and redemption. A change in entitlement does not necessarily move cash.',
      primary: [
        ['funding','Programme cash funding (R)', 'Cash actually received from the sponsor.'],
        ['voucherDraw','Voucher selected (R)', 'A draw against the voucher entitlement.'],
        ['couponDraw','Coupon selected (R)', 'Assumes a sponsor-funded coupon reimbursement.'],
        ['vasDraw','VAS selected (R)', 'Value-added service supplied through the provider.']
      ],
      advanced: [
        { heading: 'Benefit allocations', fields: [
          ['voucherAllocation','Voucher allocation (R)'], ['couponAllocation','Coupon allocation (R)'], ['vasAllocation','VAS allocation (R)']
        ]},
        { heading: 'Commercial assumptions', fields: [
          ['feePct','Assumed service fee (%)','Paid separately by the sponsor on successful fulfilment.',0,100],
          ['couponCoPay','Member coupon co-payment (R)','Extra member cash at the merchant; does not replenish the benefit balance.']
        ]},
        { heading: 'Provider response', fields: [['outcome','Purchase outcome','An uncertain response leaves the original basket debit in place.','select',[
          ['success','Successful fulfilment'],['pending','Provider outcome uncertain'],['failure','Definitive failure']
        ]]] }
      ],
      presets: [
        { id:'standard', title:'Funded benefit journey', help:'R1,000 allocated, R400 drawn. Fulfilment debits no additional entitlement.', changes:{} },
        { id:'pending', title:'Provider outcome uncertain', help:'The basket remains pending. The R400 debit stays in place while the provider outcome is reconciled.', changes:{outcome:'pending'} },
        { id:'failure', title:'Definitive provider failure', help:'The original R400 entitlement debit is restored once through a linked reversal.', changes:{outcome:'failure'} },
        { id:'shortfall', title:'Cash funding shortfall', help:'R1,000 of entitlement has been allocated but only R250 of cash received. The R400 provider payment cannot settle.', changes:{funding:250} }
      ]
    },
    wow: {
      title: 'WOW daily economy',
      description: 'Follow cash into stored value, then through fares, fuel, shopping and funded rewards. The fare collector acts for the operator; spending transfers ownership of value.',
      primary: [
        ['topup','Commuter cash-in (R)','Total funds collected in this scenario.'],
        ['fare','Fare payments (R)','Value paid from the commuter to the operator.'],
        ['fuel','Operator fuel purchase (R)','Paid from the operator’s available funds.'],
        ['shopping','Commuter shopping (R)','Uses the commuter’s remaining balance.'],
        ['fuelPrice','Assumed fuel price (R/litre)','Illustrative price used only to calculate litres.',0.01],
        ['fuelRebatePerLitre','Assumed fuel rebate (R/litre)','Earned on the fuel transaction; funding is shown separately.']
      ],
      advanced: [
        { heading:'Fees and revenue allocation', fields:[
          ['fareFeePct','Assumed fare fee (%)','Borne by the operator and deducted from the fare proceeds.',0,100],
          ['feeCoopPct','Cooperative share of fee (%)','Provider receives the balance after the cooperative and referral shares.',0,100],
          ['feeReferralPct','Referral share of fee (%)','Default zero. No lifetime referral promise is assumed.',0,100],
          ['providerPayoutPct','Provider fee paid out (%)','Unpaid earned fees remain a funded allocation.',0,100]
        ]},
        { heading:'Rewards and funding', fields:[
          ['fuelOperatorPct','Operator fuel rebate share (%)','Cooperative receives the balance after operator and driver.',0,100],
          ['fuelDriverPct','Driver fuel rebate share (%)','Shares must together be no more than 100%.',0,100],
          ['shopRebatePct','Assumed shopping reward (%)','Paid by a separate reward sponsor.',0,100],
          ['rewardFundingPct','Earned rewards funded (%)','Unfunded rewards remain pending and cannot be spent.',0,100]
        ]},
        { heading:'Settlement and use of income', fields:[
          ['merchantSettlementPct','Merchant payments settled (%)','Applies to fuel and shopping; unpaid amounts remain payables.',0,100],
          ['coopExpense','Cooperative operating expense (R)','Paid only from the cooperative’s funded earned allocation.'],
          ['cashout','Commuter cash withdrawal (R)','Reduces both the commuter balance and cash backing.'],
          ['cashInSettled','Cash-in has been remitted','If unticked, the agent still holds the money. No spendable wallet balance is created.','checkbox']
        ]}
      ],
      presets: [
        { id:'standard',title:'Funded WOW daily circuit',help:'R10,000 cash-in plus R240 of sponsor-funded rewards. The default final funded balance is R4,190.',changes:{} },
        { id:'pending',title:'Rewards earned, funding pending',help:'R240 of rewards is earned but none is available to spend until the sponsor provides the money.',changes:{rewardFundingPct:0} },
        { id:'delayed',title:'Merchant settlement delayed',help:'Only 25% of fuel and shopping payables is paid out. The unpaid balance remains backed by cash in the model.',changes:{merchantSettlementPct:25} },
        { id:'unremitted',title:'Cash collected, not remitted',help:'The cash agent holds R10,000. Spendable wallet value stays at zero and the daily circuit cannot begin.',changes:{cashInSettled:false} }
      ]
    }
  };

  const bondDefinitions = {
    portfolio: {
      title:'Agricultural bond portfolio',
      description:'Follow the proposed capital stack through deployment, cooperative collections, servicing, senior and junior coupons, reserve support and year-five principal repayment.',
      primary:[
        ['programmeFunding','Programme funding (USD)','Enter the total issue amount in dollars. The source example is $100 million.',0.01],
        ['salesMultiple','Eligible annual sales / advance','Eligible sales before the revenue sweep, collection impairments and delays.',0],
        ['sweepPct','RBF share of eligible receipts (%)','Revenue-based finance collections are limited by the remaining repayment cap.',0,100],
        ['capMultiple','Maximum repayment / advance','A 1.15× cap permits total remittance up to 115% of an advance. It is not a promised annual yield.',1]
      ],
      advanced:[
        {heading:'Funded capital stack',fields:[
          ['seniorSharePct','Senior share (%)','Catalytic first-loss funding is the residual share.',0,100],
          ['juniorSharePct','Junior share (%)','Senior and junior shares must total no more than 100%.',0,100],
          ['seniorCouponPct','Senior annual coupon (%)','Indicative source assumption, paid through the waterfall.',0,100],
          ['juniorCouponPct','Junior annual coupon (%)','Unpaid coupons accrue without compounding.',0,100],
          ['reservePct','Opening cash reserve (%)','Separate cash, available for senior coupon support and released at maturity.',0,100],
          ['setupPct','Opening setup spend (%)','Expensed at close; reduces cash available for deployment.',0,100]
        ]},
        {heading:'Deployment targets',fields:[
          ['deploymentY1Pct','Year 1 target (% of programme)','Actual deployment is capped by available principal cash.',0,100],
          ['deploymentY2Pct','Year 2 target (% of programme)','Trapped surplus is not assumed to fund new advances.',0,100],
          ['deploymentLaterPct','Years 3 to 5 target (%)','Five annual periods; year-five bullet maturity.',0,100]
        ]},
        {heading:'Collection and servicing assumptions',fields:[
          ['impairmentPct','Collection impairment / advance (%)','Additional noncollection beyond the eligible-sales assumption, applied once.',0,100],
          ['servicingPct','Annual servicing / advance (%)','Illustrative cash allowance for servicing, fees and applicable SPV taxes.',0,100],
          ['fxHaircutPct','FX haircut on realised receipts (%)','Reduction in USD-equivalent collections; no gain on idle cash is assumed.',0,100],
          ['delayPct','Collections delayed one year (%)','The year-five delayed tail is excluded from cash recovery at maturity.',0,100]
        ]}
      ]
    },
    facility:{
      title:'Cooperative revenue-based finance facility',
      description:'Trace a facility advance and cleared trading receipts. Protected amounts remain outside eligible receipts, the revenue sweep stops at the repayment cap, and the cooperative retains the balance.',
      primary:[
        ['advance','Facility advance (USD)','Source workbook example: $100,000.',0.01],
        ['receipt1','Period 1 cleared receipt (USD)','Cleared cash before the protected amount entered below.'],
        ['protected1','Period 1 protected amount (USD)','Deduct only once. Source workbook receipts are already eligible, so its protected fields start at zero.'],
        ['sweepPct','Share of eligible receipts (%)','Remittance is limited to the lesser of this share and the remaining repayment cap.',0,100],
        ['capMultiple','Maximum repayment / advance','Source example 1.15×; includes principal and the capped premium.',1],
        ['periodCount','Collection periods','Choose one to four periods. A zero-receipt period generates no remittance.',1,4,1]
      ],
      advanced:[
        {heading:'Subsequent cleared receipts',fields:[
          ['receipt2','Period 2 cleared receipt (USD)'],
          ['protected2','Period 2 protected amount (USD)'],
          ['receipt3','Period 3 cleared receipt (USD)'],
          ['protected3','Period 3 protected amount (USD)'],
          ['receipt4','Period 4 cleared receipt (USD)'],
          ['protected4','Period 4 protected amount (USD)']
        ]}
      ]
    }
  };

  function definition(){return mode==='bond'?{...bondDefinitions[bondView],presets:BondModel.presets[bondView]}:definitions[mode];}
  function defaultsForMode(){return mode==='bond'?BondModel.defaults[bondView]:FlowModel.defaults[mode];}
  function stateKey(){return mode==='bond'?'bond_'+bondView:mode;}
  function saveCurrentState(){if(result&&currentInputs)modelStates[stateKey()]={inputs:clone(currentInputs),stepIndex,preset:$('preset-select').value};}
  function switchBondView(view){
    if(view===bondView)return;
    saveCurrentState();stop();bondView=view;
    const stored=modelStates[stateKey()];currentInputs=clone(stored?stored.inputs:defaultsForMode());stepIndex=stored?stored.stepIndex:0;
    buildInputs(stored?stored.preset:(BondModel.presets[bondView][0]||{}).id);calculate(currentInputs,false);
  }

  function inputMarkup(field) {
    const [key,label,help,min,max,increment] = field;
    const value = currentInputs[key];
    if (min === 'checkbox') return '<label class="checkbox-field" for="input-'+key+'"><input id="input-'+key+'" name="'+key+'" type="checkbox" '+(value?'checked':'')+'><span>'+esc(label)+(help?'<small>'+esc(help)+'</small>':'')+'</span></label>';
    let input;
    if (min === 'select') input = '<select id="input-'+key+'" name="'+key+'">'+max.map(option => '<option value="'+esc(option[0])+'" '+(value===option[0]?'selected':'')+'>'+esc(option[1])+'</option>').join('')+'</select>';
    else input = '<input id="input-'+key+'" name="'+key+'" type="number" inputmode="decimal" min="'+(typeof min==='number'?min:0)+'" '+(typeof max==='number'?'max="'+max+'" ':'')+'step="'+(increment||0.01)+'" value="'+esc(value)+'">';
    return '<div class="field"><label for="input-'+key+'">'+esc(label)+'</label>'+input+(help?'<small>'+esc(help)+'</small>':'')+'</div>';
  }

  function buildInputs(presetId) {
    const def = definition();
    $('model-heading').textContent = def.title;
    $('model-description').textContent = def.description;
    $('guide-link').href = mode === 'bond' ? 'bond-guide.html' : mode === 'benefit' ? 'docs/FORUS_Aggregated_Benefit_Ledger_Funds_Flow.docx' : 'docs/FORUS_WOW_Community_Funds_Flow.docx';
    $('guide-link').textContent = mode === 'bond' ? 'Open bond flow guide' : 'Download flow guide';
    $('guide-link').setAttribute('aria-label', (mode==='bond'?'Open ':'Download ')+def.title+' flow guide');
    if(mode==='bond'){$('guide-link').removeAttribute('download');$('guide-link').setAttribute('target','_blank');$('guide-link').setAttribute('rel','noopener');}
    else{$('guide-link').setAttribute('download','');$('guide-link').removeAttribute('target');$('guide-link').removeAttribute('rel');}
    $('header-currency').textContent=mode==='bond'?'US dollar denominated':'Rand denominated';
    $('footer-currency').textContent='Illustrative model · '+currencyCode()+' · No banking or payment connection';
    $('pending-legend').textContent=mode==='bond'?'Pending obligation':'Pending reward';
    $('bond-view-field').hidden=mode!=='bond';$('bond-view').value=bondView;
    $('multiplier-field').hidden=mode==='bond';
    $('assumption-note').textContent=mode==='bond'?'Source-based proposal assumptions, not portfolio performance or agreed investor terms. Edited inputs are a custom illustration.':'All financial defaults are examples. Replace them with agreed commercial terms before using this model for decisions.';
    $('primary-inputs').innerHTML = def.primary.map(inputMarkup).join('');
    $('advanced-inputs').innerHTML = def.advanced.map(group => '<p class="input-group-title">'+esc(group.heading)+'</p>'+group.fields.map(inputMarkup).join('')).join('');
    $('input-multiplier').value = currentInputs.multiplier || 1;
    $('preset-select').innerHTML = def.presets.map(preset => '<option value="'+preset.id+'">'+esc(preset.title)+'</option>').join('')+'<option value="custom">Custom assumptions</option>';
    $('preset-select').value = presetId || (mode==='bond'?def.presets[0].id:'standard');
    updatePresetHelp();
  }

  function updatePresetHelp() {
    const preset = definition().presets.find(item => item.id === $('preset-select').value);
    $('preset-help').textContent = preset ? preset.help : 'Your values are used exactly as entered, subject to balance and allocation checks.';
  }

  function readInputs() {
    const def=definition();
    const fields = def.primary.concat(...def.advanced.map(group => group.fields));
    const inputs = {};
    fields.forEach(field => {
      const element = $('input-'+field[0]);
      inputs[field[0]] = element.type === 'checkbox' ? element.checked : element.tagName === 'SELECT' ? element.value : element.value === '' ? NaN : Number(element.value);
    });
    if(mode==='bond'){inputs.view=bondView;inputs.scenario='custom';}
    else inputs.multiplier = $('input-multiplier').value === '' ? NaN : Number($('input-multiplier').value);
    return inputs;
  }

  function showErrors(errors) {
    $('input-errors').hidden = !errors.length;
    $('input-errors').innerHTML = errors.length ? '<strong>Check these assumptions</strong><ul>'+errors.map(error => '<li>'+esc(error)+'</li>').join('')+'</ul><p style="margin:9px 0 0">The displayed flow remains the last valid scenario.</p>' : '';
  }

  function calculate(inputs, reset) {
    stop();
    const invalidFields = Object.keys(inputs).filter(key => typeof inputs[key] === 'number' && !Number.isFinite(inputs[key]));
    if (invalidFields.length) { showErrors(['Enter a number in every numeric field.']); return false; }
    const next = mode === 'bond' ? BondModel.simulate(inputs) : mode === 'benefit' ? FlowModel.simulateBenefit(inputs) : FlowModel.simulateWow(inputs);
    if (next.errors && next.errors.length) { showErrors(next.errors); return false; }
    if (!next.steps || !next.steps.length) { showErrors(['The model did not produce a transaction sequence.']); return false; }
    result = next;
    currentInputs = clone(inputs);
    stepIndex = reset ? 0 : Math.min(stepIndex,next.steps.length-1);
    showErrors([]);
    $('dirty-message').hidden = true;
    $('step-select').innerHTML = next.steps.map((step,index) => '<option value="'+index+'">'+(index+1)+'. '+esc(step.title)+'</option>').join('');
    renderSources();
    render();
    return true;
  }

  function switchModel(nextMode) {
    if(nextMode==='bond'&&!window.BondModel){showErrors(['The agricultural bond calculation file is unavailable. Reload the page to try again.']);return;}
    saveCurrentState();
    stop();
    mode = nextMode;
    const stored = modelStates[stateKey()];
    currentInputs = clone(stored ? stored.inputs : defaultsForMode());
    stepIndex = stored ? stored.stepIndex : 0;
    document.querySelectorAll('[data-model]').forEach(button => {
      const active = button.dataset.model === mode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    if (location.hash !== '#'+mode) history.replaceState(null,'','#'+mode);
    buildInputs(stored ? stored.preset : mode==='bond'?BondModel.presets[bondView][0].id:'standard');
    calculate(currentInputs,false);
  }

  function metric(label,value,note) { return '<div class="metric"><span class="metric-label">'+esc(label)+'</span><strong class="metric-value">'+money(value)+'</strong><span class="metric-note">'+esc(note)+'</span></div>'; }

  function renderMetrics(step) {
    if(mode==='bond'){renderBondMetrics(step);return;}
    const m = step.metrics;
    $('metrics').innerHTML = metric('External money in',m.cashSourcesCents,'Cumulative cash sources')+metric('Cash still held',m.cashHeldCents,mode==='benefit'?'Programme and provider':'Agent and settlement pool')+metric('External payments',m.cashPayoutsCents,'Cumulative cash paid out')+metric(mode==='benefit'?'Available entitlement':'Funded balances',mode==='benefit'?m.availableCents:(m.walletsCents||0)+(m.payablesCents||0),mode==='benefit'?'Separate from cash held':'Wallets and merchant payables');
  }

  function renderMovements(step) {
    const groups = [
      {key:'cash',label:'Cash transfers',entries:step.entries.filter(entry=>entry.kind==='cash')},
      {key:'ledger',label:mode==='bond'?'Claims and allocation records':mode==='benefit'?'Benefit ledger movements':'Ownership and funded balances',entries:step.entries.filter(entry=>entry.kind==='entitlement'||entry.kind==='value')},
      {key:'pending',label:mode==='bond'?'Pending obligations and receivables':'Earned rewards awaiting cash',entries:step.entries.filter(entry=>entry.kind==='pending')}
    ];
    let html='';
    for (const group of groups) {
      if (!group.entries.length) continue;
      html+='<div class="movement-lane"><div class="lane-label '+group.key+'"><i class="key-dot '+group.key+'"></i>'+group.label+'</div>'+group.entries.map(entry=>'<div class="transfer '+group.key+'"><div class="transfer-party"><small>From</small>'+esc(entry.from)+'</div><div class="transfer-route"><strong>'+money(entry.amountCents)+'</strong><span class="route-line" aria-hidden="true"></span></div><div class="transfer-party"><small>To</small>'+esc(entry.to)+'</div>'+(entry.note?'<p class="transfer-note">'+esc(entry.note)+'</p>':'')+'</div>').join('')+'</div>';
    }
    if (!groups[0].entries.length) {
      let explanation = 'This step confirms the recorded position without moving funds.';
      if (step.entries.length) explanation = 'The entries below change the ledger or record an obligation.';
      else if (step.metrics.status === 'success') explanation = 'This step confirms the closing balances. No funds move.';
      else if (step.metrics.status === 'awaiting_funding') explanation = 'The basket is waiting for the cash required to settle it.';
      else if (step.metrics.status === 'awaiting_cash_in') explanation = 'The agent remittance is still outstanding. No spendable value has been created.';
      else if (step.metrics.status === 'pending') explanation = mode === 'benefit' ? 'The provider outcome is pending confirmation.' : 'The recorded balance includes amounts still awaiting funding or settlement.';
      html='<p class="no-movement"><strong>No bank transfer at this step.</strong> '+explanation+'</p>'+html;
    }
    $('movement-lanes').innerHTML=html;
  }

  function balanceRow(label,value,extra) { return '<div class="balance-row '+(extra||'')+'"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></div>'; }
  function balancePanel(title,rows,note) { return '<div class="balance-panel"><h4>'+esc(title)+'</h4>'+rows+(note?'<p class="panel-note">'+esc(note)+'</p>':'')+'</div>'; }
  function renderBalances(step) {
    if(mode==='bond'){renderBondBalances(step);return;}
    const b=step.balances,m=step.metrics;
    if(mode==='benefit') {
      const cash=balanceRow('Programme cash account',b.programmeCashCents)+balanceRow('Provider cash held',b.providerCashCents)+balanceRow('Total cash still held',m.cashHeldCents,'total-row');
      const claims=balanceRow('Voucher available',b.voucherAvailableCents)+balanceRow('Coupon available',b.couponAvailableCents)+balanceRow('VAS available',b.vasAvailableCents)+balanceRow('Available entitlement',m.availableCents,'total-row')+balanceRow('Basket awaiting fulfilment',b.orderCents,'secondary-row')+balanceRow('Issued benefits awaiting use',m.issuedClaimsCents,'secondary-row');
      $('balance-panels').innerHTML=balancePanel('Where the cash is held',cash,'These accounts hold the actual modelled cash. External receipts are shown in the journal.')+balancePanel('Member benefit position',claims,'An entitlement is a right to a benefit. Its balance is not extra cash and may be subject to programme rules.');
    } else {
      const cash=balanceRow('Cash still with collection agent',b.agentCashCents)+balanceRow('Pooled settlement cash',b.reserveCashCents)+balanceRow('Total cash still held',m.cashHeldCents,'total-row')+balanceRow('Fuel merchant payable',b.fuelPayableCents,'secondary-row')+balanceRow('Shopping merchant payable',b.merchantPayableCents,'secondary-row');
      const wallets=balanceRow('Commuter',b.commuterValueCents)+balanceRow('Taxi operator',b.operatorValueCents)+balanceRow('Driver',b.driverValueCents)+balanceRow('Cooperative',b.cooperativeValueCents)+balanceRow('Provider fee allocation',b.providerValueCents)+balanceRow('Referral allocation',b.referralValueCents)+balanceRow('Total funded wallets',m.walletsCents,'total-row')+balanceRow('Rewards still unfunded',m.pendingCents,'secondary-row');
      $('balance-panels').innerHTML=balancePanel('Cash and settlement obligations',cash,'Merchant payables are claims against the pool. Agent-held collections do not create spendable wallet value.')+balancePanel('Who owns the funded value',wallets,'Pending rewards are shown separately and are excluded from spendable balances. The fare collector does not receive a second wallet credit.');
    }
  }

  function renderReconciliation(step) {
    if(mode==='bond'){renderBondReconciliation(step);return;}
    const m=step.metrics,c=step.checks;
    const conserved=c.cashConserved!==false;
    const claimsMatch=mode==='benefit'?c.entitlementConserved!==false:c.reserveMatched!==false;
    const pending = (m.pendingCents||0)>0;
    const gap = mode==='benefit'&&(m.fundingGapCents||0)>0;
    $('reconciliation-badge').textContent=conserved&&claimsMatch?'Reconciled':'Check required';
    $('reconciliation-badge').classList.toggle('warn',!conserved||!claimsMatch);
    $('cash-equation').innerHTML='<div class="equation-value"><small>External money in</small><strong>'+money(m.cashSourcesCents)+'</strong></div><span class="equation-symbol">=</span><div class="equation-value"><small>Cash still held</small><strong>'+money(m.cashHeldCents)+'</strong></div><span class="equation-symbol">+</span><div class="equation-value"><small>Cash paid out</small><strong>'+money(m.cashPayoutsCents)+'</strong></div>';
    const total=m.cashSourcesCents||0;
    $('cash-bar').innerHTML=total>0?'<div class="held" style="width:'+((m.cashHeldCents||0)/total*100)+'%"></div><div class="paid" style="width:'+((m.cashPayoutsCents||0)/total*100)+'%"></div>':'';
    $('cash-bar').setAttribute('aria-label','Cash held '+money(m.cashHeldCents)+'; cash paid out '+money(m.cashPayoutsCents));
    let note=mode==='benefit'?'Cash is counted once across the programme and provider. Entitlements and issued benefits are separate records of rights and obligations.':'Pooled settlement cash must equal funded wallets plus merchant payables. Unremitted agent cash and unfunded rewards cannot be spent from the pool.';
    if(gap) note+=' The funding gap is '+money(m.fundingGapCents)+'.';
    if(pending) note+=' Pending '+(mode==='benefit'?'unfulfilled or unredeemed benefit value':'reward funding')+': '+money(m.pendingCents)+'.';
    $('reconciliation-note').textContent=note;
    const checks=[{ok:conserved,text:'Cash conservation'},{ok:claimsMatch,text:mode==='benefit'?'Entitlement conservation':'Pool matches funded claims'},{ok:c.nonnegative!==false,text:'No negative balances'}];
    if(mode==='benefit') checks.push({ok:!gap,text:gap?'Funding gap '+money(m.fundingGapCents):'Benefit commitments funded'});
    else if(pending) checks.push({ok:false,text:money(m.pendingCents)+' rewards unfunded'});
    $('check-list').innerHTML=checks.map(check=>'<span class="check-item '+(check.ok?'':'warn')+'">'+esc(check.text)+'</span>').join('');
  }

  function renderOutcome() {
    if(mode==='bond'){renderBondOutcome();return;}
    const c=result.closing,m=c.metrics,b=c.balances;
    const item=(label,value)=>'<div class="outcome-item"><small>'+esc(label)+'</small><strong>'+money(value)+'</strong></div>';
    let html,copy;
    if(mode==='benefit') {
      html=item('Programme cash remaining',b.programmeCashCents)+item('Entitlement remaining',m.availableCents)+item('Basket still pending',m.orderCents)+item('Benefits consumed',m.consumedCents)+item('Service fee paid',b.platformFeesCents)+item('Funding gap',m.fundingGapCents);
      const summaries={success:'The basket has been fulfilled and used. Only basket creation reduced the entitlement. Service fees and the member co-payment were separate cash sources.',pending:'The provider outcome remains uncertain. The original basket debit is retained; no duplicate purchase or entitlement refund is assumed.',failure:'A definitive failure restores the original entitlement through one linked compensating entry. The sponsor’s programme cash remains in the account.',awaiting_funding:'The basket has debited the entitlement, but cash is insufficient to pay the provider. Fulfilment waits for funding.'};
      copy=summaries[m.status]||'This outcome reflects the assumptions entered above.';
    } else {
      html=item('Pool cash remaining',b.reserveCashCents)+item('Gross trading activity',m.grossActivityCents)+item('Rewards earned',m.totalRewardsEarnedCents)+item('Rewards funded',m.totalRewardsFundedCents)+item('Rewards still pending',m.pendingCents)+item('Earned transaction fees',m.feeCents);
      copy=m.status==='awaiting_cash_in'?'The collection agent still holds the cash. No funded commuter balance has been created, so fares, fuel and shopping cannot proceed.':'Gross activity adds fares, fuel and shopping. It measures successive transactions, not new money. Funded rewards add sponsor cash; transaction fees allocate an existing payment.';
      if(m.payablesCents>0)copy+=' Merchant settlement of '+money(m.payablesCents)+' remains payable and backed by pool cash.';
    }
    $('outcome-summary').innerHTML='<div class="outcome-grid">'+html+'</div><p class="outcome-copy">'+esc(copy)+'</p>';
  }

  function bondMoney(value){
    if(Math.abs(Number(value)||0)>=100000000)return '$'+((Number(value)||0)/100000000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'m';
    return money(value);
  }
  function bondMetric(label,value,note){return '<div class="metric"><span class="metric-label">'+esc(label)+'</span><strong class="metric-value" title="'+esc(money(value))+'">'+bondMoney(value)+'</strong><span class="metric-note">'+esc(note)+'</span></div>';}
  function renderBondMetrics(step){
    const m=step.metrics;
    $('metrics').innerHTML=bondMetric('External cash received',m.cashSourcesCents,'Cumulative USD cash sources')+bondMetric('Cash still held',m.cashHeldCents,bondView==='portfolio'?'All issuer cash accounts':'Facility and collection accounts')+bondMetric('External cash paid',m.cashPayoutsCents,'Cumulative USD cash payments')+bondMetric(bondView==='portfolio'?'Unpaid coupons':'Remitted to issuer',bondView==='portfolio'?m.totalCouponArrearsCents:m.totalRemittedCents,bondView==='portfolio'?'Senior and junior arrears':'Against the facility collection cap');
  }
  function renderBondBalances(step){
    const b=step.balances,m=step.metrics;
    if(bondView==='portfolio'){
      const cash=balanceRow('Issuer funding cash',b.issuerCashCents)+balanceRow('Principal cash',b.principalCashCents)+balanceRow('Ring-fenced reserve',b.reserveCashCents)+balanceRow('Income cash',b.incomeCashCents)+balanceRow('Distribution cash',b.distributionCashCents)+balanceRow('Trapped surplus',b.trappedCashCents)+balanceRow('Total cash held',m.cashHeldCents,'total-row');
      const claims=balanceRow('Active advance principal',b.activePrincipalClaimCents)+balanceRow('Deferred principal receipts',b.deferredPrincipalCents)+balanceRow('Deferred premium receipts',b.deferredPremiumCents)+balanceRow('Senior principal outstanding',b.seniorPrincipalOutstandingCents)+balanceRow('Junior principal outstanding',b.juniorPrincipalOutstandingCents)+balanceRow('Catalytic capital unreturned',b.firstLossUnreturnedCents)+balanceRow('Coupon arrears',m.totalCouponArrearsCents,'total-row')+balanceRow('Unpaid servicing costs',b.expenseArrearsCents,'secondary-row');
      $('balance-panels').innerHTML=balancePanel('Issuer cash accounts',cash,'Cash transfers between these accounts do not create new cash. Advances paid out and collections received are shown separately in the journal.')+balancePanel('Claims and unpaid obligations',claims,'Receivables, investor capital outstanding and arrears describe different obligations. They are not additional cash held by the issuer.');
    }else{
      const cash=balanceRow('Facility funding cash',b.facilityCashCents)+balanceRow('Cleared collection cash',b.collectionCashCents)+balanceRow('Issuer collections cash',b.issuerCollectionsCashCents)+balanceRow('Total cash held',m.cashHeldCents,'total-row');
      const claims=balanceRow('Principal outstanding',b.principalOutstandingCents)+balanceRow('Remaining collection cap',b.remainingCapCents)+balanceRow('Principal repaid',b.principalRepaidCents,'secondary-row')+balanceRow('Premium remitted',b.premiumRepaidCents,'secondary-row')+balanceRow('Protected proceeds paid',b.protectedPaidCents,'secondary-row')+balanceRow('Cooperative retained cash paid',b.cooperativeRetainedPaidCents,'secondary-row');
      $('balance-panels').innerHTML=balancePanel('Where facility cash is held',cash,'The advance and later trading receipts have different sources. Collection remittances transfer cash to the issuer.')+balancePanel('Facility and local proceeds',claims,'The remaining cap limits further collections. It is not an unconditional debt payment or a guaranteed return.');
    }
  }
  function renderBondReconciliation(step){
    const m=step.metrics,c=step.checks,conserved=c.cashConserved!==false,priority=c.priorityRespected!==false;
    $('reconciliation-badge').textContent=conserved&&priority?'Reconciled':'Check required';$('reconciliation-badge').classList.toggle('warn',!conserved||!priority);
    $('cash-equation').innerHTML='<div class="equation-value"><small>External cash received</small><strong>'+money(m.cashSourcesCents)+'</strong></div><span class="equation-symbol">=</span><div class="equation-value"><small>Cash still held</small><strong>'+money(m.cashHeldCents)+'</strong></div><span class="equation-symbol">+</span><div class="equation-value"><small>External cash paid</small><strong>'+money(m.cashPayoutsCents)+'</strong></div>';
    const total=m.cashSourcesCents||0;$('cash-bar').innerHTML=total>0?'<div class="held" style="width:'+((m.cashHeldCents||0)/total*100)+'%"></div><div class="paid" style="width:'+((m.cashPayoutsCents||0)/total*100)+'%"></div>':'';
    $('cash-bar').setAttribute('aria-label','Cash held '+money(m.cashHeldCents)+'; cash paid out '+money(m.cashPayoutsCents));
    $('reconciliation-note').textContent=bondView==='portfolio'?'The same money can be advanced, collected and redeployed. Cumulative cash receipts therefore include cooperative collections as well as initial investor funding. Receivables and unpaid coupons do not count as available cash.':'Cleared receipts equal protected proceeds, issuer remittance and the cooperative’s unswept balance. The advance is a separate financing event; a zero eligible receipt generates no remittance.';
    const checks=[{ok:conserved,text:'Cash conservation'},{ok:priority,text:bondView==='portfolio'?'Waterfall priority respected':'Repayment cap respected'},{ok:c.nonnegative!==false,text:'No negative balances'}];
    const arrears=bondView==='portfolio'?(m.totalCouponArrearsCents||0)+(m.unpaidExpensesCents||0):0;
    if(arrears>0)checks.push({ok:false,text:money(arrears)+' unpaid coupons and costs'});
    $('check-list').innerHTML=checks.map(check=>'<span class="check-item '+(check.ok?'':'warn')+'">'+esc(check.text)+'</span>').join('');
  }
  function renderBondOutcome(){
    const b=result.closing.balances,m=result.closing.metrics;
    const item=(label,value)=>'<div class="outcome-item"><small>'+esc(label)+'</small><strong title="'+esc(money(value))+'">'+bondMoney(value)+'</strong></div>';
    let html,copy;
    if(bondView==='portfolio'){
      html=item('Senior principal returned',b.seniorPrincipalPaidCents)+item('Junior principal returned',b.juniorPrincipalPaidCents)+item('Catalytic capital returned',b.firstLossReturnedCents)+item('Catalytic capital not returned',b.firstLossUnreturnedCents)+item('Senior principal shortfall',m.seniorPrincipalShortfallCents)+item('Junior principal shortfall',m.juniorPrincipalShortfallCents)+item('Coupon arrears at maturity',m.totalCouponArrearsCents)+item('Deferred tail excluded',m.tailCollectionsCents)+item('Residual distributed',b.residualPaidCents);
      copy='This is the modelled year-five outcome under the selected assumptions. Reserve support consumes funded cash. Deferred collections after maturity remain a receivable and are excluded from repayment at the five-year cut-off. Catalytic capital absorbs loss before a residual distribution is available.';
    }else{
      html=item('Advance paid',m.advanceCents)+item('Total collection cap',m.repaymentCapCents)+item('Remitted to issuer',m.totalRemittedCents)+item('Local cash retained',m.localProceedsCents)+item('Remaining collection cap',m.remainingCapCents)+item('Principal still outstanding',m.principalOutstandingCents);
      copy='Protected proceeds and unswept eligible receipts remain local. Each remittance is limited by qualifying receipts and the remaining cap. The remaining cap is a collection ceiling, not an unconditional payment promise.';
    }
    $('outcome-summary').innerHTML='<div class="outcome-grid">'+html+'</div><p class="outcome-copy">'+esc(copy)+'</p>';
  }
  function renderAnnualResults(step){
    $('annual-section').hidden=mode!=='bond';if(mode!=='bond')return;
    const facility=bondView==='facility',rows=facility?(result.periodRows||[]):(result.annualRows||[]),closing=result.closing.metrics;
    $('annual-heading').textContent=facility?'Cooperative collection schedule':'Five-year bond waterfall';
    $('annual-description').textContent=facility?'The complete receipt schedule for this facility. Each remittance stops at the remaining cap.':'The complete selected scenario. Investor payments include coupons and any principal returned; the current model year is highlighted.';
    const summary=(label,value,warn)=>'<div class="annual-summary-item '+(warn?'is-shortfall':'')+'"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></div>';
    if(facility){
      $('annual-summary').innerHTML=summary('Cleared receipts',closing.grossReceiptsCents)+summary('Protected proceeds',closing.protectedProceedsCents)+summary('Total issuer remittance',closing.totalRemittedCents)+summary('Local proceeds retained',closing.localProceedsCents);
      $('annual-head').innerHTML='<tr><th>Period</th><th>Cleared receipts</th><th>Protected proceeds</th><th>Eligible receipts</th><th>Remitted to issuer</th><th>Local proceeds</th><th>Remaining cap</th></tr>';
      $('annual-body').innerHTML=rows.map(row=>'<tr class="'+((step.period||step.metrics.period)===row.period?'is-current':'')+'"><td>'+esc(row.period)+'</td><td>'+money(row.grossReceiptsCents)+'</td><td>'+money(row.protectedProceedsCents)+'</td><td>'+money(row.eligibleReceiptsCents)+'</td><td>'+money(row.remittanceCents)+'</td><td>'+money(row.localProceedsCents)+'</td><td>'+money(row.closingCapCents)+'</td></tr>').join('');
      $('annual-footnote').textContent='Source: Cooperative!B3:B6 and A8:G13. Its receipt values are already eligible after exclusions, so protected inputs default to zero. The trade-receipt preset separately illustrates $1,900 cleared less $400 protected, leaving $1,500 eligible and a $300 remittance at 20%.';
    }else{
      const reserveDraw=rows.reduce((sum,row)=>sum+(row.reserveDrawCents||0),0),unpaid=(closing.seniorPrincipalShortfallCents||0)+(closing.juniorPrincipalShortfallCents||0);
      $('annual-summary').innerHTML=summary('Initial programme funding',closing.fundingCents)+summary('Cumulative reserve drawn',reserveDraw)+summary('Senior and junior principal shortfall',unpaid,unpaid>0)+summary('Deferred tail outside maturity',closing.tailCollectionsCents,closing.tailCollectionsCents>0);
      $('annual-head').innerHTML='<tr><th>Year</th><th>Advances</th><th>Cash collections</th><th>Cash servicing costs</th><th>Senior paid</th><th>Junior paid</th><th>Reserve drawn</th><th>Closing reserve</th><th>Coupon arrears</th><th>Principal shortfall</th></tr>';
      $('annual-body').innerHTML=rows.map(row=>{const arrears=(row.seniorCouponArrearsCents||0)+(row.juniorCouponArrearsCents||0),shortfall=(row.seniorPrincipalShortfallCents||0)+(row.juniorPrincipalShortfallCents||0);return '<tr class="'+((step.year||step.metrics.year)===row.year?'is-current':'')+'"><td>'+esc(row.year)+'</td><td>'+money(row.advancesCents)+'</td><td>'+money((row.principalReceivedCents||0)+(row.premiumReceivedCents||0))+'</td><td>'+money(row.operatingCostsPaidCents)+'</td><td>'+money((row.seniorCouponPaidCents||0)+(row.seniorPrincipalPaidCents||0))+'</td><td>'+money((row.juniorCouponPaidCents||0)+(row.juniorPrincipalPaidCents||0))+'</td><td class="reserve-cell">'+money(row.reserveDrawCents)+'</td><td>'+money(row.closingReserveCents)+'</td><td class="'+(arrears?'shortfall-cell':'')+'">'+money(arrears)+'</td><td class="'+(shortfall?'shortfall-cell':'')+'">'+money(shortfall)+'</td></tr>';}).join('');
      $('annual-footnote').textContent='Source: Inputs!B4:B17 and B20:D25, with five-year Base, Delayed and Severe sheets. Workbook amounts expressed in USD millions are converted to whole USD here. Shortfalls are modelled outcomes, not actual portfolio losses. Senior and junior principal shortfalls exclude catalytic capital not returned.';
    }
  }
  function renderBondSources(){
    const warnings=Array.isArray(result.warnings)&&result.warnings.length?'<h4>Calculation notes</h4><ul>'+result.warnings.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul>':'';
    $('source-content').innerHTML='<div class="source-grid"><div><h4>Source proposal and workbook</h4><p>The agricultural cooperative bond model is based on <em>03_WFB_Bond_Waterfall_Model.xlsx</em> and <em>06_WFB_Bond_Platform_and_Territory_Annex.docx</em>, supplied in the 18 November 2026 proposal pack.</p><ul><li>Inputs!B4:B17 defines the $100 million funding, 70% senior, 20% junior and 10% catalytic stack, indicative coupons, cash reserve, setup budget and deployment targets.</li><li>Inputs!B20:D25 defines the Base, Delayed and Severe operating cases.</li><li>Cooperative!B3:B6 and A8:G13 supplies the $100,000 facility, 20% sweep, 1.15× cap and four receipt periods.</li><li>The platform annex describes protected proceeds and the $1,900 cleared-receipt example.</li></ul></div><div><h4>How to interpret the result</h4><p>These are proposal assumptions and illustrative cash flows. They do not show subscribed capital, actual loan performance, accepted investor terms or a guaranteed return. Changing a field creates a custom scenario. Coupon rates are distinct from realised investor returns when payments are delayed or capital is not fully returned.</p><p>Cash transfers, receivable balances, repayment limits and investor obligations are shown separately. No token issue, insurance payout, refinancing or additional borrowing is assumed to create repayment cash. No pilot territory is selected by this model.</p>'+warnings+'</div></div>';
  }

  function allEntries(throughCurrent) {
    const steps=throughCurrent?result.steps.slice(0,stepIndex+1):result.steps;
    return steps.flatMap((step,index)=>step.entries.map(entry=>({stepNumber:index+1,stepTitle:step.title,...entry})));
  }
  function kindLabel(kind) {return {cash:'Cash',entitlement:'Entitlement',value:mode==='bond'?'Claim or allocation':'Funded value',pending:mode==='bond'?'Pending obligation':'Pending'}[kind]||kind;}
  function renderJournal() {
    const entries=allEntries(true);
    $('journal-body').innerHTML=entries.length?entries.map(entry=>'<tr><td>'+entry.stepNumber+'. '+esc(entry.stepTitle)+'</td><td><span class="kind-tag '+esc(entry.kind)+'">'+esc(kindLabel(entry.kind))+'</span></td><td>'+esc(entry.from)+'</td><td>'+esc(entry.to)+'</td><td class="amount-cell">'+money(entry.amountCents)+'</td><td>'+esc(entry.note||'')+'</td></tr>').join(''):'<tr><td colspan="6">No movements recorded at this step.</td></tr>';
  }

  function renderSources() {
    if(mode==='bond'){renderBondSources();return;}
    if(mode==='benefit') $('source-content').innerHTML='<div class="source-grid"><div><h4>Confirmed specification rules</h4><p>Source: <em>Aggregated Benefit Ledger Platform Technical Specification v3.7</em>, dated 20 July 2026, marked draft for integration alignment.</p><ul><li>Voucher, Coupon and VAS balances are separate (pp. 2, 7).</li><li>Creating a basket posts its entitlement debit once; fulfilment posts no second debit (pp. 4–5, 10, 14–15).</li><li>One provider fulfils a basket. Unknown outcomes stay pending; definitive failure permits a linked compensating credit (pp. 5, 14–15).</li><li>Provider-to-merchant interactions and settlement are outside the specified API boundary (p. 2).</li></ul></div><div><h4>Additional modelling assumptions</h4><p>Sponsor prefunding, purchase at face value, provider cash settlement, service fees and member co-payments are illustrative commercial assumptions. They are not confirmed terms in the specification.</p><p>The coupon example assumes a cash-funded reimbursement of the stated amount. Actual coupons may instead be conditional discounts; their commercial treatment must be confirmed.</p><p>Inputs are rounded to cents per scenario before multiplying copies. The model assumes one compatible provider, available items and satisfied minimum drawdowns. Taxes, product restrictions, credit facilities, interest and cash refunds after provider settlement are outside this example.</p></div></div>';
    else $('source-content').innerHTML='<div class="source-grid"><div><h4>Supplied WOW evidence</h4><p>Sources: <em>WOW Stakeholder Progress Report</em>, 15 November 2026; <em>WOW Stakeholder Report with Dashboard</em>, 16 November 2026; and the supplied WOW circulation diagram.</p><ul><li>The reports describe operator-led onboarding, KYC, vehicle and wallet registration, station acceptance and mobilisation needs (extended report pp. 1–4).</li><li>Rebates should be reported as earned, pending and settled (p. 3).</li><li>The dashboard explicitly contains planning figures, not verified live activity (pp. 6–7).</li><li>No agreed fee, fuel rebate, commission or revenue split is supplied.</li></ul></div><div><h4>Model boundaries</h4><p>All rates, balances and settlement percentages are illustrative. The diagram labels value eZAR; this simulator uses a neutral rand-denominated economic ledger. It does not establish that eZAR or WOWZAR is live or accepted at a merchant.</p><p>Rewards use separate sponsor funding. Unfunded rewards cannot increase spendable balances. Fees come from operator fare receipts; cooperative operating spending uses its funded allocation. Referral commission defaults to zero.</p><p>The cash-in agent may also be the spaza, but collection cash and shopping revenue are separate roles. Fuel and shopping merchants are paid at the selected percentage. Taxes, bank charges, borrowing, interest and transaction reversals are outside the numerical example. Scenario copies are hypothetical repeated circuits, not verified participants.</p></div></div>';
  }

  function render() {
    if(!result) return;
    const step=result.steps[stepIndex];
    $('step-counter').textContent='Step '+(stepIndex+1)+' of '+result.steps.length;
    $('step-number').textContent=stepIndex+1;
    $('step-title').textContent=step.title;
    $('step-description').textContent=step.description;
    $('step-select').value=stepIndex;
    const progress=Math.round((stepIndex+1)/result.steps.length*100);
    $('progress-fill').style.width=progress+'%';
    $('step-progress').setAttribute('aria-valuenow',progress);
    $('previous-button').disabled=stepIndex===0;
    $('next-button').disabled=stepIndex===result.steps.length-1;
    $('finish-button').disabled=stepIndex===result.steps.length-1;
    renderMetrics(step);renderMovements(step);renderBalances(step);renderReconciliation(step);renderOutcome();renderJournal();renderAnnualResults(step);
    if (earningsCharts) earningsCharts.render(result, stepIndex);
    if(diagram){diagram.render({mode,result,stepIndex});diagram.setPaused(false);}
    $('replay-diagram').disabled=!diagram||!step.entries.length;
    const current=document.querySelector('.current-step');
    current.classList.remove('flash');
    requestAnimationFrame(()=>current.classList.add('flash'));
  }
  function stop(pauseMotion=true){if(timer!==null){clearTimeout(timer);timer=null;}if(diagram&&pauseMotion)diagram.setPaused(true);$('play-button').textContent='Play flow';$('play-button').setAttribute('aria-pressed','false');}
  function goTo(index){stop();stepIndex=Math.max(0,Math.min(index,result.steps.length-1));render();}
  function scheduleNextStep(){
    const duration=diagram?diagram.durationFor(result.steps[stepIndex]):2400;
    timer=setTimeout(()=>{
      timer=null;
      if(stepIndex<result.steps.length-1){stepIndex++;render();scheduleNextStep();}
      else stop(false);
    },duration);
  }
  function play(){
    if(timer!==null){stop();return;}
    if(stepIndex===result.steps.length-1)stepIndex=0;
    render();
    $('play-button').textContent='Pause flow';$('play-button').setAttribute('aria-pressed','true');
    scheduleNextStep();
  }
  function download(content,type,name){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function csvCell(value){let text=String(value==null?'':value);if(/^[=+@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function exportCSV(){const header=['Scenario','Currency','Step','Step name','Movement type','From','To','Amount '+currencyCode(),'Explanation'];const rows=allEntries(true).map(e=>[mode==='bond'?'bond_'+bondView:mode,currencyCode(),e.stepNumber,e.stepTitle,kindLabel(e.kind),e.from,e.to,(e.amountCents/100).toFixed(2),e.note]);download('\uFEFF'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8','FORUS_'+(mode==='bond'?'bond_'+bondView:mode)+'_journal_step_'+(stepIndex+1)+'.csv');}

  function init(){
    if(!window.FlowModel){document.querySelector('.layout').innerHTML='<div class="unavailable"><h3>Simulator is loading</h3><p>The accounting model is not available yet. Refresh the page once the build is complete.</p></div>';return;}
    if (window.ParticipantCharts && $('earnings')) {
      earningsCharts = ParticipantCharts.create({money, esc, goTo});
      $('view-earnings').addEventListener('click', () => {
        $('earnings-heading').focus({preventScroll:true});
        $('earnings').scrollIntoView({block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      });
    }
    if(window.FlowDiagram)diagram=FlowDiagram.create($('flow-diagram'));
    else $('flow-diagram').textContent='The diagram is unavailable. Open the transaction details below to follow each movement.';
    document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>switchModel(button.dataset.model)));
    window.addEventListener('hashchange',()=>{const desired=location.hash==='#bond'?'bond':location.hash==='#wow'?'wow':'benefit';if(desired!==mode)switchModel(desired);});
    $('inputs-form').addEventListener('submit',event=>{event.preventDefault();if(calculate(readInputs(),true)){$('preset-select').value='custom';updatePresetHelp();}});
    $('inputs-form').addEventListener('input',()=>{$('dirty-message').hidden=false;stop();});
    $('inputs-form').addEventListener('change',()=>{$('dirty-message').hidden=false;stop();});
    $('preset-select').addEventListener('change',()=>{const preset=definition().presets.find(p=>p.id===$('preset-select').value);if(!preset){updatePresetHelp();return;}currentInputs={...clone(defaultsForMode()),...preset.changes};buildInputs(preset.id);calculate(currentInputs,true);});
    $('bond-view').addEventListener('change',()=>switchBondView($('bond-view').value));
    $('play-button').addEventListener('click',play);
    $('watch-flow').addEventListener('click',()=>{goTo(0);play();document.querySelector('.step-card').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
    $('replay-diagram').addEventListener('click',()=>{stop(false);if(diagram)diagram.replay();});
    $('previous-button').addEventListener('click',()=>goTo(stepIndex-1));
    $('next-button').addEventListener('click',()=>goTo(stepIndex+1));
    $('finish-button').addEventListener('click',()=>goTo(result.steps.length-1));
    $('reset-button').addEventListener('click',()=>goTo(0));
    $('step-select').addEventListener('change',()=>goTo(Number($('step-select').value)));
    $('export-csv').addEventListener('click',exportCSV);
    $('export-json').addEventListener('click',()=>download(JSON.stringify({title:'FORUS flow of funds',model:mode,view:mode==='bond'?bondView:undefined,currency:currencyCode(),date:'2026-11-24',basis:'Illustrative assumptions, not live transactions',displayedStep:stepIndex+1,...result},null,2),'application/json','FORUS_'+(mode==='bond'?'bond_'+bondView:mode)+'_scenario.json'));
    $('print-button').addEventListener('click',()=>{stop();window.print();});
    switchModel(mode);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
