import { Store } from '../../server/store.ts';
import { Assets } from '../../server/assets.ts';
import { backup } from '../../server/backup.ts';
import { lifecycle } from '../../server/lifecycle-lock.ts';
const [root,mode]=process.argv.slice(2),store=new Store(root,root+'/runtime');
const pause=()=>new Promise<void>(r=>process.once('message',()=>r()));
if(mode==='backup' || mode==='automatic') {
 const original=store.db.backup.bind(store.db);
 store.db.backup=async(...args:any[])=>{await original(...args as [string]);process.send?.('locked');await pause();return undefined as any;};
 await backup(store,new Date('2026-10-02T12:00:00+09:00'),{manual:mode==='backup'});
}else await lifecycle(store.runtime,async()=>{new Assets(store).cleanup();process.send?.('locked');await pause();});
store.close();
