import { iso, isWorkday, isUnavailable } from './utils.js';
import { evaluateMonth } from './rules.js';
export function generateMonthSchedule(y,m,state,{overwrite=false}={}){
 const schedule=structuredClone(state.schedule||{}); const users=state.users; const seniors=users.filter(u=>u.role==='senior').map(u=>u.id); const standards=users.filter(u=>u.role!=='senior').map(u=>u.id);
 const weeks=[]; let current=[];
 for(let d=new Date(y,m,1); d.getMonth()===m; d.setDate(d.getDate()+1)){const day=iso(d); if(!isWorkday(day,state)) continue; const dow=d.getDay()||7; if(dow===1&&current.length){weeks.push(current);current=[]} current.push(day)} if(current.length) weeks.push(current);
 let seniorIdx=0, standardIdx=0, lastEvening=new Set();
 for(const week of weeks){
   const pair=pickPair(week,seniors,standards,users,state,lastEvening,seniorIdx,standardIdx); seniorIdx=pair.nextSenior; standardIdx=pair.nextStandard; lastEvening=new Set(pair.ids);
   for(const day of week){
     if(!overwrite && schedule[day] && ((schedule[day].morning||[]).length||(schedule[day].evening||[]).length)) continue;
     const unavailable=new Set(users.filter(u=>isUnavailable(u,day,state)).map(u=>u.id));
     const evening=pair.ids.filter(id=>!unavailable.has(id));
     const morning=users.map(u=>u.id).filter(id=>!evening.includes(id)&&!unavailable.has(id));
     schedule[day]={morning,evening};
   }
 }
 const tmp={...state,schedule}; return {schedule,issues:evaluateMonth(y,m,tmp).issues};
}
function pickPair(week,seniors,standards,users,state,lastEvening,si,ti){
 const seniorCandidates=rotate(seniors,si).filter(id=>!lastEvening.has(id)); const standardCandidates=rotate(standards,ti).filter(id=>!lastEvening.has(id));
 for(const s of seniorCandidates.length?seniorCandidates:rotate(seniors,si)) for(const t of standardCandidates.length?standardCandidates:rotate(standards,ti)){
   if(week.some(day=>isUnavailable(users.find(u=>u.id===s),day,state)||isUnavailable(users.find(u=>u.id===t),day,state))) continue;
   return {ids:[s,t],nextSenior:(seniors.indexOf(s)+1)%seniors.length,nextStandard:(standards.indexOf(t)+1)%standards.length};
 }
 return {ids:[seniors[si%seniors.length],standards[ti%standards.length]],nextSenior:(si+1)%seniors.length,nextStandard:(ti+1)%standards.length};
}
function rotate(arr,start){return arr.map((_,i)=>arr[(start+i)%arr.length])}
