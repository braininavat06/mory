// No network or persistent visitor identity outside the real public domain.
import { isVisitorUUID } from '../../analytics/protocol.ts';
const enabled = () => location.protocol === 'https:' && ['mory.place','www.mory.place'].includes(location.hostname) && document.body.dataset.analytics !== 'off';
let visitor: string | undefined;
function identity() {
 try { const saved=localStorage.getItem('mory_visitor_id'); visitor=isVisitorUUID(saved)?saved:crypto.randomUUID();localStorage.setItem('mory_visitor_id',visitor); }
 catch { visitor??=crypto.randomUUID(); }
 return visitor;
}
function context() {
 return {path:location.pathname,route:document.body.dataset.analyticsRoute??'other',...(document.body.dataset.analyticsContent?{content:document.body.dataset.analyticsContent}:{})};
}
function send(event: Record<string,unknown>) {
 if(!enabled())return;
 try {
  const data=JSON.stringify({...event,visitor:identity()});
  const url='https://analytics.mory.place/event';
  const blob=new Blob([data],{type:'application/json'});
  if(navigator.sendBeacon?.(url,blob))return;
  void fetch(url,{method:'POST',body:data,headers:{'Content-Type':'application/json'},keepalive:true,credentials:'omit'}).catch(()=>{});
 } catch {} // Analytics is never allowed to affect rendering/search/navigation.
}
let lastQuery='',lastAt=0;
export function searchLogging() {
 let timer:ReturnType<typeof setTimeout>|undefined,pending:(()=>void)|undefined;
 const flush=()=>{if(timer)clearTimeout(timer);timer=undefined;const action=pending;pending=undefined;action?.();};
 return {
  searched(query:string,count:number){
   if(!enabled()||query.trim().length<2)return;
   if(timer)clearTimeout(timer);
   const normalized=query.trim().replace(/\s+/g,' ');
   pending=()=>{if(normalized===lastQuery&&Date.now()-lastAt<60000)return;lastQuery=normalized;lastAt=Date.now();send({type:'search',...context(),query,count});};
   timer=setTimeout(flush,800);
  },
  clicked(query:string,rank:number,path:string,content?:string){flush();send({type:'search_click',path,route:content?'post':'other',...(content?{content}:{}),query,rank});},
 };
}
if(enabled()) {
 let referrer='';try{referrer=document.referrer?new URL(document.referrer).hostname:'';}catch{}
 send({type:'pageview',...context(),referrer});
 // Ordinary document navigation loads this module once. A browser Back/Forward
 // Cache restore is another view without a new document/module execution.
 addEventListener('pageshow',event=>{if(event.persisted)send({type:'pageview',...context(),referrer:location.hostname});});
}
