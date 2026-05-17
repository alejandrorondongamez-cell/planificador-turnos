export function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function parseISO(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
export function monthStartGrid(y,m){const first=new Date(y,m,1);const offset=(first.getDay()+6)%7;return new Date(y,m,1-offset)}
export function monthName(y,m){return new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'})}
export async function sha256(text){const enc=new TextEncoder().encode(text);const buf=await crypto.subtle.digest('SHA-256',enc);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
export function download(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
export function workdaysBetween(start,end,workdays,holidayMap){let n=0;for(let d=parseISO(start);d<=parseISO(end);d.setDate(d.getDate()+1)){const dow=d.getDay()||7;const day=iso(d);if(workdays.includes(dow)&&!holidayMap.has(day))n++}return n}
export function isWorkday(day,state){const d=parseISO(day);const dow=d.getDay()||7;return state.config.rules.workdays.includes(dow)}
export function isUnavailable(user,day,state){return (user.timeOff||[]).some(x=>x.type==='vacation'&&day>=x.start&&day<=x.end)}
