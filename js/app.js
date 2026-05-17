import { sha256, iso, parseISO, monthStartGrid, monthName, download, readJsonFile, workdaysBetween } from './utils.js';
import { evaluateMonth, evaluateDay } from './rules.js';
import { generateMonthSchedule } from './scheduler.js';
import { commitJsonFiles } from './github.js';

const state={users:[],config:null,shifts:null,holidays:[],holidayMap:new Map(),schedule:{},date:new Date(),admin:false,dirty:false};
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));

async function load(){
  const [users,config,shifts,holidays,schedule]=await Promise.all([
    fetch('data/users.json',{cache:'no-store'}).then(r=>r.json()),
    fetch('data/config.json',{cache:'no-store'}).then(r=>r.json()),
    fetch('data/shifts.json',{cache:'no-store'}).then(r=>r.json()),
    fetch('data/holidays.json',{cache:'no-store'}).then(r=>r.json()),
    fetch('data/schedule.json',{cache:'no-store'}).then(r=>r.json())
  ]);
  Object.assign(state,{users,config,shifts,holidays,schedule,holidayMap:new Map(holidays.map(h=>[h.date,h]))});
}

function render(){
  $('#appName').textContent=state.config.appName;
  renderTeam(); renderRules(); renderCalendar(); renderQuality(); toggleAdminUI();
}
function toggleAdminUI(){
  $('#modeBox').textContent=state.admin?'Modo edición':'Modo lectura';
  $('#modeBox').className='mode '+(state.admin?'admin':'readonly');
  $$('.admin-only').forEach(e=>e.disabled=!state.admin);
}
function renderTeam(){
  $('#teamList').innerHTML=state.users.map(u=>`<div class="person"><span>${u.name}</span><span class="pill">${vacRemaining(u)}d</span></div>`).join('');
}
function vacRemaining(u){return (u.vacation?.total??0)-usedVacationDays(u)}
function usedVacationDays(u){let n=0;(u.timeOff||[]).filter(x=>x.type==='vacation').forEach(x=>{n+=workdaysBetween(x.start,x.end,state.config.rules.workdays,state.holidayMap)});return n}
function renderRules(){
  const r=state.config.rules;
  $('#rulesList').innerHTML=`<li>3 sem. Mañana / 1 sem. Tarde</li><li>Mañana: mín. ${r.coverage.morning}</li><li>Tarde: mín. ${r.coverage.evening}</li><li>Tarde: 1 perfil senior + 1 estándar</li><li>No editar salvo modo administrador</li>`;
}
function renderCalendar(){
  const y=state.date.getFullYear(), m=state.date.getMonth();
  $('#monthTitle').textContent=monthName(y,m).toUpperCase();
  const cal=$('#calendar'); cal.innerHTML='';
  ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>cal.insertAdjacentHTML('beforeend',`<div class="dow">${d}</div>`));
  const start=monthStartGrid(y,m);
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const day=iso(d); const inMonth=d.getMonth()===m;
    const ev=evaluateDay(day,state);
    const hol=state.holidayMap.get(day);
    const item=document.createElement('div'); item.className='day '+(!inMonth?'out ':'')+(ev.issues.length?'issue ':''); item.dataset.day=day;
    const s=state.schedule[day]||{morning:[],evening:[]};
    item.innerHTML=`${ev.issues.length?'<span class="issue-dot">!</span>':''}<div class="daynum">${d.getDate()}</div>${hol?`<div class="holiday">${hol.name}</div>`:''}${shiftLine('morning',s.morning)}${shiftLine('evening',s.evening)}`;
    item.onclick=()=>openDay(day);
    cal.appendChild(item);
  }
}
function shiftLine(kind, ids=[]){ if(!ids.length) return ''; return `<div class="shift ${kind}">${kind==='morning'?'M':'T'} | ${ids.map(nameOf).join(', ')}</div>`; }
function nameOf(id){return state.users.find(u=>u.id===id)?.name||id}
function renderQuality(){
  const ev=evaluateMonth(state.date.getFullYear(),state.date.getMonth(),state);
  $('#qualityBox').innerHTML= ev.issues.length?`${ev.issues.length} incidencias detectadas`:'Sin incidencias en el mes visible';
  $('#alerts').innerHTML=ev.issues.slice(0,8).map(i=>`<div class="alert"><strong>${i.date}</strong> - ${i.message}</div>`).join('');
}
function openDay(day){
  const dlg=$('#dayDialog'); $('#dayTitle').textContent=day; $('#dayReadonlyHint').textContent=state.admin?'Puedes editar este día.':'Modo lectura: solo el administrador puede editar.';
  const s=state.schedule[day]||{morning:[],evening:[]}; const ev=evaluateDay(day,state);
  $('#dayWarnings').innerHTML=ev.issues.map(i=>`<div class="warning">${i.message}</div>`).join('');
  fillChecks('#morningChecks','morning',s.morning); fillChecks('#eveningChecks','evening',s.evening);
  $('#btnSaveDay').onclick=(e)=>{e.preventDefault(); if(!state.admin)return; state.schedule[day]={morning:selected('#morningChecks'),evening:selected('#eveningChecks')}; state.dirty=true; dlg.close(); render();};
  dlg.showModal();
}
function fillChecks(sel,shift,selectedIds){
  $(sel).innerHTML=state.users.map(u=>`<label class="check"><input type="checkbox" value="${u.id}" ${selectedIds.includes(u.id)?'checked':''} ${!state.admin?'disabled':''}>${u.name}</label>`).join('');
}
function selected(sel){return Array.from(document.querySelectorAll(sel+' input:checked')).map(x=>x.value)}

$('#prev').onclick=()=>{state.date.setMonth(state.date.getMonth()-1);render()};
$('#next').onclick=()=>{state.date.setMonth(state.date.getMonth()+1);render()};
$('#today').onclick=()=>{state.date=new Date();render()};
$('#btnAdmin').onclick=()=>$('#adminDialog').showModal();
$('#unlockAdmin').onclick=async(e)=>{e.preventDefault(); const pass=$('#adminPassword').value; if(!state.config.adminPasswordHash || state.config.adminPasswordHash==='REPLACE_WITH_SHA256_HASH'){alert('Configura primero adminPasswordHash en data/config.json');return} if(await sha256(pass)===state.config.adminPasswordHash){state.admin=true; $('#adminDialog').close(); render()} else alert('Contraseña incorrecta');};
$('#btnAuto').onclick=()=>$('#autoDialog').showModal();
$('#runAuto').onclick=(e)=>{e.preventDefault(); const overwrite=$('#overwriteMonth').checked; const result=generateMonthSchedule(state.date.getFullYear(),state.date.getMonth(),state,{overwrite}); state.schedule=result.schedule; state.dirty=true; $('#autoDialog').close(); render(); alert(`Generación finalizada. Incidencias: ${result.issues.length}`);};
$('#btnBulk').onclick=()=>{ $('#bulkUsers').innerHTML=state.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join(''); $('#bulkDialog').showModal();};
$('#runBulk').onclick=(e)=>{e.preventDefault(); const from=$('#bulkFrom').value,to=$('#bulkTo').value,sh=$('#bulkShift').value,ids=Array.from($('#bulkUsers').selectedOptions).map(o=>o.value); if(!from||!to||!ids.length)return alert('Completa rango y personas.'); for(let d=parseISO(from); d<=parseISO(to); d.setDate(d.getDate()+1)){const day=iso(d); if(!state.schedule[day])state.schedule[day]={morning:[],evening:[]}; state.schedule[day][sh]=Array.from(new Set([...(state.schedule[day][sh]||[]),...ids]));} state.dirty=true; $('#bulkDialog').close(); render();};
$('#btnExport').onclick=()=>{download('schedule.json',state.schedule); download('users.json',state.users)};
$('#btnGitHub').onclick=()=>$('#githubDialog').showModal();
$('#runGitHubSave').onclick=async(e)=>{e.preventDefault(); if(!state.admin)return; const token=$('#ghToken').value.trim(); if(!token)return alert('Introduce token.'); try{await commitJsonFiles({token,config:state.config.github,message:$('#commitMsg').value,files:{'data/schedule.json':state.schedule,'data/users.json':state.users}}); state.dirty=false; $('#githubDialog').close(); alert('Commit realizado en GitHub.');}catch(err){alert('Error guardando en GitHub: '+err.message)}};

load().then(render).catch(e=>{document.body.innerHTML='<pre>Error cargando datos: '+e.message+'</pre>'});
