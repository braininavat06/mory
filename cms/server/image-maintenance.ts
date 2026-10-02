import { appendFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readContent } from '../../src/lib/content.ts';
import { ownerKey, managedImage } from '../../src/lib/assets.ts';
import { lifecycle } from './lifecycle-lock.ts';
import { imageOwner, type Asset, type Assets } from './assets.ts';
import type { Draft, Payload } from '../shared.ts';
const DAY=86_400_000;
export interface ImageAudit { scanned:number; referenced:number; candidates:number; deleted:number; deferred:number; errors:number; entries:Record<string,unknown>[] }
const blank=():ImageAudit=>({scanned:0,referenced:0,candidates:0,deleted:0,deferred:0,errors:0,entries:[]});
export class ImageMaintenance {
  constructor(public assets:Assets, public publicStateFresh:()=>Promise<boolean> = async()=>true) {}
  private log(kind:string, audit:ImageAudit, now:Date) {
    appendFileSync(join(this.assets.store.runtime,'image-maintenance.jsonl'),JSON.stringify({kind,at:now.toISOString(),...audit})+'\n',{mode:0o600});
    if(audit.errors) console.warn(`CMS image ${kind}: ${audit.errors} integrity/maintenance errors; see runtime/image-maintenance.jsonl`);
  }
  async references(publishedOnly=false):Promise<Set<string>> {
    const {store}=this.assets, refs=new Set<string>();
    const add=async(row:Draft,payload:Payload)=>{
      if(payload.deleted || (publishedOnly && row.kind==='post' && payload.data.status!=='published'))return;
      if(!publishedOnly) for(const a of store.db.prepare('SELECT filename,r2_key FROM assets').all() as {filename:string;r2_key:string}[]) if(payload.body.includes(a.filename)) refs.add(a.r2_key);
      for(const name of await this.assets.references(row,payload,this.assets.store.root,key=>refs.add(key))) refs.add(ownerKey(imageOwner(row),name));
    };
    for(const row of store.list().filter(d=>['post','page'].includes(d.kind))) {
      if(!publishedOnly)await add(row,row.value);
      if(row.published)await add(row,row.published);
    }
    if(!publishedOnly) for(const job of store.jobs().filter(j=>['publishing','deploying','failed','conflict'].includes(j.state) && !j.snapshot.deleted)) {
      const type=job.key.startsWith('post:')?'post':job.key.startsWith('page:')?'page':null;if(!type)continue;
      const id=job.key.slice(type.length+1),row=store.list().find(d=>d.key===job.key);
      await add(row ?? {kind:type,id,path:type==='post'?`src/content/posts/${id}.md`:`src/content/pages/${id}.md`} as Draft,job.snapshot);
    }
    // Protect checked-out Git content too, including public files after SQLite restoration.
    for(const root of [store.root,join(store.runtime,'publish-repo')].filter(r=>existsSync(join(r,'src/content/pages/home.md')))) {
      const content=readContent(root);
      for(const p of content.posts) {
        if(publishedOnly && p.data.status!=='published')continue;
        const row={kind:'post',id:p.data.id,path:p.file} as Draft;
        for(const name of await this.assets.references(row,{data:p.data,body:p.body},root,key=>refs.add(key)))refs.add(ownerKey(imageOwner(row),name));
      }
      for(const p of content.pages) {
        const row={kind:'page',id:p.key,path:p.file} as Draft;
        for(const name of await this.assets.references(row,{data:p.data,body:p.body},root,key=>refs.add(key)))refs.add(ownerKey(imageOwner(row),name));
      }
    }
    return refs;
  }
  async gc(now=new Date()) {
    const audit=blank(),iso=now.toISOString(),{store}=this.assets;
    try { await lifecycle(store.runtime,async()=>{
      let refs=await this.references();
      const rows=store.db.prepare('SELECT * FROM assets').all() as Asset[];
      for(const asset of rows) {
        audit.scanned++;
        try {
        if(asset.r2_key !== ownerKey({type:asset.owner_type,id:asset.owner_id},asset.filename)) throw new Error('Invalid managed object ownership');
        if(refs.has(asset.r2_key)) {
          audit.referenced++;store.db.prepare('UPDATE assets SET staged_orphaned_at=NULL,r2_orphaned_at=NULL WHERE id=?').run(asset.id);continue;
        }
        if(asset.local_path && !asset.r2_uploaded_at) {
          audit.candidates++;
          if(!asset.staged_orphaned_at) {store.db.prepare('UPDATE assets SET staged_orphaned_at=? WHERE id=?').run(iso,asset.id);audit.deferred++;continue;}
          if(!/^\d{4}-\d{2}-\d{2}T/.test(asset.staged_orphaned_at) || !Number.isFinite(Date.parse(asset.staged_orphaned_at)) || now.getTime()-Date.parse(asset.staged_orphaned_at)<7*DAY){audit.deferred++;continue;}
          refs=await this.references();
          if(refs.has(asset.r2_key)){store.db.prepare('UPDATE assets SET staged_orphaned_at=NULL WHERE id=?').run(asset.id);audit.deferred++;continue;}
          const file=this.assets.path(asset);
          store.db.prepare('UPDATE assets SET local_path=NULL,local_deleted_at=? WHERE id=?').run(iso,asset.id);
          try{rmSync(file,{force:true});}catch(error){store.db.prepare('UPDATE assets SET local_path=?,local_deleted_at=NULL WHERE id=?').run(asset.local_path,asset.id);throw error;}
          audit.deleted++;audit.entries.push({id:asset.id,path:asset.local_path,hash:asset.sha256,at:iso});
        }
        if(asset.r2_uploaded_at && !asset.r2_deleted_at) {
          audit.candidates++;
          if(!asset.r2_orphaned_at) {store.db.prepare('UPDATE assets SET r2_orphaned_at=? WHERE id=?').run(iso,asset.id);audit.deferred++;continue;}
          if(!/^\d{4}-\d{2}-\d{2}T/.test(asset.r2_orphaned_at) || !Number.isFinite(Date.parse(asset.r2_orphaned_at)) || now.getTime()-Date.parse(asset.r2_orphaned_at)<30*DAY){audit.deferred++;continue;}
          if(!this.assets.remote.delete || !await this.publicStateFresh()){audit.deferred++;continue;}
          const object=await this.assets.remote.head(asset.r2_key);
          if(object && (object.sha256!==asset.sha256 || object.size!==asset.size_bytes || object.mime!==asset.mime_type)){audit.errors++;audit.entries.push({id:asset.id,key:asset.r2_key,hash:asset.sha256,reason:'remote metadata mismatch',at:iso});continue;}
          // Rebuild after the final remote check, not from a cached used flag.
          refs=await this.references();
          if(refs.has(asset.r2_key)){store.db.prepare('UPDATE assets SET r2_orphaned_at=NULL WHERE id=?').run(asset.id);audit.deferred++;continue;}
          if(object)await this.assets.remote.delete(asset.r2_key);
          store.db.prepare('UPDATE assets SET r2_deleted_at=? WHERE id=?').run(iso,asset.id);
          if(asset.local_path){const file=this.assets.path(asset);
          store.db.prepare('UPDATE assets SET local_path=NULL,local_deleted_at=? WHERE id=?').run(iso,asset.id);
          try{rmSync(file,{force:true});}catch(error){store.db.prepare('UPDATE assets SET local_path=?,local_deleted_at=NULL WHERE id=?').run(asset.local_path,asset.id);throw error;}}
          audit.deleted++;audit.entries.push({id:asset.id,key:asset.r2_key,hash:asset.sha256,at:iso});
        }
        } catch { audit.errors++;audit.deferred++;audit.entries.push({id:asset.id,key:asset.r2_key,reason:'validation/deletion failed; retry deferred',at:iso}); }
      }
      // Final files stranded by a crash between rename and DB registration.
      const setting='image-orphan-files',old=JSON.parse((store.db.prepare('SELECT value FROM settings WHERE key=?').get(setting) as {value:string}|undefined)?.value ?? '{}'),seen:Record<string,string>={};
      const walk=(dir:string):string[]=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory() && e.name!=='.temporary'?walk(join(dir,e.name)):e.isFile()? [join(dir,e.name)]:[]):[];
      for(const file of walk(join(store.runtime,'uploads'))) {
        const key=relative(join(store.runtime,'uploads'),file).replaceAll('\\','/'),filename=key.split('/').pop()!;
        if(!managedImage(filename) || rows.some(a=>a.r2_key===key && a.local_path))continue;
        audit.scanned++;if(refs.has(key)){audit.referenced++;continue;}
        audit.candidates++;seen[key]=old[key]??iso;
        if(now.getTime()-Date.parse(seen[key])>=7*DAY && !(await this.references()).has(key)) {rmSync(file);delete seen[key];audit.deleted++;audit.entries.push({path:key,at:iso});} else audit.deferred++;
      }
      store.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(setting,JSON.stringify(seen));
    }); } catch { audit.errors++; } // Ambiguity preserves files; editing/publishing is independent.
    try{this.log('gc',audit,now);}catch{console.warn('CMS image GC audit log unavailable');}
    return audit;
  }
  async integrity(now=new Date()) {
    const audit=blank();
    try {
      for(const key of await this.references(true)) {
        audit.scanned++;
        try { const object=await this.assets.remote.head(key),asset=this.assets.store.db.prepare('SELECT * FROM assets WHERE r2_key=?').get(key) as Asset|undefined;
          if(!object || !/^[a-f0-9]{64}$/.test(object.sha256) || (asset && (object.sha256!==asset.sha256 || object.size!==asset.size_bytes || object.mime!==asset.mime_type))) {
            audit.errors++;audit.entries.push({key,reason:!object?'missing':'hash/size mismatch',at:now.toISOString()});
          } else audit.referenced++;
        }catch{audit.errors++;audit.entries.push({key,reason:'HEAD unavailable',at:now.toISOString()});}
      }
    }catch{audit.errors++;}
    try{this.log('integrity',audit,now);}catch{console.warn('CMS image integrity audit log unavailable');}
    return audit;
  }
}
