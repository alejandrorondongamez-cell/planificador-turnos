export const $=s=>document.querySelector(s);export const $$=s=>Array.from(document.querySelectorAll(s));
export function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function parseISO(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
export function monthName(y,m){return new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'})}
export function monthStartGrid(y,m){const f=new Date(y,m,1);const off=(f.getDay()+6)%7;return new Date(y,m,1-off)}
export function dayOfWeekISO(s){const d=parseISO(s).getDay();return d===0?7:d}
export async function sha256(t){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function downloadJson(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
export function downloadText(name,text,type='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
export function rangeDays(from,to){const out=[];for(let d=parseISO(from);d<=parseISO(to);d.setDate(d.getDate()+1))out.push(iso(d));return out}
export function isWorkday(day,state){return state.config.rules.workdays.includes(dayOfWeekISO(day))}
export function holidayType(day,state){return state.holidayMap.get(day)?.type || 'standard'}
export function coverageForDay(day,state){return state.config.rules.coverageByDayType[holidayType(day,state)] || state.config.rules.coverageByDayType.standard}
export function isUnavailable(user,day){return (user.timeOff||[]).some(x=>x.type==='vacation'&&day>=x.start&&day<=x.end)}
export function workingVacationDays(user,state){let n=0;(user.timeOff||[]).filter(x=>x.type==='vacation').forEach(x=>rangeDays(x.start,x.end).forEach(d=>{if(isWorkday(d,state)&&!state.holidayMap.has(d))n++}));return n}
