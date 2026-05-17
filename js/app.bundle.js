(()=>{
"use strict";
const S={users:[],config:null,holidays:[],holidayMap:new Map(),schedule:{},date:new Date(),admin:false,view:"month",repMode:"year",lastReport:[]};
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parseISO=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const dow=s=>{const d=parseISO(s).getDay();return d===0?7:d};
const monthStart=(y,m)=>{const f=new Date(y,m,1);const off=(f.getDay()+6)%7;return new Date(y,m,1-off)};
const range=(a,b)=>{const out=[];for(let d=parseISO(a);d<=parseISO(b);d.setDate(d.getDate()+1))out.push(iso(d));return out};
async function sha256(t){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function loadJson(n){const r=await fetch(`data/${n}.json`,{cache:'no-store'});if(!r.ok)throw new Error(`No carga data/${n}.json (${r.status})`);return r.json()}
async function load(){const [users,config,holidays,schedule]=await Promise.all(['users','config','holidays','schedule'].map(loadJson));Object.assign(S,{users,config,holidays,schedule,holidayMap:new Map(holidays.map(h=>[h.date,h]))})}

const isWeekend=day=>[6,7].includes(dow(day));
const isWorkday=day=>S.config.rules.workdays.includes(dow(day));
const holiday=day=>S.holidayMap.get(day);
const hType=day=>holiday(day)?.type||'standard';
const isLegalHoliday=day=>['national','regional','local'].includes(hType(day)) && holiday(day)?.countsAsLegalHoliday!==false;
const isImpactHoliday=day=>hType(day)==='madrid_volume' || (holiday(day)?.countsAsLegalHoliday===false && hType(day)!=='global_closed');
const minCov=day=>S.config.rules.coverageByDayType[hType(day)]||S.config.rules.coverageByDayType.standard;
const genCov=day=>S.config.rules.generationByDayType[hType(day)]||S.config.rules.generationByDayType.standard;
const name=id=>S.users.find(u=>u.id===id)?.name||id;
const role=id=>S.users.find(u=>u.id===id)?.role||'standard';
const isUnav=(u,day)=>(u.timeOff||[]).some(x=>x.type==='vacation'&&day>=x.start&&day<=x.end);
const unavId=(id,day)=>{const u=S.users.find(x=>x.id===id);return u?isUnav(u,day):false};
const vacUsers=day=>S.users.filter(u=>isUnav(u,day));
function vacDays(u){let n=0;(u.timeOff||[]).filter(x=>x.type==='vacation').forEach(v=>range(v.start,v.end).forEach(day=>{if(!S.holidayMap.has(day))n++}));return n}

function weekStart(day){const d=parseISO(day);const off=(d.getDay()+6)%7;return iso(addDays(d,-off))}
function weekEnd(ws){return iso(addDays(parseISO(ws),6))}
function weeksTouched(a,b){return [...new Set(range(a,b).map(weekStart))]}
function peopleOffInWeek(ws,extraId,a,b){const we=weekEnd(ws), set=new Set();S.users.forEach(u=>(u.timeOff||[]).filter(x=>x.type==='vacation').forEach(v=>{if(v.start<=we&&v.end>=ws)set.add(u.id)}));if(extraId&&a<=we&&b>=ws)set.add(extraId);return [...set]}
function vacationWarnings(u,a,b){const w=[];if(a>=S.config.serviceStartDate){const days=Math.floor((parseISO(b)-parseISO(a))/86400000)+1;if(days<7)w.push(`A partir del ${S.config.serviceStartDate}: mínimo recomendado 7 días.`);if(dow(a)!==1||dow(b)!==7)w.push(`A partir del ${S.config.serviceStartDate}: recomendado lunes→domingo.`)}for(const ws of weeksTouched(a,b)){const p=peopleOffInWeek(ws,u.id,a,b);if(p.length>S.config.rules.maxPeopleOffPerWeek)w.push(`Semana ${ws}→${weekEnd(ws)}: ${p.length} fuera (${p.map(name).join(', ')}).`)}return w}

function evalDay(day){const issues=[];if(!isWorkday(day))return{issues};const target=minCov(day),sc=S.schedule[day]||{morning:[],evening:[]};if(hType(day)==='global_closed'){if((sc.morning||[]).length||(sc.evening||[]).length)issues.push({date:day,message:'Cierre global con turnos asignados'});return{issues}}const m=(sc.morning||[]).filter(id=>!unavId(id,day)),e=(sc.evening||[]).filter(id=>!unavId(id,day));if(m.length<target.morning)issues.push({date:day,message:`Mañana sin cobertura: ${m.length}/${target.morning}`});if(e.length<target.evening)issues.push({date:day,message:`Tarde sin cobertura: ${e.length}/${target.evening}`});const both=m.filter(id=>e.includes(id));if(both.length)issues.push({date:day,message:`En ambos turnos: ${both.map(name).join(', ')}`});const sen=e.filter(id=>role(id)==='senior').length,std=e.filter(id=>role(id)!=='senior').length;if(target.evening===2&&e.length>0&&(sen!==1||std!==1))issues.push({date:day,message:'Tarde debe tener 1 senior + 1 estándar'});return{issues}}

function reportRange(from,to,schedule=S.schedule){const rows=S.users.map(u=>({id:u.id,name:u.name,morningDays:0,eveningDays:0,morningHours:0,eveningHours:0,legalHolidayDays:0,legalHolidayHours:0,impactHolidayDays:0,impactHolidayHours:0,totalHours:0}));const map=new Map(rows.map(r=>[r.id,r]));for(const day of range(from,to)){const sc=schedule[day]||{morning:[],evening:[]};if(!isWorkday(day))continue;for(const id of sc.morning||[]){const r=map.get(id);if(!r)continue;r.morningDays++;r.morningHours+=S.config.rules.shiftHours.morning;r.totalHours+=S.config.rules.shiftHours.morning;if(isLegalHoliday(day)){r.legalHolidayDays++;r.legalHolidayHours+=S.config.rules.shiftHours.morning}else if(isImpactHoliday(day)){r.impactHolidayDays++;r.impactHolidayHours+=S.config.rules.shiftHours.morning}}for(const id of sc.evening||[]){const r=map.get(id);if(!r)continue;r.eveningDays++;r.eveningHours+=S.config.rules.shiftHours.evening;r.totalHours+=S.config.rules.shiftHours.evening;if(isLegalHoliday(day)){r.legalHolidayDays++;r.legalHolidayHours+=S.config.rules.shiftHours.evening}else if(isImpactHoliday(day)){r.impactHolidayDays++;r.impactHolidayHours+=S.config.rules.shiftHours.evening}}}return rows}
function reportMonth(y,m){return reportRange(iso(new Date(y,m,1)),iso(new Date(y,m+1,0)))}
function reportYear(y){return reportRange(`${y}-01-01`,`${y}-12-31`)}

function weekEveningUsers(ws,schedule){const out=new Set();for(const day of range(ws,weekEnd(ws))){(schedule[day]?.evening||[]).forEach(id=>out.add(id))}return out}
function choosePair(day,avail,schedule){const y=parseISO(day).getFullYear();const ws=weekStart(day),prev=weekEveningUsers(iso(addDays(parseISO(ws),-7)),schedule);const yRep=reportYear(y);const mRep=reportMonth(y,parseISO(day).getMonth());const score=id=>{const yr=yRep.find(r=>r.id===id)||{};const mr=mRep.find(r=>r.id===id)||{};let s=0;s+=(yr.eveningDays||0)*200; // anual domina
 s+=(mr.eveningDays||0)*60;
 s+=(yr.legalHolidayHours||0)*25;
 s+=(mr.legalHolidayHours||0)*40;
 if(prev.has(id)&&S.config.rules.avoidConsecutiveEveningWeeks)s+=10000;
 return s};
const seniors=avail.filter(u=>u.role==='senior').sort((a,b)=>score(a.id)-score(b.id));
const std=avail.filter(u=>u.role!=='senior').sort((a,b)=>score(a.id)-score(b.id));
let cand=[];seniors.forEach(s=>std.forEach(t=>cand.push([s.id,t.id])));
if(!cand.length)return avail.sort((a,b)=>score(a.id)-score(b.id)).slice(0,genCov(day).evening).map(u=>u.id);
cand.sort((a,b)=>(score(a[0])+score(a[1]))-(score(b[0])+score(b[1])));
return cand[0]}

function generateBetween(a,b,overwrite){const ns=structuredClone(S.schedule||{});for(const ws of weeksTouched(a,b)){const days=range(ws,weekEnd(ws)).filter(d=>d>=a&&d<=b&&isWorkday(d));if(!days.length)continue;const sample=days.find(d=>hType(d)!=='global_closed')||days[0];const availWeek=S.users.filter(u=>days.some(d=>!isUnav(u,d)));const evening=choosePair(sample,availWeek,ns);for(const day of days){if(!overwrite&&ns[day]&&((ns[day].morning||[]).length||(ns[day].evening||[]).length))continue;if(hType(day)==='global_closed'){ns[day]={morning:[],evening:[]};continue}const avDay=S.users.filter(u=>!isUnav(u,day));const y=parseISO(day).getFullYear();const m=parseISO(day).getMonth();const rep=reportMonth(y,m);const scoreM=id=>{const r=rep.find(x=>x.id===id)||{};return (r.morningDays||0)+(isLegalHoliday(day)?(r.legalHolidayHours||0)*10:0)};const ev=evening.filter(id=>avDay.some(u=>u.id===id));const rest=avDay.filter(u=>!ev.includes(u.id)).sort((x,y)=>scoreM(x.id)-scoreM(y.id));ns[day]={morning:rest.slice(0,genCov(day).morning).map(u=>u.id),evening:ev};}}S.schedule=ns}

function daysToRender(){if(S.view==='week'){const ws=weekStart(iso(S.date));return range(ws,weekEnd(ws))}const y=S.date.getFullYear(),m=S.date.getMonth(),start=monthStart(y,m);return Array.from({length:42},(_,i)=>iso(addDays(start,i)))}
function renderCalendar(){const y=S.date.getFullYear(),m=S.date.getMonth();$('#monthTitle').textContent=S.view==='week'?`SEMANA DE ${weekStart(iso(S.date))}`:new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'}).toUpperCase();const cal=$('#calendar');cal.className=`calendar ${S.view==='week'?'week':''}`;cal.innerHTML='';['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>cal.insertAdjacentHTML('beforeend',`<div class="dow">${d}</div>`));for(const day of daysToRender()){const d=parseISO(day),sc=S.schedule[day]||{morning:[],evening:[]},h=holiday(day),vac=vacUsers(day),ev=evalDay(day);const div=document.createElement('div');div.className=`day ${S.view==='month'&&d.getMonth()!==m?'out ':''}${hType(day)} ${isWeekend(day)?'weekend ':''}${vac.length?'hasVacation ':''}${ev.issues.length?'issue':''}`;const mn=(sc.morning||[]).map(name).join(', '),tn=(sc.evening||[]).map(name).join(', '),vn=vac.map(u=>u.name).join(', ');div.innerHTML=`${ev.issues.length?'<span class="issueDot">!</span>':''}<div class="dayHeader"><span class="daynum">${d.getDate()}</span>${h?`<span class="holidayInline" title="${h.name}">${h.name}</span>`:''}</div>${vac.length?`<div class="vacTag" title="${vn}">Vacaciones: ${vn}</div>`:''}${shiftLine('morning',sc.morning,mn)}${shiftLine('evening',sc.evening,tn)}${vac.length?`<span class="vacCount" title="${vn}">V=${vac.length}</span>`:''}<span class="counts"><span class="count countM" title="${mn}">M=${(sc.morning||[]).length}</span><span class="count countT" title="${tn}">T=${(sc.evening||[]).length}</span></span>`;div.onclick=()=>{};cal.appendChild(div)}}
function shiftLine(k,ids=[],names=''){return ids.length?`<div class="shift ${k==='evening'?'evening':''}" title="${names}">${k==='morning'?'M':'T'} | ${ids.map(name).join(', ')}</div>`:''}

function renderSidebar(){const c=S.config.colors;$('#teamList').innerHTML=S.users.map(u=>`<div class="person"><span>${u.name}</span><span class="pill">${Math.max(0,(u.vacation?.total||0)-vacDays(u))}d</span></div>`).join('');$('#legend').innerHTML=`<div class="legendItem"><span class="swatch" style="background:${c.global_closed}"></span>Cierre global</div><div class="legendItem"><span class="swatch" style="background:${c.national}"></span>Festivo nacional</div><div class="legendItem"><span class="swatch" style="background:${c.regional}"></span>Festivo Comunidad Valenciana</div><div class="legendItem"><span class="swatch" style="background:${c.local}"></span>Festivo local Alicante</div><div class="legendItem"><span class="swatch" style="background:${c.madrid_volume}"></span>Madrid (impacto volumen)</div><div class="legendItem"><span class="swatch" style="background:${c.vacation}"></span>Vacaciones</div>`;$('#rulesList').innerHTML=`<li>El generador usa histórico anual para equilibrar tardes y festivos legales</li><li>Reporte anual disponible (Año)</li>`}

function render(){if(!S.config)return;$('#appName').textContent=S.config.appName;$('#modeBox').textContent=S.admin?'Modo administrador':'Modo lectura';$('#modeBox').className=`mode ${S.admin?'admin':'readonly'}`;$$('.adminOnly').forEach(x=>x.classList.toggle('hidden',!S.admin));$('#btnUnlock').classList.toggle('hidden',S.admin);$('#viewMonth').classList.toggle('active',S.view==='month');$('#viewWeek').classList.toggle('active',S.view==='week');renderSidebar();renderCalendar();const evs=[];for(const day of range(iso(new Date(S.date.getFullYear(),S.date.getMonth(),1)),iso(new Date(S.date.getFullYear(),S.date.getMonth()+1,0))))evs.push(...evalDay(day).issues);$('#qualityBox').textContent=evs.length?`${evs.length} incidencias`:'Sin incidencias';$('#alerts').innerHTML=evs.slice(0,10).map(i=>`<div class="alert"><b>${i.date}</b> - ${i.message}</div>`).join('')}

function showReport(){const y=S.date.getFullYear(),m=S.date.getMonth();S.repMode=S.repMode||'year';$('#repMonth').classList.toggle('active',S.repMode==='month');$('#repYear').classList.toggle('active',S.repMode==='year');const rows=S.repMode==='year'?reportYear(y):reportMonth(y,m);S.lastReport=rows;$('#reportMeta').textContent=S.repMode==='year'?`Total anual ${y} (usa todo el histórico del año en schedule.json)`:new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});$('#reportContent').innerHTML=`<table class="table"><tr><th>Persona</th><th>Días mañana</th><th>Horas mañana</th><th>Días tarde</th><th>Horas tarde</th><th>Días festivo legal</th><th>Horas festivo legal</th><th>Días impacto Madrid</th><th>Horas impacto Madrid</th><th>Total</th></tr>${rows.map(r=>`<tr><td>${r.name}</td><td>${r.morningDays}</td><td>${r.morningHours}</td><td>${r.eveningDays}</td><td>${r.eveningHours}</td><td>${r.legalHolidayDays}</td><td>${r.legalHolidayHours}</td><td>${r.impactHolidayDays}</td><td>${r.impactHolidayHours}</td><td><b>${r.totalHours}</b></td></tr>`).join('')}</table>`;$('#reportDialog').showModal()}

function downloadCsv(){const head='Persona;Dias manana;Horas manana;Dias tarde;Horas tarde;Dias festivo legal;Horas festivo legal;Dias impacto Madrid;Horas impacto Madrid;Total';const lines=S.lastReport.map(r=>`${r.name};${r.morningDays};${r.morningHours};${r.eveningDays};${r.eveningHours};${r.legalHolidayDays};${r.legalHolidayHours};${r.impactHolidayDays};${r.impactHolidayHours};${r.totalHours}`);const csv=[head,...lines].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=S.repMode==='year'?`reporte-anual-${S.date.getFullYear()}.csv`:`reporte-mes-${S.date.getFullYear()}-${String(S.date.getMonth()+1).padStart(2,'0')}.csv`;a.click();URL.revokeObjectURL(a.href)}

function bind(){
$('#prev').onclick=()=>{S.view==='week'?S.date=addDays(S.date,-7):S.date.setMonth(S.date.getMonth()-1);render()};
$('#next').onclick=()=>{S.view==='week'?S.date=addDays(S.date,7):S.date.setMonth(S.date.getMonth()+1);render()};
$('#today').onclick=()=>{S.date=new Date();render()};
$('#viewMonth').onclick=()=>{S.view='month';render()};
$('#viewWeek').onclick=()=>{S.view='week';render()};
$('#btnUnlock').onclick=()=>{$('#adminPassword').value='';$('#adminDialog').showModal();setTimeout(()=>$('#adminPassword').focus(),0)};
$('#btnLock').onclick=()=>{S.admin=false;$('#adminPassword').value='';render()};
$('#doUnlock').onclick=async e=>{e.preventDefault();const p=$('#adminPassword').value;$('#adminPassword').value='';if(await sha256(p)===S.config.adminPasswordHash){S.admin=true;$('#adminDialog').close();render()}else alert('Contraseña incorrecta')};
$('#btnVacations').onclick=()=>{$('#vacUser').innerHTML=S.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');syncVac();renderVac();$('#vacDialog').showModal()};
function syncVac(){const u=S.users.find(x=>x.id===$('#vacUser').value);$('#vacTotal').value=u?.vacation?.total??0}
$('#vacUser').onchange=syncVac;
$('#saveVacTotal').onclick=e=>{e.preventDefault();const u=S.users.find(x=>x.id===$('#vacUser').value);if(u){u.vacation=u.vacation||{};u.vacation.total=Math.max(0,Number($('#vacTotal').value||0));render();renderVac()}};
function renderVac(){ $('#vacList').innerHTML=S.users.map(u=>`<h4>${u.name} (${Math.max(0,(u.vacation?.total||0)-vacDays(u))} días restantes)</h4>${(u.timeOff||[]).map((v,i)=>`<div class="person"><span>${v.start} → ${v.end}${v.notes?' · '+v.notes:''}</span><button type="button" data-u="${u.id}" data-i="${i}" class="delVac">Borrar</button></div>`).join('')||'<p>Sin vacaciones</p>'}`).join(''); $$('.delVac').forEach(b=>b.onclick=()=>{const u=S.users.find(x=>x.id===b.dataset.u);u.timeOff.splice(Number(b.dataset.i),1);renderVac();render()}) }
$('#addVacation').onclick=e=>{e.preventDefault();const u=S.users.find(x=>x.id===$('#vacUser').value),a=$('#vacFrom').value,b=$('#vacTo').value;if(!u||!a||!b||b<a)return alert('Revisa el rango.');const w=vacationWarnings(u,a,b);if(w.length&&!confirm('Aviso:\n\n'+w.join('\n')+'\n\n¿Continuar igualmente?'))return;u.timeOff=u.timeOff||[];u.timeOff.push({type:'vacation',start:a,end:b,notes:$('#vacNotes').value||''});$('#vacFrom').value='';$('#vacTo').value='';$('#vacNotes').value='';renderVac();render()};
$('#btnAuto').onclick=()=>{const y=S.date.getFullYear(),m=S.date.getMonth();$('#autoFrom').value=iso(new Date(y,m,1));$('#autoTo').value=iso(new Date(y,m+1,0));$('#autoDialog').showModal()};
$('#runAuto').onclick=e=>{e.preventDefault();const a=$('#autoFrom').value,b=$('#autoTo').value;if(!a||!b||b<a)return alert('Rango no válido');generateBetween(a,b,$('#overwrite').checked);$('#autoDialog').close();render()};
$('#btnReport').onclick=()=>{S.repMode='year';showReport()};
$('#repMonth').onclick=()=>{S.repMode='month';showReport()};
$('#repYear').onclick=()=>{S.repMode='year';showReport()};
$('#downloadReport').onclick=e=>{e.preventDefault();downloadCsv()};
$$('[data-close]').forEach(b=>b.onclick=()=>{const d=document.getElementById(b.dataset.close);if(d?.id==='adminDialog')$('#adminPassword').value='';d?.close()});
}

load().then(()=>{bind();render()}).catch(err=>{console.error(err);$('.main').innerHTML=`<div style="margin:24px;padding:16px;background:#fff1f2;border:2px solid #ef3340;border-radius:10px"><h2>Error cargando la app</h2><p>${err.message||err}</p></div>`});
})();