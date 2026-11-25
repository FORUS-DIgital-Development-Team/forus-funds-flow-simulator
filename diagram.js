/* Participant network for the FORUS illustrative funds-flow model. No accounting mutations. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FlowDiagram = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const currencies = {
    ZAR: new Intl.NumberFormat('en-ZA', { style:'currency',currency:'ZAR',minimumFractionDigits:2,maximumFractionDigits:2 }),
    USD: new Intl.NumberFormat('en-US', { style:'currency',currency:'USD',currencyDisplay:'code',minimumFractionDigits:2,maximumFractionDigits:2 })
  };
  const formatMoney = (value,code) => (currencies[code]||currencies.ZAR).format((Number(value)||0)/100).replace(/\u00a0/g,' ');
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kindTitle = (kind,mode) => (mode==='bond'?{cash:'Cash',value:'Claim record',pending:'Deferred / unpaid'}:{cash:'Cash',entitlement:'Entitlement',value:'Funded value',pending:'Pending obligation'})[kind] || kind;
  const visualKind = kind => kind === 'cash' ? 'cash' : kind === 'pending' ? 'pending' : 'ledger';
  const validModes = ['benefit','wow','bond'];
  let instanceNumber = 0;

  function sceneFor(mode, result, stepIndex) {
    if (!validModes.includes(mode) || !result || !Array.isArray(result.steps) || !result.steps.length) return {mode,stepId:null,title:'No calculated flow',status:'invalid',stepIndex:0,nodes:[],edges:[],narration:[]};
    const index = Math.max(0, Math.min(Number.isInteger(stepIndex) ? stepIndex : 0,result.steps.length-1));
    const step = result.steps[index], b = step.balances || {}, m = step.metrics || {};
    const currencyCode = mode==='bond'?'USD':'ZAR';
    const nodes = [], byId = new Map(), endpointMap = {};
    const direct = (label, refs) => ({ label,valueCents:refs.reduce((sum,ref) => { const [area,key] = ref.split('.'); return sum + Number((area==='metrics'?m:b)[key]||0); },0),fieldRefs:refs });
    const journal = (label,type,endpoint) => ({label,valueCents:result.steps.slice(0,index+1).reduce((sum,s) => sum+(s.entries||[]).filter(e => type==='journal_cash_from' ? e.kind==='cash'&&e.from===endpoint : e.to===endpoint).reduce((sum,e) => sum+e.amountCents,0),0),fieldRefs:[],derivation:{type,endpoint,throughStepIndex:index}});
    function define(id,label,role,rows,hint,endpoints) { const node={id,label,role,rows:rows||[],fieldRefs:(rows||[]).flatMap(row=>row.fieldRefs||[]),hint:hint||'',active:false}; for(const endpoint of endpoints||[]) endpointMap[endpoint]=node; return node; }
    const definitions = {};
    function addDef(key,...args) { definitions[key]=define(key,...args); return definitions[key]; }
    if(mode==='benefit') {
      addDef('sponsor','Programme sponsor','cash_source',[journal('Paid in','journal_cash_from','Sponsor')],'External source; remaining cash unknown',['Sponsor']);
      addDef('programme_cash','Programme cash account','cash',[direct('Cash held',['balances.programmeCashCents'])],'Actual modelled cash',['Programme cash']);
      addDef('allocation_event','Programme allocation','event',[],'Authorises benefits; creates no cash',['Programme allocation']);
      addDef('voucher_available','Voucher entitlement','entitlement',[direct('Available',['balances.voucherAvailableCents'])],'Member benefit right',['Voucher available']);
      addDef('coupon_available','Coupon entitlement','entitlement',[direct('Available',['balances.couponAvailableCents'])],'Member benefit right',['Coupon available']);
      addDef('vas_available','VAS entitlement','entitlement',[direct('Available',['balances.vasAvailableCents'])],'Member benefit right',['VAS available']);
      addDef('basket','Basket commitment','entitlement',[direct('Unfulfilled',['balances.orderCents'])],'Original draw; no second debit',['Basket commitment','Reversed basket']);
      addDef('provider_cash','Benefit provider cash','cash',[direct('Cash held',['balances.providerCashCents'])],'Actual modelled cash',['Provider cash']);
      addDef('platform_receipts','Platform fee recipient','cash_receipt',[direct('Received',['balances.platformFeesCents'])],'External cash received',['Platform fee recipient']);
      addDef('vas_supplier','VAS supplier','cash_receipt',[direct('Received',['balances.supplierReceiptsCents'])],'External cash received',['VAS supplier']);
      addDef('vas_delivered','VAS benefit delivered','entitlement',[journal('Delivered','journal_to','VAS delivered')],'Consumed service value',['VAS delivered']);
      addDef('issued_voucher','Issued voucher claim','entitlement',[direct('Awaiting use',['balances.issuedVoucherCents'])],'Claim on the provider',['Issued voucher claim']);
      addDef('issued_coupon','Issued coupon claim','entitlement',[direct('Awaiting use',['balances.issuedCouponCents'])],'Claim on the provider',['Issued coupon claim']);
      addDef('issued_claims','Issued benefit claims','entitlement',[direct('Voucher',['balances.issuedVoucherCents']),direct('Coupon',['balances.issuedCouponCents'])],'Claims on the provider',['Issued voucher and coupon claims']);
      addDef('redeemed','Benefits redeemed','entitlement',[journal('Used','journal_to','Benefits redeemed')],'Voucher and coupon benefit consumed',['Benefits redeemed']);
      addDef('member_cash','Member co-payment','cash_source',[direct('Paid in',['metrics.copayCents'])],'Separate external member cash',['Member co-payment']);
      addDef('merchant','Redeeming merchant','cash_receipt',[direct('Received',['balances.merchantReceiptsCents'])],'Cash from provider and member',['Merchant']);
      addDef('available_summary','Available member benefits','entitlement',[direct('Voucher',['balances.voucherAvailableCents']),direct('Coupon',['balances.couponAvailableCents']),direct('VAS',['balances.vasAvailableCents'])],'Benefit rights; not extra cash',[]);
    } else if(mode==='wow') {
      addDef('commuter_cash','Commuter cash source','cash_source',[journal('Paid in','journal_cash_from','Commuter external cash')],'External cash; before wallet funding',['Commuter external cash']);
      addDef('agent','Cash collection agent','cash',[direct('Cash held',['balances.agentCashCents'])],'Not spendable until remitted',['Cash agent']);
      addDef('reserve','Pooled settlement cash','cash',[direct('Cash held',['balances.reserveCashCents'])],'Backs funded wallets and payables',['Programme reserve cash']);
      addDef('issuance_event','Record funded value','event',[],'Ledger event; same remitted cash',['Funded value issuance']);
      addDef('commuter','Commuter wallet','value',[direct('Funded value',['balances.commuterValueCents'])],'Ownership claim against the pool',['Commuter wallet']);
      addDef('operator','Taxi operator wallet','value',[direct('Funded value',['balances.operatorValueCents'])],'Fare collector acts for the operator',['Operator wallet']);
      addDef('driver','Driver reward wallet','value',[direct('Funded value',['balances.driverValueCents'])],'Only funded rewards can be spent',['Driver wallet']);
      addDef('cooperative','Cooperative allocation','value',[direct('Funded value',['balances.cooperativeValueCents'])],'Earned fees and funded rebate share',['Cooperative wallet']);
      addDef('provider','Provider fee allocation','value',[direct('Funded value',['balances.providerValueCents'])],'Earned fees not yet withdrawn',['Provider wallet']);
      addDef('referral','Referral allocation','value',[direct('Funded value',['balances.referralValueCents'])],'Configured share of earned fare fee',['Referral wallet']);
      addDef('fuel_payable','Fuel merchant payable','value',[direct('Still owed',['balances.fuelPayableCents'])],'Funded claim against pool cash',['Fuel merchant payable']);
      addDef('fuel_station','Fuel station','cash_receipt',[direct('Received',['balances.fuelMerchantReceivedCents'])],'External merchant cash received',['Fuel merchant']);
      addDef('fuel_sponsor','Fuel reward sponsor','cash_source',[direct('Paid in',['metrics.fuelRebateFundedCents'])],'Funding is separate from earning',['Fuel rebate sponsor']);
      addDef('fuel_pending','Pending fuel reward','pending',[direct('Unfunded',['balances.fuelRebatePendingCents'])],'Earned receivable; cannot be spent',['Pending fuel rebate']);
      addDef('fuel_allocation','Allocate funded fuel reward','event',[],'Ledger event; same sponsor funding',['Funded fuel rebate']);
      addDef('shop_payable','Spaza merchant payable','value',[direct('Still owed',['balances.merchantPayableCents'])],'Funded claim against pool cash',['Shopping merchant payable']);
      addDef('spaza','Participating spaza','cash_receipt',[direct('Received',['balances.shopMerchantReceivedCents'])],'External merchant cash received',['Shopping merchant']);
      addDef('shop_sponsor','Shopping reward sponsor','cash_source',[direct('Paid in',['metrics.shopRebateFundedCents'])],'Separate sponsor cash source',['Shopping reward sponsor']);
      addDef('shop_pending','Pending shopping reward','pending',[direct('Unfunded',['balances.shopRebatePendingCents'])],'Earned receivable; cannot be spent',['Pending shopping reward']);
      addDef('shop_allocation','Allocate funded shopping reward','event',[],'Ledger event; same sponsor funding',['Funded shopping reward']);
      addDef('provider_receipts','Provider external account','cash_receipt',[direct('Received',['balances.providerPaidCents'])],'Withdrawn from earned fee allocation',['Provider external account']);
      addDef('operating_supplier','KYC and operating supplier','cash_receipt',[direct('Received',['balances.coopExpensesPaidCents'])],'Paid from the cooperative allocation',['Cooperative operating supplier']);
      addDef('commuter_receipts','Commuter cash withdrawal','cash_receipt',[direct('Paid out',['balances.commuterCashoutPaidCents'])],'Wallet and pool both reduce',['Commuter cash-out']);
    } else {
      for(const account of result.accounts||[]) {
        const rows=(account.rows||[]).map(row=>direct(row.label,[(row.area||'balances')+'.'+row.field]));
        addDef(account.id,account.label,account.role,rows,account.hint,account.endpoints||[]);
      }
    }
    function use(node,active) { if(!node)return null; if(!byId.has(node.id)){byId.set(node.id,node);nodes.push(node);} if(active)node.active=true; return node; }
    function endpoint(name) {
      if(endpointMap[name]) return endpointMap[name];
      const id='unmapped_'+String(name).replace(/[^a-z0-9]+/gi,'_').toLowerCase();
      return define(id,name,'event',[],'Journal endpoint',[]);
    }
    const edges=(step.entries||[]).map((entry,i)=>{
      const from=use(endpoint(entry.from),true),to=use(endpoint(entry.to),true);
      return {id:'entry_'+i,source:from.id,target:to.id,from:entry.from,to:entry.to,kind:entry.kind,amountCents:entry.amountCents,note:entry.note||'',entryIndex:i};
    });
    if(mode==='benefit') {
      use(definitions.programme_cash,false);
      if(!edges.length){use(definitions.basket,false);use(definitions.available_summary,false);if(b.providerCashCents>0)use(definitions.provider_cash,false);}
      if(step.id==='codes_issued') use(definitions.provider_cash,false);
    } else if(mode==='wow') {
      use(definitions.reserve,false);
      if(step.id==='awaiting_cash_in')use(definitions.agent,false);
      if(step.id==='fuel_settled' && b.fuelPayableCents>0)use(definitions.fuel_payable,false);
      if(step.id==='shopping_settled' && b.merchantPayableCents>0)use(definitions.shop_payable,false);
      if(step.id==='fuel_rebate_funded'&&b.fuelRebatePendingCents>0)use(definitions.fuel_pending,false);
      if(step.id==='shop_rebate_funded'&&b.shopRebatePendingCents>0)use(definitions.shop_pending,false);
      if(step.id==='provider_paid')use(definitions.provider,false);
      if(step.id==='cooperative_expense')use(definitions.cooperative,false);
      if(step.id==='closing_position'){
        for(const [key,field] of [['commuter','commuterValueCents'],['operator','operatorValueCents'],['driver','driverValueCents'],['cooperative','cooperativeValueCents'],['provider','providerValueCents'],['referral','referralValueCents'],['fuel_payable','fuelPayableCents'],['shop_payable','merchantPayableCents'],['fuel_pending','fuelRebatePendingCents'],['shop_pending','shopRebatePendingCents']]) if(b[field]>0)use(definitions[key],false);
      }
    } else {
      for(const account of result.accounts||[]) {
        const node=definitions[account.id];
        const nonzero=node.rows.some(row=>row.valueCents>0);
        if(account.role==='cash'&&nonzero)use(node,false);
        if(!edges.length&&['claim','pending','asset'].includes(account.role)&&nonzero)use(node,false);
      }
      if(!edges.length&&!nodes.some(node=>node.role==='cash')) {
        const cash=(result.accounts||[]).filter(account=>account.role==='cash');
        const account=cash.find(account=>(account.rows||[]).some(row=>['distributionCashCents','collectionCashCents'].includes(row.field)))||cash[0];
        if(account)use(definitions[account.id],false);
      }
    }
    const narration=edges.map(edge=>kindTitle(edge.kind,mode)+' movement: '+formatMoney(edge.amountCents,currencyCode)+' from '+edge.from+' to '+edge.to+(edge.note?'. '+edge.note:'.'));
    if(!edges.length)narration.push(m.status==='success'?'Closing balances are confirmed. No funds move at this step.':'No recorded cash, value or entitlement movement at this step.');
    return {mode,currency:currencyCode,stepId:step.id,title:step.title,status:m.status||'intermediate',stepIndex:index,nodes,edges,narration};
  }

  function durationFor(step) {
    const count=step&&Array.isArray(step.entries)?step.entries.length:0;
    return count ? 1800 + Math.max(0,count-1)*500 + 850 : 2000;
  }

  function create(container) {
    if(!container || !container.ownerDocument)throw new Error('A diagram container element is required.');
    const document=container.ownerDocument,window=document.defaultView;
    const prefix='fd'+(++instanceNumber);
    const reduced=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
    let scene=null, lastPayload=null, frame=0, elapsed=0, lastTime=null, paused=false, destroyed=false, tokenTracks=[], resizeTimer=null;
    const money = value => formatMoney(value,scene?scene.currency:'ZAR');
    container.classList.add('fd-root');
    container.innerHTML='<div class="fd-meta"><span class="fd-after">Balances shown after this step</span><span class="fd-motion-state" aria-live="polite"></span></div><div class="fd-movement-key" role="list" aria-label="Amounts on numbered paths"></div><p class="fd-scroll-hint">Swipe sideways to inspect the complete diagram.</p><div class="fd-scroll" role="region" aria-label="Participant flow diagram" tabindex="0"><div class="fd-stage"><svg class="fd-connectors" xmlns="'+SVG+'" aria-hidden="true"></svg><div class="fd-node-layer"></div></div></div><p class="fd-static-note"></p><ol class="fd-accessible"></ol>';
    const scroll=container.querySelector('.fd-scroll'),stage=container.querySelector('.fd-stage'),svg=container.querySelector('svg'),nodeLayer=container.querySelector('.fd-node-layer'),motionState=container.querySelector('.fd-motion-state'),staticNote=container.querySelector('.fd-static-note'),accessible=container.querySelector('.fd-accessible'),movementKey=container.querySelector('.fd-movement-key');
    function svgElement(tag,attributes,parent){const element=document.createElementNS(SVG,tag);Object.entries(attributes||{}).forEach(([key,value])=>element.setAttribute(key,String(value)));if(parent)parent.appendChild(element);return element;}
    function stopFrame(){if(frame)window.cancelAnimationFrame(frame);frame=0;lastTime=null;}
    function roleLabel(role){return {cash:'Cash account',cash_source:'External cash source',cash_receipt:'External cash receipt',entitlement:'Benefit entitlement',value:'Funded ownership',pending:'Unfunded obligation',claim:'Contractual claim',asset:'Asset or receivable',counterparty:'Capital provider',event:'Ledger event'}[role]||role;}
    function nodeHtml(node){return '<div class="fd-node-role">'+escape(roleLabel(node.role))+'</div><div class="fd-node-title">'+escape(node.label)+'</div>'+node.rows.map(row=>'<div class="fd-node-value"><span>'+escape(row.label)+'</span><strong>'+money(row.valueCents)+'</strong></div>').join('')+'<p class="fd-node-hint">'+escape(node.hint)+'</p>';}
    function computeRanks(nodes,edges){const rank=new Map(nodes.map(node=>[node.id,0]));for(let i=0;i<nodes.length;i++){let changed=false;for(const edge of edges){const next=rank.get(edge.source)+1;if(next>rank.get(edge.target)&&edge.source!==edge.target){rank.set(edge.target,next);changed=true;}}if(!changed)break;}return rank;}
    function layout(){
      if(!scene)return;
      const available=container.clientWidth||640,wide=available>=650,width=Math.max(440,available),padding=18,gap=wide?74:62,columns=wide?3:2,nodeWidth=(width-padding*2-gap*(columns-1))/columns;
      const active=scene.nodes.filter(node=>node.active),context=scene.nodes.filter(node=>!node.active),positions=new Map(),elements=new Map();
      nodeLayer.innerHTML='';
      for(const node of scene.nodes){const div=document.createElement('div');div.className='fd-node fd-role-'+node.role+(node.active?' is-active':' is-context');div.dataset.nodeId=node.id;div.style.width=nodeWidth+'px';div.innerHTML=nodeHtml(node);nodeLayer.appendChild(div);elements.set(node.id,div);}
      const heights=new Map([...elements].map(([id,el])=>[id,Math.ceil(el.offsetHeight)]));
      let activeHeight=0;
      if(active.length){
        const ranks=computeRanks(active,scene.edges),maxRank=Math.max(...ranks.values());
        if(wide){
          const columnLists=[[],[],[]];for(const node of active){const r=ranks.get(node.id);const col=maxRank===0?1:maxRank===1?(r===0?0:2):Math.min(2,r);columnLists[col].push(node);}
          const columnHeights=columnLists.map(list=>list.reduce((sum,node)=>sum+heights.get(node.id),0)+Math.max(0,list.length-1)*40);
          activeHeight=Math.max(160,...columnHeights);
          columnLists.forEach((list,col)=>{let y=padding+(activeHeight-columnHeights[col])/2;for(const node of list){positions.set(node.id,{x:padding+col*(nodeWidth+gap),y,w:nodeWidth,h:heights.get(node.id)});y+=heights.get(node.id)+40;}});
        }else{
          let y=padding;
          for(let rank=0;rank<=maxRank;rank++){
            const list=active.filter(node=>ranks.get(node.id)===rank);
            for(let i=0;i<list.length;i+=2){const pair=list.slice(i,i+2);const rowH=Math.max(...pair.map(node=>heights.get(node.id)));pair.forEach((node,col)=>positions.set(node.id,{x:pair.length===1?(width-nodeWidth)/2:padding+col*(nodeWidth+gap),y,w:nodeWidth,h:heights.get(node.id)}));y+=rowH+70;}
            if(rank<maxRank)y+=20;
          }
          activeHeight=Math.max(0,y-padding-70);
        }
      }
      let contextStart=padding+activeHeight+(active.length&&context.length?58:0),contextY=contextStart;
      if(context.length){for(let i=0;i<context.length;i+=columns){const row=context.slice(i,i+columns),rowH=Math.max(...row.map(node=>heights.get(node.id))),rowWidth=row.length*nodeWidth+(row.length-1)*gap,left=(width-rowWidth)/2;row.forEach((node,col)=>positions.set(node.id,{x:left+col*(nodeWidth+gap),y:contextY,w:nodeWidth,h:heights.get(node.id)}));contextY+=rowH+30;}}
      const height=Math.max(160,context.length?contextY-30+padding:padding+activeHeight+padding);
      stage.style.width=width+'px';stage.style.height=height+'px';svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox','0 0 '+width+' '+height);
      for(const[id,rect]of positions){const div=elements.get(id);div.style.left=rect.x+'px';div.style.top=rect.y+'px';}
      container.classList.toggle('fd-overflow',width>available+1);container.classList.toggle('fd-portrait',!wide);
      drawEdges(positions,width,height,wide);
    }

    function segmentClear(a,b,rects){
      for(const r of rects){const left=r.x-9,right=r.x+r.w+9,top=r.y-9,bottom=r.y+r.h+9;
        if(Math.abs(a.x-b.x)<.01){if(a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom)return false;}
        else if(Math.abs(a.y-b.y)<.01){if(a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right)return false;}
      }return true;
    }
    function orthogonalRoute(start,end,rects,width,height){
      const unique=values=>[...new Set(values.map(value=>Math.round(value*10)/10))].sort((a,b)=>a-b);
      const xs=unique([12,width-12,start.x,end.x,...rects.flatMap(r=>[r.x-22,r.x+r.w+22])].filter(x=>x>=10&&x<=width-10));
      const ys=unique([10,height-10,start.y,end.y,...rects.flatMap(r=>[r.y-22,r.y+r.h+22])].filter(y=>y>=8&&y<=height-8));
      const sx=xs.indexOf(Math.round(start.x*10)/10),sy=ys.indexOf(Math.round(start.y*10)/10),ex=xs.indexOf(Math.round(end.x*10)/10),ey=ys.indexOf(Math.round(end.y*10)/10);
      if(sx<0||sy<0||ex<0||ey<0)return [start,{x:start.x,y:end.y},end];
      const key=(x,y,d)=>x+','+y+','+d,open=[{x:sx,y:sy,d:'',g:0,f:0}],best=new Map([[key(sx,sy,''),0]]),previous=new Map();let found=null,guard=0;
      while(open.length&&guard++<12000){open.sort((a,b)=>a.f-b.f);const current=open.shift(),currentKey=key(current.x,current.y,current.d);if(current.x===ex&&current.y===ey){found=currentKey;break;}
        for(const [dx,dy,d]of[[1,0,'h'],[-1,0,'h'],[0,1,'v'],[0,-1,'v']]){const x=current.x+dx,y=current.y+dy;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;const a={x:xs[current.x],y:ys[current.y]},b={x:xs[x],y:ys[y]};if(!segmentClear(a,b,rects))continue;const g=current.g+Math.abs(b.x-a.x)+Math.abs(b.y-a.y)+(current.d&&current.d!==d?14:0),nextKey=key(x,y,d);if(best.has(nextKey)&&best.get(nextKey)<=g)continue;best.set(nextKey,g);previous.set(nextKey,currentKey);open.push({x,y,d,g,f:g+Math.abs(xs[x]-end.x)+Math.abs(ys[y]-end.y)});}
      }
      if(!found)return [start,{x:width-12,y:start.y},{x:width-12,y:end.y},end];
      const points=[];let cursor=found;while(cursor){const [x,y]=cursor.split(',').map(Number);points.push({x:xs[x],y:ys[y]});cursor=previous.get(cursor);}points.reverse();
      return points.filter((p,i)=>i===0||i===points.length-1||!((points[i-1].x===p.x&&p.x===points[i+1].x)||(points[i-1].y===p.y&&p.y===points[i+1].y)));
    }
    function roundedPath(points){if(!points.length)return '';let d='M '+points[0].x+' '+points[0].y;for(let i=1;i<points.length;i++){const p=points[i];if(i===points.length-1){d+=' L '+p.x+' '+p.y;continue;}const prev=points[i-1],next=points[i+1],a=Math.hypot(p.x-prev.x,p.y-prev.y),b=Math.hypot(next.x-p.x,next.y-p.y),radius=Math.min(8,a/2,b/2);if(!a||!b)continue;const before={x:p.x+(prev.x-p.x)*radius/a,y:p.y+(prev.y-p.y)*radius/a},after={x:p.x+(next.x-p.x)*radius/b,y:p.y+(next.y-p.y)*radius/b};d+=' L '+before.x+' '+before.y+' Q '+p.x+' '+p.y+' '+after.x+' '+after.y;}return d;}
    function drawEdges(positions,width,height,wide){
      svg.innerHTML='';tokenTracks=[];
      const defs=svgElement('defs',{},svg);
      for(const kind of ['cash','ledger','pending']){const marker=svgElement('marker',{id:prefix+'-arrow-'+kind,markerWidth:8,markerHeight:8,refX:7,refY:4,orient:'auto',markerUnits:'userSpaceOnUse'},defs);svgElement('path',{d:'M 0 0 L 8 4 L 0 8 Z',class:'fd-arrow '+kind},marker);}
      const lineLayer=svgElement('g',{class:'fd-line-layer'},svg),labelLayer=svgElement('g',{class:'fd-label-layer'},svg),tokenLayer=svgElement('g',{class:'fd-token-layer'},svg),rects=[...positions.values()],labelBoxes=[];
      const counts={};scene.edges.forEach(edge=>{counts[edge.source]=(counts[edge.source]||0)+1;counts['in_'+edge.target]=(counts['in_'+edge.target]||0)+1;});const seen={};
      scene.edges.forEach((edge,index)=>{
        const a=positions.get(edge.source),b=positions.get(edge.target),kind=visualKind(edge.kind),out=(seen[edge.source]||0),incoming=(seen['in_'+edge.target]||0);seen[edge.source]=out+1;seen['in_'+edge.target]=incoming+1;
        const spread=(i,n)=>n>1?(i-(n-1)/2)*12:0;
        const start=wide?{x:a.x+a.w+2,y:a.y+a.h/2+spread(out,counts[edge.source])}:{x:a.x+a.w/2+spread(out,counts[edge.source]),y:a.y+a.h+2};
        const end=wide?{x:b.x-3,y:b.y+b.h/2+spread(incoming,counts['in_'+edge.target])}:{x:b.x+b.w/2+spread(incoming,counts['in_'+edge.target]),y:b.y-3};
        const outpoint=wide?{x:start.x+14,y:start.y}:{x:start.x,y:start.y+14},inpoint=wide?{x:end.x-14,y:end.y}:{x:end.x,y:end.y-14};
        const route=orthogonalRoute(outpoint,inpoint,rects,width,height),points=[start,...route,end],path=svgElement('path',{d:roundedPath(points),class:'fd-edge '+kind,'marker-end':'url(#'+prefix+'-arrow-'+kind+')','data-edge-id':edge.id,'data-kind':edge.kind,'data-amount-cents':edge.amountCents},lineLayer);
        const length=path.getTotalLength();
        // Full amounts live in the wrapping key, never over account cards.
        // Small numbered badges identify their matching directional paths.
        const labelWidth=28,labelHeight=28;
        const overlaps=box=>rects.concat(labelBoxes).some(r=>box.x<r.x+r.w+5&&box.x+box.w>r.x-5&&box.y<r.y+r.h+5&&box.y+box.h>r.y-5);
        let selected=null;
        const fractions=[.5,.38,.62,.26,.74,.14,.86,.08,.92];
        for(const fraction of fractions){const point=path.getPointAtLength(length*fraction);for(const offset of[0,-20,20,-38,38]){const box={x:Math.max(5,Math.min(width-labelWidth-5,point.x-labelWidth/2)),y:Math.max(5,Math.min(height-labelHeight-5,point.y+offset-labelHeight/2)),w:labelWidth,h:labelHeight};if(!overlaps(box)){selected=box;break;}}if(selected)break;}
        if(!selected){
          // Use a nearby free corridor if the preferred path samples are crowded.
          const mid=path.getPointAtLength(length/2),candidates=[];
          for(let y=8;y<height-labelHeight-8;y+=18)for(let x=8;x<width-labelWidth-8;x+=18){const box={x,y,w:labelWidth,h:labelHeight};if(!overlaps(box))candidates.push({box,distance:Math.hypot(x+14-mid.x,y+14-mid.y)});}
          candidates.sort((a,b)=>a.distance-b.distance);if(candidates.length)selected=candidates[0].box;
        }
        // Never introduce a colliding fallback. The complete key remains visible.
        if(selected){labelBoxes.push(selected);const labelGroup=svgElement('g',{class:'fd-edge-label '+kind,'data-edge-label':edge.id},labelLayer);svgElement('rect',{x:selected.x,y:selected.y,width:selected.w,height:selected.h,rx:14},labelGroup);const text=svgElement('text',{x:selected.x+selected.w/2,y:selected.y+18,'text-anchor':'middle'},labelGroup);text.textContent=String(index+1);}
        const token=svgElement('g',{class:'fd-money-token '+kind,'data-moving':'true','data-edge-id':edge.id,'data-kind':edge.kind,'data-progress':'0',opacity:0},tokenLayer);
        if(kind==='cash')svgElement('circle',{r:12},token);else svgElement('rect',{x:-10,y:-10,width:20,height:20,rx:kind==='pending'?2:5,transform:kind==='pending'?'rotate(45)':''},token);
        const glyph=svgElement('text',{'text-anchor':'middle',y:4},token);glyph.textContent=kind==='cash'?(scene.currency==='USD'?'$':'R'):kind==='pending'?'?':'V';
        tokenTracks.push({token,path,length,delay:index*500,duration:1800,index});
      });
      applyMotion();
    }
    function applyMotion(){
      const noMotion=!!(reduced&&reduced.matches);let any=false;
      for(const track of tokenTracks){const fraction=noMotion?1:Math.max(0,Math.min(1,(elapsed-track.delay)/track.duration)),started=noMotion||elapsed>=track.delay,complete=fraction>=1;const point=track.path.getPointAtLength(track.length*fraction);track.token.setAttribute('transform','translate('+point.x.toFixed(2)+' '+point.y.toFixed(2)+')');track.token.setAttribute('data-progress',fraction.toFixed(4));track.token.setAttribute('data-moving',String(started&&!complete&&!paused&&!noMotion));track.token.setAttribute('opacity',noMotion||!started||complete?'0':'1');if(started&&!complete)any=true;}
      if(!scene||!scene.edges.length)motionState.textContent='No movement at this step';else if(noMotion)motionState.textContent='Reduced motion · static diagram';else if(paused&&elapsed<durationFor({entries:scene.edges})-850)motionState.textContent='Motion paused';else if(elapsed>=durationFor({entries:scene.edges})-850)motionState.textContent='Step motion complete';else motionState.textContent='Showing '+scene.edges.length+' recorded movement'+(scene.edges.length===1?'':'s');
      return any;
    }
    function tick(time){frame=0;if(destroyed||paused||!scene||!scene.edges.length||(reduced&&reduced.matches)){lastTime=null;applyMotion();return;}if(lastTime!==null)elapsed+=Math.max(0,time-lastTime);lastTime=time;applyMotion();if(elapsed<durationFor({entries:scene.edges})-850)frame=window.requestAnimationFrame(tick);else lastTime=null;}
    function start(){stopFrame();if(!paused&&scene&&scene.edges.length&&!(reduced&&reduced.matches))frame=window.requestAnimationFrame(tick);else applyMotion();}
    function render(payload){if(destroyed)return;lastPayload=payload;scene=sceneFor(payload.mode,payload.result,payload.stepIndex);elapsed=0;paused=false;stopFrame();accessible.innerHTML=scene.narration.map(text=>'<li>'+escape(text)+'</li>').join('');movementKey.innerHTML=scene.edges.map((edge,i)=>{const source=scene.nodes.find(node=>node.id===edge.source),target=scene.nodes.find(node=>node.id===edge.target);return '<div class="fd-key-item '+visualKind(edge.kind)+'" role="listitem"><span class="fd-key-number">'+(i+1)+'</span><span class="fd-key-head"><span class="fd-key-kind">'+escape(kindTitle(edge.kind,scene.mode))+'</span><strong>'+money(edge.amountCents)+'</strong></span><span class="fd-key-route">'+escape(source?source.label:edge.from)+' to '+escape(target?target.label:edge.to)+'</span></div>';}).join('');movementKey.hidden=!scene.edges.length;staticNote.textContent=scene.edges.length?(scene.mode==='bond'?'Orange paths transfer cleared cash. Blue paths update contractual claims. Gold paths record deferred collections or unpaid obligations. Claims are not additional cash.':'Orange paths transfer cash. Blue paths update rights or funded ownership. Gold paths record unfunded rewards. The same cash is not counted twice.'):scene.narration[0];layout();start();}
    function setPaused(value){paused=Boolean(value);if(paused){stopFrame();applyMotion();}else start();}
    function replay(){if(destroyed||!scene)return;elapsed=0;paused=false;start();}
    function onResize(){if(resizeTimer)window.clearTimeout(resizeTimer);resizeTimer=window.setTimeout(()=>{resizeTimer=null;if(scene){const wasPaused=paused;stopFrame();layout();paused=wasPaused;start();}},100);}
    const observer=window.ResizeObserver?new window.ResizeObserver(onResize):null;if(observer)observer.observe(container);else window.addEventListener('resize',onResize);
    // Reposition paths once the branded typeface has set the final node sizes.
    if (document.fonts) document.fonts.ready.then(() => { if (!destroyed) onResize(); });
    const onMotionPreference=()=>{stopFrame();applyMotion();start();};if(reduced){if(reduced.addEventListener)reduced.addEventListener('change',onMotionPreference);else reduced.addListener(onMotionPreference);}
    function destroy(){destroyed=true;stopFrame();if(resizeTimer)window.clearTimeout(resizeTimer);if(observer)observer.disconnect();else window.removeEventListener('resize',onResize);if(reduced){if(reduced.removeEventListener)reduced.removeEventListener('change',onMotionPreference);else reduced.removeListener(onMotionPreference);}container.innerHTML='';container.classList.remove('fd-root');}
    return {render,setPaused,replay,destroy,durationFor};
  }
  return {create,sceneFor,durationFor};
});
