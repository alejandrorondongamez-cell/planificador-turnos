
(() => {
  'use strict';

  const S = { users: [], config: null, holidays: [], holidayMap: new Map(), schedule: {}, date: new Date(), admin: false, view: 'month', repMode: 'year', lastReport: [] };
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseISO = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
  const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
  const dow = s => { const d=parseISO(s).getDay(); return d===0?7:d; };
  const monthStart = (y,m) => { const f=new Date(y,m,1); const off=(f.getDay()+6)%7; return new Date(y,m,1-off); };
  const range = (a,b) => { const out=[]; for(let d=parseISO(a); d<=parseISO(b); d.setDate(d.getDate()+1)) out.push(iso(d)); return out; };

  async function sha256(t){ const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  async function loadJson(n){ const r=await fetch(`data/${n}.json`,{cache:'no-store'}); if(!r.ok) throw new Error(`No carga data/${n}.json (${r.status})`); return r.json(); }

  const holiday = day => S.holidayMap.get(day);
  const hType = day => holiday(day)?.type || 'standard';
  const isWorkday = day => S.config.rules.workdays.includes(dow(day));
  const isWeekend = day => [6,7].includes(dow(day));
  const isLegalHoliday = day => ['national','regional','local'].includes(hType(day)) && holiday(day)?.countsAsLegalHoliday !== false;
  const isImpactHoliday = day => hType(day)==='madrid_volume' || (holiday(day)?.countsAsLegalHoliday===false && hType(day)!=='global_closed');

  const minCov = day => S.config.rules.coverageByDayType[hType(day)] || S.config.rules.coverageByDayType.standard;
  const genCov = day => S.config.rules.generationByDayType[hType(day)] || S.config.rules.generationByDayType.standard;

  const nameOf = id => S.users.find(u=>u.id===id)?.name || id;
  const roleOf = id => S.users.find(u=>u.id===id)?.role || 'standard';

  const isUnavailable = (user, day) => (user.timeOff||[]).some(x=>x.type==='vacation' && day>=x.start && day<=x.end);
  const vacUsers = day => S.users.filter(u=>isUnavailable(u,day));

  function weekStart(day){ const d=parseISO(day); const off=(d.getDay()+6)%7; return iso(addDays(d,-off)); }
  function weekEnd(ws){ return iso(addDays(parseISO(ws),6)); }
  function weeksTouched(a,b){ return [...new Set(range(a,b).map(weekStart))].sort(); }
  function monthKeyFromWeekStart(ws){ return ws.slice(0,7); }

  function weekEveningSet(ws, schedule){
    const set=new Set();
    for(const day of range(ws,weekEnd(ws))) (schedule[day]?.evening||[]).forEach(id=>set.add(id));
    return set;
  }

  function monthEveningWeekCount(id, monthKey, schedule){
    const y=Number(monthKey.slice(0,4));
    const m=Number(monthKey.slice(5,7))-1;
    const first=iso(new Date(y,m,1));
    const last=iso(new Date(y,m+1,0));
    const weeks=[...new Set(range(first,last).map(weekStart))];
    let c=0;
    for(const ws of weeks){ if(weekEveningSet(ws, schedule).has(id)) c++; }
    return c;
  }

  function vacationWarnings(user,a,b){
    const w=[];
    if(a>=S.config.serviceStartDate){
      const days=Math.floor((parseISO(b)-parseISO(a))/86400000)+1;
      if(days < S.config.rules.vacationMinNaturalDaysAfterServiceStart) w.push(`A partir del ${S.config.serviceStartDate}: mínimo recomendado ${S.config.rules.vacationMinNaturalDaysAfterServiceStart} días.`);
      if(S.config.rules.vacationMustBeMondayToSundayAfterServiceStart && (dow(a)!==1 || dow(b)!==7)) w.push(`A partir del ${S.config.serviceStartDate}: recomendado lunes→domingo.`);
    }
    const weeks=weeksTouched(a,b);
    for(const ws of weeks){
      const we=weekEnd(ws);
      const set=new Set();
      S.users.forEach(u => (u.timeOff||[]).filter(x=>x.type==='vacation').forEach(v=>{ if(v.start<=we && v.end>=ws) set.add(u.id); }));
      if(a<=we && b>=ws) set.add(user.id);
      if(set.size > S.config.rules.maxPeopleOffPerWeek) w.push(`Semana ${ws}→${we}: ${set.size} fuera (${[...set].map(nameOf).join(', ')}).`);
    }
    return w;
  }

  function reportRange(from,to,schedule=S.schedule){
    const rows=S.users.map(u=>({id:u.id,name:u.name,morningDays:0,eveningDays:0,morningHours:0,eveningHours:0,legalHolidayDays:0,legalHolidayHours:0,impactHolidayDays:0,impactHolidayHours:0,totalHours:0}));
    const map=new Map(rows.map(r=>[r.id,r]));
    for(const day of range(from,to)){
      if(!isWorkday(day)) continue;
      const sc=schedule[day]||{morning:[],evening:[]};
      for(const id of (sc.morning||[])){
        const r=map.get(id); if(!r) continue;
        r.morningDays++; r.morningHours+=S.config.rules.shiftHours.morning; r.totalHours+=S.config.rules.shiftHours.morning;
        if(isLegalHoliday(day)){r.legalHolidayDays++; r.legalHolidayHours+=S.config.rules.shiftHours.morning;}
        else if(isImpactHoliday(day)){r.impactHolidayDays++; r.impactHolidayHours+=S.config.rules.shiftHours.morning;}
      }
      for(const id of (sc.evening||[])){
        const r=map.get(id); if(!r) continue;
        r.eveningDays++; r.eveningHours+=S.config.rules.shiftHours.evening; r.totalHours+=S.config.rules.shiftHours.evening;
        if(isLegalHoliday(day)){r.legalHolidayDays++; r.legalHolidayHours+=S.config.rules.shiftHours.evening;}
        else if(isImpactHoliday(day)){r.impactHolidayDays++; r.impactHolidayHours+=S.config.rules.shiftHours.evening;}
      }
    }
    return rows;
  }

  function reportMonth(y,m,schedule=S.schedule){ return reportRange(iso(new Date(y,m,1)), iso(new Date(y,m+1,0)), schedule); }
  function reportYear(y,schedule=S.schedule){ return reportRange(`${y}-01-01`, `${y}-12-31`, schedule); }

  function evalDay(day){
    const issues=[];
    if(!isWorkday(day)) return {issues};
    if(hType(day)==='global_closed') return {issues};
    const target=minCov(day);
    const sc=S.schedule[day]||{morning:[],evening:[]};
    const m=(sc.morning||[]).filter(id=>!isUnavailable(S.users.find(u=>u.id===id)||{},day));
    const e=(sc.evening||[]).filter(id=>!isUnavailable(S.users.find(u=>u.id===id)||{},day));
    if(m.length<target.morning) issues.push({date:day,message:`Mañana sin cobertura: ${m.length}/${target.morning}`});
    if(e.length<target.evening) issues.push({date:day,message:`Tarde sin cobertura: ${e.length}/${target.evening}`});
    return {issues};
  }

  function candidatePairs(avail){
    const seniors=avail.filter(u=>u.role==='senior');
    const std=avail.filter(u=>u.role!=='senior');
    const pairs=[];
    for(const s of seniors) for(const t of std) pairs.push([s.id,t.id]);
    return pairs;
  }

  function chooseEveningPair(ws, availWeek, schedule){
    const prevWs=iso(addDays(parseISO(ws),-7));
    const prevEvening=weekEveningSet(prevWs, schedule);
    const monthKey=monthKeyFromWeekStart(ws);
    const y=Number(monthKey.slice(0,4));
    const m=Number(monthKey.slice(5,7))-1;
    const monthRep=reportMonth(y,m,schedule);
    const yearRep=reportYear(y,schedule);
    const maxHard=S.config.rules.maxEveningWeeksPerMonthHard ?? 2;

    const scoreId = (id) => {
      const mr=monthRep.find(r=>r.id===id)||{};
      const yr=yearRep.find(r=>r.id===id)||{};
      // Hard restrictions
      if(S.config.rules.noConsecutiveEveningWeeks && prevEvening.has(id)) return 1e12;
      const mw=monthEveningWeekCount(id, monthKey, schedule);
      if(mw >= maxHard) return 1e12; // 3rd week prohibited

      // Annual balance dominates
      let s=0;
      s += (yr.eveningDays||0)*500;
      s += (mr.eveningDays||0)*120;
      s += (yr.legalHolidayHours||0)*60;
      s += (mr.legalHolidayHours||0)*120;
      if(mw==1) s += 5e7; // 2nd week only last resort
      return s;
    };

    const pairs=candidatePairs(availWeek);
    if(!pairs.length){
      const ids=availWeek.map(u=>u.id).sort((a,b)=>scoreId(a)-scoreId(b));
      return ids.slice(0,2);
    }

    const feasible=[];
    for(const [a,b] of pairs){
      const sa=scoreId(a), sb=scoreId(b);
      if(sa>=1e12 || sb>=1e12) continue;
      feasible.push([a,b,sa+sb]);
    }
    if(!feasible.length) return [];
    feasible.sort((x,y)=>x[2]-y[2]);
    return [feasible[0][0], feasible[0][1]];
  }

  function generateBetween(from,to,overwrite){
    const schedule=structuredClone(S.schedule||{});
    const weeks=weeksTouched(from,to);
    const failures=[];

    for(const ws of weeks){
      const days=range(ws,weekEnd(ws)).filter(d=>isWorkday(d) && d>=from && d<=to);
      if(!days.length) continue;
      const sample=days.find(d=>hType(d)!=='global_closed')||days[0];
      if(hType(sample)==='global_closed') continue;

      const availWeek=S.users.filter(u=>days.some(d=>!isUnavailable(u,d)));
      const pair=chooseEveningPair(ws, availWeek, schedule);
      if(pair.length!=2){
        failures.push(`Semana ${ws}: no hay par válido de tarde sin romper restricciones.`);
        continue;
      }

      for(const day of days){
        if(hType(day)==='global_closed'){ schedule[day]={morning:[],evening:[]}; continue; }
        if(!overwrite && schedule[day] && ((schedule[day].morning||[]).length || (schedule[day].evening||[]).length)) continue;

        const target=genCov(day);
        const avDay=S.users.filter(u=>!isUnavailable(u,day));
        const evening=pair.filter(id=>avDay.some(u=>u.id===id));

        const y=parseISO(day).getFullYear();
        const m=parseISO(day).getMonth();
        const monthRep=reportMonth(y,m,schedule);
        const scoreM=id => (monthRep.find(r=>r.id===id)?.morningDays||0);
        const rest=avDay.filter(u=>!evening.includes(u.id)).sort((a,b)=>scoreM(a.id)-scoreM(b.id));

        schedule[day]={morning:rest.slice(0,target.morning).map(u=>u.id), evening};
      }
    }

    S.schedule=schedule;
    if(failures.length) alert('⚠ Restricciones de tarde no cumplibles en alguna semana:\n\n'+failures.join('\n'));
  }

  function daysToRender(){
    if(S.view==='week'){
      const ws=weekStart(iso(S.date));
      return range(ws,weekEnd(ws));
    }
    const y=S.date.getFullYear(), m=S.date.getMonth();
    const start=monthStart(y,m);
    return Array.from({length:42},(_,i)=>iso(addDays(start,i)));
  }

  function renderCalendar(){
    const y=S.date.getFullYear(), m=S.date.getMonth();
    $('#monthTitle').textContent = S.view==='week' ? `SEMANA DE ${weekStart(iso(S.date))}` : new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'}).toUpperCase();
    const cal=$('#calendar');
    cal.className=`calendar ${S.view==='week'?'week':''}`;
    cal.innerHTML='';
    ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>cal.insertAdjacentHTML('beforeend',`<div class="dow">${d}</div>`));

    for(const day of daysToRender()){
      const d=parseISO(day);
      const sc=S.schedule[day]||{morning:[],evening:[]};
      const h=holiday(day);
      const vac=vacUsers(day);
      const ev=evalDay(day);

      const div=document.createElement('div');
      div.className=`day ${S.view==='month'&&d.getMonth()!==m?'out ':''}${hType(day)} ${isWeekend(day)?'weekend ':''}${vac.length?'hasVacation ':''}${ev.issues.length?'issue':''}`;

      const mn=(sc.morning||[]).map(nameOf).join(', ');
      const tn=(sc.evening||[]).map(nameOf).join(', ');
      const vn=vac.map(u=>u.name).join(', ');

      div.innerHTML=`${ev.issues.length?'<span class="issueDot">!</span>':''}
        <div class="dayHeader"><span class="daynum">${d.getDate()}</span>${h?`<span class="holidayInline" title="${h.name}">${h.name}</span>`:''}</div>
        ${vac.length?`<div class="vacTag" title="${vn}">Vacaciones: ${vn}</div>`:''}
        ${(sc.morning||[]).length?`<div class="shift" title="${mn}">M | ${mn}</div>`:''}
        ${(sc.evening||[]).length?`<div class="shift evening" title="${tn}">T | ${tn}</div>`:''}
        ${vac.length?`<span class="vacCount" title="${vn}">V=${vac.length}</span>`:''}
        <span class="counts"><span class="count countM" title="${mn}">M=${(sc.morning||[]).length}</span><span class="count countT" title="${tn}">T=${(sc.evening||[]).length}</span></span>
      `;

      div.onclick=()=>openDay(day);
      cal.appendChild(div);
    }
  }

  function openDay(day){
    $('#dayTitle').textContent=day;
    $('#dayMeta').textContent=`Mínimo alerta: ${minCov(day).morning}/${minCov(day).evening} · Objetivo: ${genCov(day).morning}/${genCov(day).evening}`;
    $('#dayWarnings').innerHTML=evalDay(day).issues.map(i=>`<div class="warn">${i.message}</div>`).join('');

    const sc=S.schedule[day]||{morning:[],evening:[]};
    fillChecks('#morningChecks', sc.morning);
    fillChecks('#eveningChecks', sc.evening);

    $('#saveDay').onclick=e=>{
      e.preventDefault();
      if(!S.admin) return;
      S.schedule[day]={
        morning: selected('#morningChecks'),
        evening: selected('#eveningChecks')
      };
      $('#dayDialog').close();
      render();
    };

    $('#dayDialog').showModal();
  }

  function fillChecks(container, selectedIds){
    $(container).innerHTML=S.users.map(u=>{
      const checked=selectedIds.includes(u.id)?'checked':'';
      const disabled=!S.admin?'disabled':'';
      return `<label class="check"><input type="checkbox" value="${u.id}" ${checked} ${disabled}> ${u.name}</label>`;
    }).join('');
  }

  function selected(container){
    return Array.from(document.querySelectorAll(`${container} input:checked`)).map(x=>x.value);
  }

  function renderTeamList(){
    $('#teamList').innerHTML=S.users.map(u=>`<div class="person"><span>${u.name}</span><span class="badge">${u.role}</span></div>`).join('');
  }

  function renderLegend(){
    const c=S.config.colors;
    $('#legend').innerHTML=`
      <div class="legendItem"><span class="swatch" style="background:${c.global_closed}"></span>Cierre global</div>
      <div class="legendItem"><span class="swatch" style="background:${c.national}"></span>Festivo nacional</div>
      <div class="legendItem"><span class="swatch" style="background:${c.regional}"></span>Festivo Comunidad Valenciana</div>
      <div class="legendItem"><span class="swatch" style="background:${c.local}"></span>Festivo local Alicante</div>
      <div class="legendItem"><span class="swatch" style="background:${c.madrid_volume}"></span>Madrid (impacto volumen)</div>
      <div class="legendItem"><span class="swatch" style="background:${c.vacation}"></span>Vacaciones</div>
    `;
  }

  function renderRules(){
    $('#rulesList').innerHTML=`
      <li>Generación normal: 6/2</li>
      <li>Alerta normal si baja de: 4/2</li>
      <li>Festivo legal: nacional/CV/Alicante</li>
      <li>Madrid: impacto volumen (no festivo legal)</li>
      <li>Tarde: prohibido 2 semanas seguidas; prohibido 3 semanas en el mes</li>
    `;
  }

  function render(){
    if(!S.config) return;

    $('#appName').textContent=S.config.appName;
    $('#modeBox').textContent=S.admin?'Modo administrador':'Modo lectura';
    $('#modeBox').className=`mode ${S.admin?'admin':'readonly'}`;

    $$('.adminOnly').forEach(x=>x.classList.toggle('hidden',!S.admin));
    $('#btnUnlock').classList.toggle('hidden',S.admin);
    $('#viewMonth').classList.toggle('active',S.view==='month');
    $('#viewWeek').classList.toggle('active',S.view==='week');

    renderTeamList();
    renderLegend();
    renderRules();

    renderCalendar();

    // quality + alerts for current month
    const y=S.date.getFullYear(), m=S.date.getMonth();
    const monthDays=range(iso(new Date(y,m,1)), iso(new Date(y,m+1,0)));
    const issues=[];
    monthDays.forEach(d=>issues.push(...evalDay(d).issues));
    $('#qualityBox').textContent=issues.length?`${issues.length} incidencias`:'Sin incidencias';
    $('#alerts').innerHTML=issues.slice(0,10).map(i=>`<div class="alert"><b>${i.date}</b> - ${i.message}</div>`).join('');
  }

  function showReport(){
    const y=S.date.getFullYear(), m=S.date.getMonth();
    $('#repMonth').classList.toggle('active',S.repMode==='month');
    $('#repYear').classList.toggle('active',S.repMode==='year');

    const rows=S.repMode==='year' ? reportYear(y) : reportMonth(y,m);
    S.lastReport=rows;

    $('#reportMeta').textContent=S.repMode==='year'?`Total anual ${y}`:new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});

    $('#reportContent').innerHTML=`
      <table class="table">
        <tr>
          <th>Persona</th><th>Días mañana</th><th>Horas mañana</th><th>Días tarde</th><th>Horas tarde</th>
          <th>Días festivo legal</th><th>Horas festivo legal</th><th>Días impacto Madrid</th><th>Horas impacto Madrid</th><th>Total</th>
        </tr>
        ${rows.map(r=>`<tr><td>${r.name}</td><td>${r.morningDays}</td><td>${r.morningHours}</td><td>${r.eveningDays}</td><td>${r.eveningHours}</td><td>${r.legalHolidayDays}</td><td>${r.legalHolidayHours}</td><td>${r.impactHolidayDays}</td><td>${r.impactHolidayHours}</td><td><b>${r.totalHours}</b></td></tr>`).join('')}
      </table>
    `;

    $('#reportDialog').showModal();
  }

  function downloadCsv(){
    const head='Persona;Dias manana;Horas manana;Dias tarde;Horas tarde;Dias festivo legal;Horas festivo legal;Dias impacto Madrid;Horas impacto Madrid;Total';
    const lines=S.lastReport.map(r=>`${r.name};${r.morningDays};${r.morningHours};${r.eveningDays};${r.eveningHours};${r.legalHolidayDays};${r.legalHolidayHours};${r.impactHolidayDays};${r.impactHolidayHours};${r.totalHours}`);
    const csv=[head,...lines].join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=S.repMode==='year'?`reporte-anual-${S.date.getFullYear()}.csv`:`reporte-mes-${S.date.getFullYear()}-${String(S.date.getMonth()+1).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openVacations(){
    $('#vacUser').innerHTML=S.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
    syncVacTotal();
    renderVacationList();
    $('#vacDialog').showModal();
  }

  function syncVacTotal(){
    const user=S.users.find(u=>u.id===$('#vacUser').value);
    $('#vacTotal').value = user?.vacation?.total ?? 0;
  }

  function renderVacationList(){
    const html=S.users.map(u=>{
      const remaining=Math.max(0,(u.vacation?.total||0) - vacationUsedDays(u));
      const items=(u.timeOff||[]).filter(x=>x.type==='vacation').map((v,i)=>{
        return `<div class="person"><span>${v.start} → ${v.end}${v.notes?` · ${v.notes}`:''}</span><button type="button" class="btn" style="width:auto;padding:4px 8px" data-del="${u.id}:${i}">Borrar</button></div>`;
      }).join('') || '<p>Sin vacaciones</p>';
      return `<h4>${u.name} <span class="badge">restantes ${remaining}</span></h4>${items}`;
    }).join('');

    $('#vacList').innerHTML=html;

    $$('[data-del]').forEach(btn=>{
      btn.onclick=()=>{
        const [uid,idx]=btn.dataset.del.split(':');
        const user=S.users.find(u=>u.id===uid);
        user.timeOff.splice(Number(idx),1);
        renderVacationList();
        render();
      };
    });
  }

  function vacationUsedDays(user){
    let total=0;
    (user.timeOff||[]).filter(x=>x.type==='vacation').forEach(v=>{
      total += Math.floor((parseISO(v.end)-parseISO(v.start))/86400000)+1;
    });
    return total;
  }

  function bind(){
    $('#prev').onclick=()=>{ S.view==='week' ? (S.date=addDays(S.date,-7)) : S.date.setMonth(S.date.getMonth()-1); render(); };
    $('#next').onclick=()=>{ S.view==='week' ? (S.date=addDays(S.date,7)) : S.date.setMonth(S.date.getMonth()+1); render(); };
    $('#today').onclick=()=>{ S.date=new Date(); render(); };
    $('#viewMonth').onclick=()=>{ S.view='month'; render(); };
    $('#viewWeek').onclick=()=>{ S.view='week'; render(); };

    $('#btnUnlock').onclick=()=>{ $('#adminPassword').value=''; $('#adminDialog').showModal(); setTimeout(()=>$('#adminPassword').focus(),0); };
    $('#btnLock').onclick=()=>{ S.admin=false; $('#adminPassword').value=''; render(); };
    $('#doUnlock').onclick=async e=>{
      e.preventDefault();
      const p=$('#adminPassword').value;
      $('#adminPassword').value='';
      if(await sha256(p)===S.config.adminPasswordHash){
        S.admin=true;
        $('#adminDialog').close();
        render();
      } else alert('Contraseña incorrecta');
    };

    $('#btnVacations').onclick=openVacations;
    $('#vacUser').onchange=()=>{ syncVacTotal(); };

    $('#saveVacTotal').onclick=e=>{
      e.preventDefault();
      const user=S.users.find(u=>u.id===$('#vacUser').value);
      user.vacation=user.vacation||{};
      user.vacation.total=Math.max(0,Number($('#vacTotal').value||0));
      renderVacationList();
      render();
    };

    $('#addVacation').onclick=e=>{
      e.preventDefault();
      const user=S.users.find(u=>u.id===$('#vacUser').value);
      const a=$('#vacFrom').value;
      const b=$('#vacTo').value;
      if(!a||!b||b<a) return alert('Revisa el rango.');
      const warnings=vacationWarnings(user,a,b);
      if(warnings.length && !confirm('Aviso:\n\n'+warnings.join('\n')+'\n\n¿Continuar igualmente?')) return;
      user.timeOff=user.timeOff||[];
      user.timeOff.push({type:'vacation',start:a,end:b,notes:$('#vacNotes').value||''});
      $('#vacFrom').value=''; $('#vacTo').value=''; $('#vacNotes').value='';
      renderVacationList();
      render();
    };

    $('#btnAuto').onclick=()=>{
      const y=S.date.getFullYear(), m=S.date.getMonth();
      $('#autoFrom').value=iso(new Date(y,m,1));
      $('#autoTo').value=iso(new Date(y,m+1,0));
      $('#autoDialog').showModal();
    };

    $('#runAuto').onclick=e=>{
      e.preventDefault();
      const a=$('#autoFrom').value;
      const b=$('#autoTo').value;
      if(!a||!b||b<a) return alert('Rango no válido');
      generateBetween(a,b,$('#overwrite').checked);
      $('#autoDialog').close();
      render();
    };

    $('#btnReport').onclick=()=>{ S.repMode='year'; showReport(); };
    $('#repMonth').onclick=()=>{ S.repMode='month'; showReport(); };
    $('#repYear').onclick=()=>{ S.repMode='year'; showReport(); };
    $('#downloadReport').onclick=e=>{ e.preventDefault(); downloadCsv(); };

    $('#btnExport').onclick=()=>{
      const download=(name,obj)=>{
        const a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
        a.download=name;
        a.click();
        URL.revokeObjectURL(a.href);
      };
      download('schedule.json', S.schedule);
      download('users.json', S.users);
      download('holidays.json', S.holidays);
      download('config.json', S.config);
    };

    $$('[data-close]').forEach(b=>b.onclick=()=>{ const d=document.getElementById(b.dataset.close); if(d?.id==='adminDialog') $('#adminPassword').value=''; d?.close(); });
  }

  async function loadAll(){
    const [users,config,holidays,schedule] = await Promise.all(['users','config','holidays','schedule'].map(loadJson));
    Object.assign(S,{users,config,holidays,schedule,holidayMap:new Map(holidays.map(h=>[h.date,h]))});
  }

  loadAll().then(()=>{ bind(); render(); }).catch(err=>{
    console.error(err);
    document.querySelector('.main').innerHTML=`<div style="margin:24px;padding:16px;background:#fff1f2;border:2px solid #ef3340;border-radius:10px"><h2>Error cargando la app</h2><p>${err.message||err}</p></div>`;
  });

})();
