/* Agricultural bond cash waterfall. Source: WFB Bond Waterfall Model, 18 November 2026.
   Integer USD cents. Cash, asset claims, note obligations and collection caps are separate. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BondModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const portfolioDefault = {
    view:'portfolio', scenario:'base', programmeFunding:100000000,
    seniorSharePct:70, juniorSharePct:20, seniorCouponPct:7, juniorCouponPct:10,
    reservePct:10, setupPct:5, deploymentY1Pct:60, deploymentY2Pct:80, deploymentLaterPct:90,
    sweepPct:20, capMultiple:1.15, salesMultiple:6, impairmentPct:3,
    servicingPct:3, fxHaircutPct:0, delayPct:0
  };
  const facilityDefault = {
    view:'facility', scenario:'cooperative', advance:100000, sweepPct:20, capMultiple:1.15, periodCount:4,
    receipt1:200000, receipt2:0, receipt3:250000, receipt4:150000,
    protected1:0, protected2:0, protected3:0, protected4:0
  };
  const presets = {
    portfolio:[
      {id:'base',title:'Workbook base case',help:'Source case: 6.0× eligible sales, 3% noncollection, 3% costs, no FX haircut or collection delay.',changes:{scenario:'base',salesMultiple:6,impairmentPct:3,servicingPct:3,fxHaircutPct:0,delayPct:0}},
      {id:'delayed',title:'Workbook delayed case',help:'Source case: 5.5× eligible sales, 5% noncollection, 3.5% costs, 3% FX haircut and 20% of collections delayed one year.',changes:{scenario:'delayed',salesMultiple:5.5,impairmentPct:5,servicingPct:3.5,fxHaircutPct:3,delayPct:20}},
      {id:'severe',title:'Workbook severe case',help:'Source case: 4.2× eligible sales, 9% noncollection, 4% costs, 10% FX haircut and 35% delayed one year.',changes:{scenario:'severe',salesMultiple:4.2,impairmentPct:9,servicingPct:4,fxHaircutPct:10,delayPct:35}}
    ],
    facility:[
      {id:'cooperative',title:'Workbook cooperative example',help:'USD100,000 advance; 20% of already eligible receipts; maximum total remittance USD115,000. Four source periods: 200,000 / 0 / 250,000 / 150,000.',changes:{scenario:'cooperative',advance:100000,sweepPct:20,capMultiple:1.15,periodCount:4,receipt1:200000,receipt2:0,receipt3:250000,receipt4:150000,protected1:0,protected2:0,protected3:0,protected4:0}},
      {id:'trade',title:'Annex protected crop receipt',help:'One USD1,900 cleared receipt: USD400 protected, USD1,500 eligible, USD300 swept and USD1,200 unswept. The separate USD100,000 facility assumption leaves USD114,700 of its collection cap.',changes:{scenario:'trade',advance:100000,sweepPct:20,capMultiple:1.15,periodCount:1,receipt1:1900,receipt2:0,receipt3:0,receipt4:0,protected1:400,protected2:0,protected3:0,protected4:0}}
    ]
  };
  function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); } return value; }
  const defaults = deepFreeze({portfolio:portfolioDefault,facility:facilityDefault});
  deepFreeze(presets);
  function safe(n) { if (!Number.isSafeInteger(n)) throw new Error('Amounts exceed the safe integer-cent range. Reduce the scenario size.'); return n; }
  function sum(values) { return safe(values.reduce((a,b) => a+b,0)); }
  function cents(value) { return safe(Math.round(value*100 + 1e-7)); }
  function divide(n,d) { if (d <= 0n) throw new Error('A calculation divisor must be positive.'); return safe(Number((n+d/2n)/d)); }
  function percent(value,rate) { return divide(BigInt(value)*BigInt(Math.round(rate*10000)),1000000n); }
  function multiple(value,rate) { return divide(BigInt(value)*BigInt(Math.round(rate*1000000)),1000000n); }
  function ratio(n,d) { return d === 0 ? 0 : n/d; }
  function entry(kind,from,to,amountCents,note) { return {kind,from,to,amountCents,note:note||''}; }
  const cash = (from,to,amount,note) => entry('cash',from,to,amount,note);
  const claim = (from,to,amount,note) => entry('pending',from,to,amount,note);
  function account(id,label,role,endpoints,rows,hint) { return {id,label,role,endpoints,rows:(rows||[]).map(row=>({label:row[0],field:row[1],area:row[2]||'balances'})),hint:hint||''}; }
  function portfolioAccounts() { return [
    account('senior_investors','Senior investors','cash_source',['Senior investors'],[['Subscribed','seniorFundingCents','metrics'],['Coupons received','seniorCouponPaidCents'],['Principal received','seniorPrincipalPaidCents']],'Cumulative external contributions and receipts; no assumed guarantee'),
    account('junior_investors','Junior investors','cash_source',['Junior investors'],[['Subscribed','juniorFundingCents','metrics'],['Coupons received','juniorCouponPaidCents'],['Principal received','juniorPrincipalPaidCents']],'Junior payments follow the senior waterfall'),
    account('first_loss_investors','First-loss investors','cash_source',['First-loss investors'],[['Subscribed','firstLossFundingCents','metrics'],['Capital returned','firstLossReturnedCents']],'Capital is at risk and has no target coupon'),
    account('issuer_cash','Issuer funding account','cash',['Issuer funding account'],[['Cash held','issuerCashCents']]),
    account('principal_cash','Deployable principal account','cash',['Deployable principal account'],[['Cash held','principalCashCents']],'Reused only when principal cash has actually returned'),
    account('reserve','Senior coupon reserve','cash',['Senior coupon reserve'],[['Cash held','reserveCashCents']],'Senior coupon support before maturity; remaining cash released at maturity'),
    account('income','Finance income account','cash',['Finance income account'],[['Cash held','incomeCashCents']],'Collected premium is separate from returned principal'),
    account('distribution','Trustee distribution account','cash',['Trustee distribution account'],[['Cash held','distributionCashCents']],'Only cash transferred here can fund this distribution'),
    account('trapped','Trapped surplus account','cash',['Trapped surplus account'],[['Cash held','trappedCashCents']],'No reinvestment of trapped surplus in new advances'),
    account('cooperatives','Portfolio cooperatives','cash_receipt',['Portfolio cooperatives'],[['Advances received','advancesPaidCents'],['Principal returned','principalCollectionsCents','metrics'],['Premium returned','financeIncomeCents','metrics']],'Cumulative external flows; these are not additional SPV cash balances'),
    account('setup','Setup and onboarding providers','cash_receipt',['Setup and onboarding providers'],[['Received','setupPaidCents']]),
    account('servicer','Servicing and tax providers','cash_receipt',['Servicing and tax providers'],[['Received','operatingCostsPaidCents']]),
    account('residual','Residual beneficiaries','cash_receipt',['Residual beneficiaries'],[['Received','residualPaidCents']],'Only cash remaining after the specified waterfall'),
    account('senior_principal_claim','Senior note principal claim','claim',['Senior note principal claim'],[['Outstanding principal','seniorPrincipalOutstandingCents']],'Noncash obligation; five-year bullet'),
    account('junior_principal_claim','Junior note principal claim','claim',['Junior note principal claim'],[['Outstanding principal','juniorPrincipalOutstandingCents']],'Noncash obligation; five-year bullet'),
    account('first_loss_claim','First-loss capital at risk','claim',['First-loss capital at risk'],[['Capital not returned','firstLossUnreturnedCents']],'At-risk capital; not a guaranteed repayment'),
    account('senior_coupon_claim','Senior coupon due','claim',['Senior coupon claim'],[['Due or unpaid','seniorCouponArrearsCents']],'Current coupon plus earlier unpaid amounts; no compounding'),
    account('junior_coupon_claim','Junior coupon due','claim',['Junior coupon claim'],[['Due or unpaid','juniorCouponArrearsCents']],'Junior arrears alone do not stop source-model deployment'),
    account('expense_claim','Priority expenses due','claim',['Priority expense claim'],[['Due or unpaid','expenseArrearsCents']]),
    account('deferred_principal','Deferred principal collections','claim',['Deferred principal collections'],[['Not yet received','deferredPrincipalCents']],'Not spendable cash; source assumes receipt one year later'),
    account('deferred_premium','Deferred finance income','claim',['Deferred finance income'],[['Not yet received','deferredPremiumCents']],'Not spendable cash; post-maturity tail excluded from payments'),
    account('active_claim','Active portfolio principal','claim',['Active portfolio principal claim'],[['Advance claim','activePrincipalClaimCents']],'Asset claim, not cash in the issuer accounts'),
    account('register','Bond register','event',['Bond register'],[],'Records rights; contributes zero cash'),
    account('obligations','Annual obligations','event',['Annual obligations'],[],'Accrual records an obligation, not a cash receipt'),
    account('timing','Collection timing','event',['Collection timing'],[],'Separates cash received from deferred claims')
  ]; }
  function facilityAccounts() { return [
    account('spv_funding','SPV facility allocation','cash_source',['SPV facility allocation'],[['Funding allocated','advanceCents','metrics']],'Separate facility view; not additional funding of the portfolio'),
    account('facility_cash','Facility disbursement account','cash',['Facility disbursement account'],[['Cash held','facilityCashCents']]),
    account('input_suppliers','Approved input suppliers','cash_receipt',['Approved input suppliers'],[['Advance disbursed','advancePaidCents']],'Illustrative direct supplier disbursement for the approved facility'),
    account('buyers','Cleared buyer receipts','cash_source',['Cleared buyer receipts'],[['Cash received','grossReceiptsCents','metrics']],'Only cleared receipts enter this calculation'),
    account('collection','Controlled collection account','cash',['Controlled collection account'],[['Cash held','collectionCashCents']]),
    account('protected','Protected farmer proceeds','cash_receipt',['Protected farmer proceeds'],[['Paid to designated recipients','protectedPaidCents']],'Protected amounts are removed before calculating the sweep'),
    account('issuer_collection','Issuer collection account','cash',['Issuer collection account'],[['Cash collected','issuerCollectionsCashCents']],'Transferred into the issuer view only once; no second funding source'),
    account('local_proceeds','Cooperative local proceeds','cash_receipt',['Cooperative local proceeds'],[['Unswept amount paid','cooperativeRetainedPaidCents']],'Farmer distribution of this retained amount follows the member mandate'),
    account('facility_principal','Facility principal claim','claim',['Facility principal claim'],[['Principal outstanding','principalOutstandingCents']],'Principal return is identified separately from premium'),
    account('facility_cap','Facility collection cap','claim',['Facility collection cap'],[['Remaining collection limit','remainingCapCents']],'Maximum remaining remittance; not an unconditional amount owed'),
    account('facility_agreement','Facility agreement','event',['Facility agreement'],[],'Capped revenue-linked contract; no token value is cash')
  ]; }
  function invalid(inputs,errors) { return {model:'bond',view:inputs.view||'portfolio',currency:'USD',inputs,errors,warnings:[],steps:[],annualRows:[],periodRows:[],accounts:[],closing:{balances:{},metrics:{status:'invalid',cashSourcesCents:0,cashPayoutsCents:0,cashHeldCents:0,cashAvailableCents:0,pendingCents:0},checks:{valid:false}}}; }
  function normalize(source) {
    const raw=source==null?{}:source;
    if(typeof raw!=='object'||Array.isArray(raw))return {inputs:{view:'portfolio'},errors:['Inputs must be an object.']};
    const view=raw.view||'portfolio';
    if(!['portfolio','facility'].includes(view))return {inputs:{view},errors:['Bond view must be portfolio or facility.']};
    const selected=raw.scenario||defaults[view].scenario;
    const preset=presets[view].find(p=>p.id===selected);
    const p=Object.assign({},defaults[view],preset?preset.changes:{}),errors=[];
    Object.keys(p).forEach(k=>{if(Object.prototype.hasOwnProperty.call(raw,k))p[k]=raw[k];});
    if(!preset&&selected!=='custom')errors.push('Unknown '+view+' scenario. Select a source preset or custom.');
    p.scenario=selected;
    for(const key of Object.keys(p)) {
      if(key==='view'||key==='scenario')continue;
      const value=p[key],n=typeof value==='string'&&value.trim()===''?NaN:Number(value);
      if(!Number.isFinite(n)||n<0){errors.push(key+' must be a non-negative number.');continue;}
      if(key.endsWith('Pct')){if(n>100)errors.push(key+' must be between 0 and 100.');p[key]=Math.round(n*10000)/10000;}
      else if(key.endsWith('Multiple')){if(n>1000)errors.push(key+' must not exceed 1,000.');p[key]=Math.round(n*1000000)/1000000;}
      else if(key==='periodCount'){if(!Number.isInteger(n)||n<1||n>4)errors.push('periodCount must be a whole number from 1 to 4.');p[key]=n;}
      else {if(n>100000000000)errors.push(key+' must not exceed USD100 billion.');p[key]=cents(n)/100;}
    }
    if(p.capMultiple<1)errors.push('The repayment cap multiple must be at least 1.00.');
    if(view==='portfolio'){
      if(!(p.programmeFunding>0))errors.push('Programme funding must be greater than zero.');
      if(p.seniorSharePct+p.juniorSharePct>100)errors.push('Senior and junior funded shares cannot exceed 100% together.');
      if(p.reservePct+p.setupPct>100)errors.push('Reserve and setup percentages cannot exceed 100% together.');
    }else{
      if(!(p.advance>0))errors.push('The facility advance must be greater than zero.');
      for(let i=1;i<=p.periodCount;i++)if(p['protected'+i]>p['receipt'+i])errors.push('Protected proceeds cannot exceed cleared receipts in period '+i+'.');
    }
    return {inputs:p,errors};
  }
  function record(view,p,state,calculate,accounts,warnings) {
    const steps=[];
    return {
      add(id,title,description,entries,year,period,status){
        const calculated=calculate(status||'intermediate',year||0,period||0);
        const snap={id,title,description,year:year||0,period:period||0,entries:(entries||[]).filter(e=>e.amountCents>0).map(e=>Object.assign({},e)),balances:Object.assign({},state),metrics:calculated.metrics,checks:calculated.checks};
        for(const object of [snap.balances,snap.metrics,snap.checks])for(const [k,v]of Object.entries(object))if(k.endsWith('Cents'))safe(v);
        steps.push(snap);return snap;
      },
      finish(annualRows,periodRows){const last=steps[steps.length-1];return {model:'bond',view,currency:'USD',inputs:p,errors:[],warnings:warnings.slice(),steps,annualRows:annualRows||[],periodRows:periodRows||[],accounts,closing:{balances:Object.assign({},last.balances),metrics:Object.assign({},last.metrics),checks:Object.assign({},last.checks)}};}
    };
  }

  function portfolio(p) {
    const funding=cents(p.programmeFunding),senior=percent(funding,p.seniorSharePct),junior=percent(funding,p.juniorSharePct),firstLoss=funding-senior-junior;
    const reserveTarget=percent(funding,p.reservePct),setup=percent(funding,p.setupPct),principalBudget=funding-reserveTarget-setup;
    if(firstLoss<0||principalBudget<0)return invalid(p,['Cent-rounded allocations exceed funded cash. Reduce the selected shares.']);
    const seniorAnnual=percent(senior,p.seniorCouponPct),juniorAnnual=percent(junior,p.juniorCouponPct);
    const state={issuerCashCents:0,principalCashCents:0,reserveCashCents:0,incomeCashCents:0,distributionCashCents:0,trappedCashCents:0,
      activePrincipalClaimCents:0,deferredPrincipalCents:0,deferredPremiumCents:0,expenseArrearsCents:0,seniorCouponArrearsCents:0,juniorCouponArrearsCents:0,
      seniorPrincipalOutstandingCents:0,juniorPrincipalOutstandingCents:0,firstLossUnreturnedCents:0,
      setupPaidCents:0,advancesPaidCents:0,operatingCostsPaidCents:0,seniorCouponPaidCents:0,seniorPrincipalPaidCents:0,juniorCouponPaidCents:0,juniorPrincipalPaidCents:0,firstLossReturnedCents:0,residualPaidCents:0};
    let fundingReceived=0,principalCollections=0,premiumCollections=0,impairments=0,cover=0,dscr=0,notesRegistered=false,priorityRespected=true;
    const warnings=[],annualRows=[];
    const r=record('portfolio',p,state,(status,year,period)=>{
      const held=sum([state.issuerCashCents,state.principalCashCents,state.reserveCashCents,state.incomeCashCents,state.distributionCashCents,state.trappedCashCents]);
      const investorDistributions=sum([state.seniorCouponPaidCents,state.seniorPrincipalPaidCents,state.juniorCouponPaidCents,state.juniorPrincipalPaidCents,state.firstLossReturnedCents]);
      const payouts=sum([state.setupPaidCents,state.advancesPaidCents,state.operatingCostsPaidCents,investorDistributions,state.residualPaidCents]);
      const sources=sum([fundingReceived,principalCollections,premiumCollections]),difference=sources-payouts-held;
      const matured=year===5&&(status==='success'||status==='capital_loss'||status==='shortfall');
      return {metrics:{status,year,period,cashSourcesCents:sources,cashPayoutsCents:payouts,cashHeldCents:held,cashAvailableCents:state.distributionCashCents,
        fundingCents:fundingReceived,seniorFundingCents:fundingReceived?senior:0,juniorFundingCents:fundingReceived?junior:0,firstLossFundingCents:fundingReceived?firstLoss:0,
        principalBudgetCents:principalBudget,principalCollectionsCents:principalCollections,financeIncomeCents:premiumCollections,totalCollectionsCents:principalCollections+premiumCollections,totalAdvancesCents:state.advancesPaidCents,totalInvestorDistributionsCents:investorDistributions,
        totalCouponArrearsCents:state.seniorCouponArrearsCents+state.juniorCouponArrearsCents,unpaidExpensesCents:state.expenseArrearsCents,
        seniorPrincipalShortfallCents:matured?state.seniorPrincipalOutstandingCents:0,juniorPrincipalShortfallCents:matured?state.juniorPrincipalOutstandingCents:0,firstLossShortfallCents:matured?state.firstLossUnreturnedCents:0,
        tailCollectionsCents:year===5?state.deferredPrincipalCents+state.deferredPremiumCents:0,pendingCents:state.deferredPrincipalCents+state.deferredPremiumCents,
        permanentPrincipalImpairmentCents:impairments,seniorRecoveryPct:ratio(state.seniorPrincipalPaidCents,senior)*100,juniorRecoveryPct:ratio(state.juniorPrincipalPaidCents,junior)*100,
        operatingCouponCover:cover,dscr,fundingGapCents:matured?sum([state.expenseArrearsCents,state.seniorCouponArrearsCents,state.juniorCouponArrearsCents,state.seniorPrincipalOutstandingCents,state.juniorPrincipalOutstandingCents]):0},
        checks:{valid:true,cashConserved:difference===0,cashDifferenceCents:difference,nonnegative:Object.values(state).every(v=>v>=0),priorityRespected,
          seniorPrincipalReconciles:!notesRegistered||state.seniorPrincipalOutstandingCents+state.seniorPrincipalPaidCents===senior,
          juniorPrincipalReconciles:!notesRegistered||state.juniorPrincipalOutstandingCents+state.juniorPrincipalPaidCents===junior,
          firstLossReconciles:!notesRegistered||state.firstLossUnreturnedCents+state.firstLossReturnedCents===firstLoss}};
    },portfolioAccounts(),warnings);
    fundingReceived=funding;state.issuerCashCents=funding;
    r.add('bond_funded','Fund the bond at close','The source illustration is fully funded: senior, junior and first-loss subscriptions enter one issuer account. A proposed token or note record adds no further cash.',[
      cash('Senior investors','Issuer funding account',senior),cash('Junior investors','Issuer funding account',junior),cash('First-loss investors','Issuer funding account',firstLoss)],0);
    state.issuerCashCents=0;state.principalCashCents=principalBudget;state.reserveCashCents=reserveTarget;state.setupPaidCents=setup;
    r.add('funds_allocated','Allocate principal cash and reserve and pay setup costs','Principal cash remains available for annual deployment. The source 40/25/20 use-of-proceeds categories are a budget, not an additional opening cash disbursement. Reserve cash is funded once.',[
      cash('Issuer funding account','Deployable principal account',principalBudget),cash('Issuer funding account','Senior coupon reserve',reserveTarget),cash('Issuer funding account','Setup and onboarding providers',setup)],0);
    state.seniorPrincipalOutstandingCents=senior;state.juniorPrincipalOutstandingCents=junior;state.firstLossUnreturnedCents=firstLoss;notesRegistered=true;
    r.add('rights_recorded','Record note principal and first-loss capital','These records describe investor rights and capital at risk. They are not extra cash. The notes have a year-five principal bullet; first-loss capital is returned only from remaining cash.',[
      entry('value','Bond register','Senior note principal claim',senior),entry('value','Bond register','Junior note principal claim',junior),entry('value','Bond register','First-loss capital at risk',firstLoss)],0);

    for(let year=1;year<=5;year++){
      const maturity=year===5;
      const openingPrincipal=state.principalCashCents,openingReserve=state.reserveCashCents,openingTrapped=state.trappedCashCents;
      const priorSenior=state.seniorCouponArrearsCents,priorJunior=state.juniorCouponArrearsCents,priorExpenses=state.expenseArrearsCents;
      const priorDeferredPrincipal=state.deferredPrincipalCents,priorDeferredPremium=state.deferredPremiumCents;
      const targetRate=year===1?p.deploymentY1Pct:year===2?p.deploymentY2Pct:p.deploymentLaterPct;
      const target=percent(funding,targetRate),stopped=priorSenior+priorExpenses>100;
      const advance=stopped?0:Math.min(openingPrincipal,target);
      const sales=multiple(advance,p.salesMultiple),contractual=Math.min(multiple(advance,p.capMultiple),percent(sales,p.sweepPct));
      const noncollection=Math.min(contractual,percent(advance,p.impairmentPct)),fx=percent(contractual-noncollection,p.fxHaircutPct),expected=contractual-noncollection-fx;
      const expectedPrincipal=Math.min(expected,advance),expectedPremium=expected-expectedPrincipal;
      const newDeferredPrincipal=percent(expectedPrincipal,p.delayPct),newDeferredPremium=percent(expectedPremium,p.delayPct);
      const receivedPrincipal=expectedPrincipal-newDeferredPrincipal+priorDeferredPrincipal,receivedPremium=expectedPremium-newDeferredPremium+priorDeferredPremium;
      const currentExpenses=percent(advance,p.servicingPct),expenseDue=currentExpenses+priorExpenses;
      const seniorDue=seniorAnnual+priorSenior,juniorDue=juniorAnnual+priorJunior;
      const principalBeforeExpenses=openingPrincipal-advance+receivedPrincipal;
      const normalExpensesPaid=Math.min(expenseDue,receivedPremium+principalBeforeExpenses);
      const capitalAfterExpenses=principalBeforeExpenses-Math.max(0,normalExpensesPaid-receivedPremium),netIncome=Math.max(0,receivedPremium-normalExpensesPaid);
      const debtDue=seniorDue+juniorDue+(maturity?senior+junior:0);
      cover=ratio(receivedPremium-expenseDue,seniorAnnual+juniorAnnual);
      dscr=ratio(receivedPremium-expenseDue+(maturity?principalBeforeExpenses:0),debtDue);
      const row={year,openingPrincipalCents:openingPrincipal,openingReserveCents:openingReserve,openingTrappedCents:openingTrapped,
        targetDeploymentCents:target,advancesCents:advance,advancesStopped:stopped,eligibleSalesCents:sales,contractualSweepCents:contractual,noncollectionCents:noncollection,fxLossCents:fx,
        expectedCollectionsCents:expected,expectedPrincipalCents:expectedPrincipal,expectedPremiumCents:expectedPremium,priorDeferredPrincipalCents:priorDeferredPrincipal,priorDeferredPremiumCents:priorDeferredPremium,
        principalReceivedCents:receivedPrincipal,premiumReceivedCents:receivedPremium,operatingCostsDueCents:expenseDue,operatingCostsPaidCents:normalExpensesPaid,
        principalCashBeforeExpensesCents:principalBeforeExpenses,capitalAfterExpensesCents:capitalAfterExpenses,netIncomeAfterExpensesCents:netIncome,
        seniorCouponDueCents:seniorDue,seniorCouponPaidCents:0,seniorPrincipalDueCents:maturity?senior:0,seniorPrincipalPaidCents:0,juniorCouponDueCents:juniorDue,juniorCouponPaidCents:0,juniorPrincipalDueCents:maturity?junior:0,juniorPrincipalPaidCents:0,
        reserveDrawCents:0,reserveTopupCents:0,firstLossReturnedCents:0,residualPaidCents:0,priorityAdjustmentCents:0,
        deferredPrincipalCents:newDeferredPrincipal,deferredPremiumCents:newDeferredPremium,permanentPrincipalImpairmentCents:advance-expectedPrincipal,operatingCouponCover:cover,dscr};
      state.principalCashCents-=advance;state.advancesPaidCents+=advance;state.activePrincipalClaimCents=advance;
      r.add('year_'+year+'_advance','Year '+year+' deploy eligible advances',stopped?'New advances stop because prior senior coupon arrears or unpaid priority expenses exceed the source-model USD1 tolerance. Existing cash and later collections remain separately available.':'Deployment is capped by cleared principal cash and this year’s target. Trapped surplus and the reserve are not used for new advances. The source assumes one annual liquidation cycle for these assets.',[
        cash('Deployable principal account','Portfolio cooperatives',advance),entry('value','Bond register','Active portfolio principal claim',advance,'An advance creates a noncash asset claim')],year);
      state.expenseArrearsCents=expenseDue;state.seniorCouponArrearsCents=seniorDue;state.juniorCouponArrearsCents=juniorDue;
      r.add('year_'+year+'_obligations','Year '+year+' record coupons and priority costs','Current annual coupons and servicing costs are added to unpaid amounts. Coupons do not compound. In the source, servicing cost is a percentage of new advances and becomes zero when no new advance is made.',[
        claim('Annual obligations','Senior coupon claim',seniorAnnual),claim('Annual obligations','Junior coupon claim',juniorAnnual),claim('Annual obligations','Priority expense claim',currentExpenses)],year);
      state.principalCashCents+=receivedPrincipal;state.incomeCashCents+=receivedPremium;principalCollections+=receivedPrincipal;premiumCollections+=receivedPremium;
      state.activePrincipalClaimCents=0;state.deferredPrincipalCents=newDeferredPrincipal;state.deferredPremiumCents=newDeferredPremium;impairments+=advance-expectedPrincipal;
      r.add('year_'+year+'_collections','Year '+year+' receive and classify collections','Only received principal and premium enter cash accounts. Deferred amounts remain noncash claims. The source assumes prior-year deferred amounts arrive in full; noncollection and FX losses are applied once to the current vintage.',[
        cash('Portfolio cooperatives','Deployable principal account',receivedPrincipal,'Returned principal is not finance income'),cash('Portfolio cooperatives','Finance income account',receivedPremium),
        claim('Collection timing','Deferred principal collections',newDeferredPrincipal),claim('Collection timing','Deferred finance income',newDeferredPremium)],year);
      const expenseFromIncome=Math.min(state.incomeCashCents,normalExpensesPaid),expenseFromCapital=normalExpensesPaid-expenseFromIncome;
      state.incomeCashCents-=expenseFromIncome;state.principalCashCents-=expenseFromCapital;state.operatingCostsPaidCents+=normalExpensesPaid;state.expenseArrearsCents-=normalExpensesPaid;
      r.add('year_'+year+'_expenses','Year '+year+' pay priority operating costs','The source pays operating costs from current collected premium first, then available principal cash. Unpaid costs are carried forward. Before maturity the reserve is earmarked for senior coupons.',[
        cash('Finance income account','Servicing and tax providers',expenseFromIncome),cash('Deployable principal account','Servicing and tax providers',expenseFromCapital,'Costs exceed current collected premium')],year);
      const incomeTransfer=state.incomeCashCents,trappedTransfer=state.trappedCashCents,principalRelease=maturity?state.principalCashCents:0,reserveRelease=maturity?state.reserveCashCents:0;
      state.incomeCashCents=0;state.trappedCashCents=0;state.principalCashCents-=principalRelease;state.reserveCashCents-=reserveRelease;state.distributionCashCents+=incomeTransfer+trappedTransfer+principalRelease+reserveRelease;
      row.cashAvailableBeforeReserveCents=state.distributionCashCents;row.maturityCapitalReleaseCents=principalRelease;row.maturityReserveReleaseCents=reserveRelease;
      r.add('year_'+year+'_available','Year '+year+(maturity?' release maturity cash':' prepare the distribution'),'Collected net income and previously trapped cash enter the distribution account.'+(maturity?' The remaining capital and reserve are released once for the maturity waterfall.':' Deployable capital and remaining reserve stay outside the ordinary distribution pool.'),[
        cash('Finance income account','Trustee distribution account',incomeTransfer),cash('Trapped surplus account','Trustee distribution account',trappedTransfer),cash('Deployable principal account','Trustee distribution account',principalRelease),cash('Senior coupon reserve','Trustee distribution account',reserveRelease)],year);
      if(maturity&&state.expenseArrearsCents>0&&state.distributionCashCents>0){
        const extra=Math.min(state.expenseArrearsCents,state.distributionCashCents);state.distributionCashCents-=extra;state.expenseArrearsCents-=extra;state.operatingCostsPaidCents+=extra;row.operatingCostsPaidCents+=extra;row.priorityAdjustmentCents=extra;
        warnings.push('Custom maturity expense priority: the simulator pays unpaid priority costs from released maturity cash before notes. The source workbook formulas omit this edge case. The disclosed adjustment is USD'+(extra/100).toFixed(2)+'.');
        r.add('year_'+year+'_priority_adjustment','Year 5 clear remaining priority expenses','This custom case triggers a disclosed extension to the workbook formulas: released maturity cash clears unpaid priority costs before noteholder distributions. No new money is introduced.',[cash('Trustee distribution account','Servicing and tax providers',extra)],year);
      }
      if(!maturity){
        const draw=Math.min(state.reserveCashCents,Math.max(0,seniorDue-state.distributionCashCents));state.reserveCashCents-=draw;state.distributionCashCents+=draw;row.reserveDrawCents=draw;
        r.add('year_'+year+'_reserve_support','Year '+year+' apply eligible senior reserve support','Before maturity the reserve supports only the senior coupon shortfall. A reserve transfer is internal cash movement, not new income or an investor subscription.',[cash('Senior coupon reserve','Trustee distribution account',draw)],year);
      }
      row.distributableCashCents=state.distributionCashCents;
      const seniorCouponPaid=Math.min(state.distributionCashCents,state.seniorCouponArrearsCents);
      state.distributionCashCents-=seniorCouponPaid;state.seniorCouponArrearsCents-=seniorCouponPaid;state.seniorCouponPaidCents+=seniorCouponPaid;row.seniorCouponPaidCents=seniorCouponPaid;
      if(maturity&&seniorCouponPaid>0&&state.expenseArrearsCents>0)priorityRespected=false;
      r.add('year_'+year+'_senior_coupon','Year '+year+' pay senior coupon and arrears','Senior coupon and its carried arrears are paid first from distributable cash. Any unpaid amount remains due; principal is not paid before year five.',[cash('Trustee distribution account','Senior investors',seniorCouponPaid,'Senior coupon and prior coupon arrears')],year);
      if(maturity){
        const paid=Math.min(state.distributionCashCents,state.seniorPrincipalOutstandingCents);state.distributionCashCents-=paid;state.seniorPrincipalOutstandingCents-=paid;state.seniorPrincipalPaidCents+=paid;row.seniorPrincipalPaidCents=paid;
        if(paid>0&&(state.seniorCouponArrearsCents>0||state.expenseArrearsCents>0))priorityRespected=false;
        r.add('year_5_senior_principal','Year 5 repay senior principal','The five-year senior bullet follows senior coupon and priority expenses, and precedes all junior payments. Unpaid principal is shown explicitly.',[cash('Trustee distribution account','Senior investors',paid,'Senior principal at maturity')],year);
      }
      const juniorCouponPaid=Math.min(state.distributionCashCents,state.juniorCouponArrearsCents);
      state.distributionCashCents-=juniorCouponPaid;state.juniorCouponArrearsCents-=juniorCouponPaid;state.juniorCouponPaidCents+=juniorCouponPaid;row.juniorCouponPaidCents=juniorCouponPaid;
      if(juniorCouponPaid>0&&(state.seniorCouponArrearsCents>0||(maturity&&state.seniorPrincipalOutstandingCents>0)))priorityRespected=false;
      r.add('year_'+year+'_junior_coupon','Year '+year+' pay junior coupon if cash remains','Junior coupon and its simple accrued arrears receive only cash left after the senior payments due in this year. Junior arrears carry forward and do not themselves stop new advances in the source model.',[cash('Trustee distribution account','Junior investors',juniorCouponPaid,'Junior coupon and prior coupon arrears')],year);
      if(maturity){
        const paid=Math.min(state.distributionCashCents,state.juniorPrincipalOutstandingCents);state.distributionCashCents-=paid;state.juniorPrincipalOutstandingCents-=paid;state.juniorPrincipalPaidCents+=paid;row.juniorPrincipalPaidCents=paid;
        if(paid>0&&(state.juniorCouponArrearsCents>0||state.seniorPrincipalOutstandingCents>0||state.seniorCouponArrearsCents>0))priorityRespected=false;
        r.add('year_5_junior_principal','Year 5 repay junior principal if cash remains','The junior principal bullet follows senior principal and all due coupons. It has no access to hypothetical future collections or token balances.',[cash('Trustee distribution account','Junior investors',paid,'Junior principal at maturity')],year);
        row.cashAfterNotesCents=state.distributionCashCents;
        const firstReturned=Math.min(state.distributionCashCents,state.firstLossUnreturnedCents);state.distributionCashCents-=firstReturned;state.firstLossUnreturnedCents-=firstReturned;state.firstLossReturnedCents+=firstReturned;row.firstLossReturnedCents=firstReturned;
        r.add('year_5_first_loss','Year 5 return available first-loss capital','Return first-loss capital only after the notes. Any difference from the funded contribution is capital not recovered in the model; no coupon or guaranteed return is assumed.',[cash('Trustee distribution account','First-loss investors',firstReturned)],year);
        const residual=state.distributionCashCents;state.distributionCashCents=0;state.residualPaidCents+=residual;row.residualPaidCents=residual;
        const status=state.expenseArrearsCents+state.seniorCouponArrearsCents+state.juniorCouponArrearsCents+state.seniorPrincipalOutstandingCents+state.juniorPrincipalOutstandingCents>0?'shortfall':state.firstLossUnreturnedCents>0?'capital_loss':'success';
        r.add('year_5_residual','Year 5 close the maturity waterfall','Only remaining cash can reach residual beneficiaries. Deferred year-five collections are a tail claim and are excluded from maturity payment capacity. Shortfalls remain visible; no refinancing or external rescue funding is assumed.',[cash('Trustee distribution account','Residual beneficiaries',residual)],year,0,status);
      }else{
        row.cashAfterNotesCents=state.distributionCashCents;
        const refill=Math.min(state.distributionCashCents,Math.max(0,reserveTarget-state.reserveCashCents));state.distributionCashCents-=refill;state.reserveCashCents+=refill;row.reserveTopupCents=refill;
        r.add('year_'+year+'_reserve_refill','Year '+year+' refill reserve only from remaining cash','After due senior and junior coupon payments, any remaining cash may refill the reserve to its opening target. A desired reserve balance is not treated as funded unless cash is actually transferred.',[cash('Trustee distribution account','Senior coupon reserve',refill)],year);
        const trapped=state.distributionCashCents;state.distributionCashCents=0;state.trappedCashCents+=trapped;
        r.add('year_'+year+'_retained','Year '+year+' retain undistributed surplus','Any surplus remaining after coupon payments and reserve refill is trapped for later distributions. It is not reinvested into the following year’s advances.',[cash('Trustee distribution account','Trapped surplus account',trapped)],year,0,'year_closed');
      }
      Object.assign(row,{closingPrincipalCents:state.principalCashCents,closingReserveCents:state.reserveCashCents,closingTrappedCents:state.trappedCashCents,
        seniorCouponArrearsCents:state.seniorCouponArrearsCents,juniorCouponArrearsCents:state.juniorCouponArrearsCents,expenseArrearsCents:state.expenseArrearsCents,
        seniorPrincipalShortfallCents:maturity?state.seniorPrincipalOutstandingCents:0,juniorPrincipalShortfallCents:maturity?state.juniorPrincipalOutstandingCents:0,firstLossShortfallCents:maturity?state.firstLossUnreturnedCents:0,
        tailCollectionsCents:maturity?state.deferredPrincipalCents+state.deferredPremiumCents:0});
      row.cashCheckCents=openingPrincipal+openingReserve+openingTrapped+receivedPrincipal+receivedPremium-advance-row.operatingCostsPaidCents-row.seniorCouponPaidCents-row.seniorPrincipalPaidCents-row.juniorCouponPaidCents-row.juniorPrincipalPaidCents-row.firstLossReturnedCents-row.residualPaidCents-row.closingPrincipalCents-row.closingReserveCents-row.closingTrappedCents;
      annualRows.push(row);
    }
    const result=r.finish(annualRows,[]);
    result.sourceBudget={currency:'USD',description:'Source use-of-proceeds budget; actual annual advances are modelled separately.',inputsSharePct:40,storageSharePct:25,processingSharePct:20,reserveSharePct:10,setupSharePct:5};
    return result;
  }

  function facility(p){
    const advance=cents(p.advance),cap=multiple(advance,p.capMultiple);
    const state={facilityCashCents:0,collectionCashCents:0,issuerCollectionsCashCents:0,advancePaidCents:0,protectedPaidCents:0,cooperativeRetainedPaidCents:0,principalOutstandingCents:0,remainingCapCents:0,principalRepaidCents:0,premiumRepaidCents:0};
    let funded=0,gross=0,eligible=0,remitted=0,registered=false;
    const rows=[],warnings=[];
    const r=record('facility',p,state,(status,year,period)=>{
      const held=sum([state.facilityCashCents,state.collectionCashCents,state.issuerCollectionsCashCents]),sources=funded+gross,payouts=sum([state.advancePaidCents,state.protectedPaidCents,state.cooperativeRetainedPaidCents]);
      const difference=sources-payouts-held;
      return {metrics:{status,year,period,cashSourcesCents:sources,cashPayoutsCents:payouts,cashHeldCents:held,cashAvailableCents:state.collectionCashCents,unpaidExpensesCents:0,pendingCents:0,
        advanceCents:funded,repaymentCapCents:cap,grossReceiptsCents:gross,protectedProceedsCents:state.protectedPaidCents,eligibleReceiptsCents:eligible,totalRemittedCents:remitted,
        cooperativeRetainedCents:state.cooperativeRetainedPaidCents,localProceedsCents:state.protectedPaidCents+state.cooperativeRetainedPaidCents,remainingCapCents:state.remainingCapCents,
        principalOutstandingCents:state.principalOutstandingCents,principalRepaidCents:state.principalRepaidCents,premiumRepaidCents:state.premiumRepaidCents,fundingGapCents:0},
        checks:{valid:true,cashConserved:difference===0,cashDifferenceCents:difference,nonnegative:Object.values(state).every(v=>v>=0),priorityRespected:true,
          capReconciles:!registered||state.remainingCapCents+remitted===cap,principalReconciles:!registered||state.principalOutstandingCents+state.principalRepaidCents===advance,
          receiptsReconcile:gross===state.collectionCashCents+state.protectedPaidCents+state.cooperativeRetainedPaidCents+state.issuerCollectionsCashCents}};
    },facilityAccounts(),warnings);
    funded=advance;state.facilityCashCents=advance;
    r.add('facility_funded','Allocate cash to this cooperative facility','This is a separate receipt-level view of capital allocated by the issuer. Do not add this amount to the portfolio’s original funding a second time.',[cash('SPV facility allocation','Facility disbursement account',advance)],0,0);
    state.facilityCashCents=0;state.advancePaidCents=advance;
    r.add('facility_disbursed','Disburse the approved advance','The illustration pays approved input suppliers directly for the cooperative facility. Actual supplier release follows the agreed mandate and evidence. This cash disbursement is distinct from recording the contract cap.',[cash('Facility disbursement account','Approved input suppliers',advance)],0,0);
    state.principalOutstandingCents=advance;state.remainingCapCents=cap;registered=true;
    r.add('facility_contract','Record principal and the collection limit','The principal claim and maximum lifetime collection are contractual records, not additional cash. The cap includes principal and premium and is not an annual yield promise.',[
      entry('value','Facility agreement','Facility principal claim',advance),entry('value','Facility agreement','Facility collection cap',cap,'Maximum collection, not unconditional debt')],0,0);
    for(let period=1;period<=p.periodCount;period++){
      const receipt=cents(p['receipt'+period]),protectedAmount=cents(p['protected'+period]),eligibleAmount=receipt-protectedAmount,openingCap=state.remainingCapCents;
      const sweep=Math.min(openingCap,percent(eligibleAmount,p.sweepPct)),retained=eligibleAmount-sweep,principalRepaid=Math.min(sweep,state.principalOutstandingCents),premiumRepaid=sweep-principalRepaid;
      state.collectionCashCents+=receipt;gross+=receipt;
      r.add('period_'+period+'_receipt','Period '+period+' receive cleared buyer cash',receipt>0?'A cleared receipt enters the controlled account. Goods, an invoice, a token issue or a pending payment are not additional cleared cash.':'No cleared receipt arrives in this period. No cash remittance is created and the remaining contract cap is unchanged.',[cash('Cleared buyer receipts','Controlled collection account',receipt)],0,period);
      state.collectionCashCents-=protectedAmount;state.protectedPaidCents+=protectedAmount;eligible+=eligibleAmount;
      r.add('period_'+period+'_protected','Period '+period+' protect the designated local proceeds','Remove the agreed protected amounts before applying the sweep. The workbook receipt schedule is already eligible after prior exclusions, so its default protected inputs are zero. The annex trade instead starts with gross USD1,900 and protects USD400.',[cash('Controlled collection account','Protected farmer proceeds',protectedAmount)],0,period);
      state.collectionCashCents-=sweep;state.issuerCollectionsCashCents+=sweep;state.remainingCapCents-=sweep;state.principalOutstandingCents-=principalRepaid;state.principalRepaidCents+=principalRepaid;state.premiumRepaidCents+=premiumRepaid;remitted+=sweep;
      r.add('period_'+period+'_sweep','Period '+period+' remit the capped revenue share','Remittance is the smaller of the agreed share of eligible cleared cash and the remaining collection cap. Principal is identified first, then premium. The issuer collects only this remittance, not all crop-sale proceeds.',[cash('Controlled collection account','Issuer collection account',sweep,'Principal USD'+(principalRepaid/100).toFixed(2)+'; premium USD'+(premiumRepaid/100).toFixed(2))],0,period);
      state.collectionCashCents-=retained;state.cooperativeRetainedPaidCents+=retained;
      const final=period===p.periodCount,status=final?(state.remainingCapCents===0?'success':'cap_outstanding'):'period_closed';
      r.add('period_'+period+'_retained','Period '+period+' pay the cooperative remainder','The unswept eligible balance belongs to the cooperative under its member mandate, in addition to separately protected proceeds. Once the collection cap is reached, later eligible receipts are retained in full.',[cash('Controlled collection account','Cooperative local proceeds',retained)],0,period,status);
      rows.push({period,grossReceiptsCents:receipt,protectedProceedsCents:protectedAmount,eligibleReceiptsCents:eligibleAmount,openingCapCents:openingCap,remittanceCents:sweep,principalRepaidCents:principalRepaid,premiumRepaidCents:premiumRepaid,cooperativeRetainedCents:retained,localProceedsCents:retained+protectedAmount,closingCapCents:state.remainingCapCents,cashCheckCents:receipt-protectedAmount-sweep-retained});
    }
    return r.finish([],rows);
  }
  function simulate(inputs){try{const n=normalize(inputs);if(n.errors.length)return invalid(n.inputs,n.errors);return n.inputs.view==='facility'?facility(n.inputs):portfolio(n.inputs);}catch(error){return invalid(inputs&&typeof inputs==='object'?Object.assign({},inputs):{view:'portfolio'},[error&&error.message?error.message:'Unable to calculate this scenario.']);}}
  return Object.freeze({defaults,presets,simulate});
});
