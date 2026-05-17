import { isWorkday, isUnavailable } from './utils.js';
export function evaluateDay(day,state){
 const issues=[]; if(!isWorkday(day,state)) return {issues};
 const r=state.config.rules, hol=state.holidayMap.get(day), s=state.schedule[day]||{morning:[],evening:[]};
 let minM=r.coverage.morning, minE=r.coverage.evening;
 if(hol&&r.holidayCoverageRelaxation?.enabled){minM=Math.max(r.holidayCoverageRelaxation.minimum,minM-r.holidayCoverageRelaxation.morningMinus);minE=Math.max(r.holidayCoverageRelaxation.minimum,minE-r.holidayCoverageRelaxation.eveningMinus)}
 const effM=(s.morning||[]).filter(id=>!unav(id,day,state)); const effE=(s.evening||[]).filter(id=>!unav(id,day,state));
 if(effM.length<minM) issues.push({date:day,message:`Mañana sin cobertura mínima: ${effM.length}/${minM}`});
 if(effE.length<minE) issues.push({date:day,message:`Tarde sin cobertura mínima: ${effE.length}/${minE}`});
 const overlap=effM.filter(id=>effE.includes(id)); if(overlap.length) issues.push({date:day,message:`Persona en ambos turnos: ${overlap.map(id=>name(id,state)).join(', ')}`});
 const seniors=effE.filter(id=>role(id,state)==='senior').length, std=effE.filter(id=>role(id,state)!=='senior').length;
 if(effE.length>0&&(seniors<r.eveningPairing.seniorMin||seniors>r.eveningPairing.seniorMax||std<r.eveningPairing.standardMin)) issues.push({date:day,message:`Tarde debe tener 1 senior y 1 estándar`});
 [...(s.morning||[]),...(s.evening||[])].forEach(id=>{if(unav(id,day,state)) issues.push({date:day,message:`${name(id,state)} está asignado pero de vacaciones`})});
 return {issues};
}
export function evaluateMonth(y,m,state){const issues=[];for(let d=new Date(y,m,1);d.getMonth()===m;d.setDate(d.getDate()+1)){issues.push(...evaluateDay(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,state).issues)}return {issues}}
function role(id,state){return state.users.find(u=>u.id===id)?.role||'standard'} function name(id,state){return state.users.find(u=>u.id===id)?.name||id} function unav(id,day,state){const u=state.users.find(x=>x.id===id);return u?isUnavailable(u,day,state):false}
