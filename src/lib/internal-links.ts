import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Content } from './content.ts';
import { publishedPosts, publicSeries } from './content.ts';
import { listPages, listUrl } from './listing.ts';
import { SITE } from './config.ts';

export interface LinkDocument { file:string; route:string; ids:Set<string>; links:{url:string;line:number}[] }
export interface LinkDiagnostic { file:string; line:number; message:string; kind?:'wikilink'|'route'|'anchor'|'private-link'|'duplicate-anchor'|'markdown'; target?:string; severity?:'warning'|'error' }
export function documentRoute(entry: Content['posts'][number] | Content['pages'][number]) {
  return 'key' in entry ? entry.key === 'home' ? '/' : `/${entry.key}/` : `/writing/${entry.data.slug}/`;
}
export function internalLinkDiagnostics(content:Content, documents:LinkDocument[], root:string, targetDocuments=documents):LinkDiagnostic[] {
  const routes=new Map<string,Set<string>>([['/',new Set(['main'])],['/about/',new Set(['main'])],['/rss.xml',new Set()],['/404.html',new Set(['main'])]]);
  const aliases=new Map<string,string>();
  const privateRoutes=new Set(content.posts.filter(p=>p.data.status!=='published').flatMap(p=>[p.data.slug,...p.data.aliases].map(s=>`/writing/${s}/`)));
  const posts=publishedPosts(content);
  for(const list of [...listPages(posts,'/writing/'),...Object.keys(content.categories).flatMap(id=>listPages(posts.filter(p=>p.data.category===id),`/category/${id}/`))]) routes.set(listUrl(list.base,list.sort,list.page),new Set(['main']));
  for(const series of publicSeries(content)) routes.set(`/series/${series.id}/`,new Set(['main']));
  for(const doc of targetDocuments) routes.set(doc.route,new Set(['main',...doc.ids]));
  for(const post of posts) for(const alias of post.data.aliases) aliases.set(`/writing/${alias}/`,`/writing/${post.data.slug}/`);
  const diagnostics:LinkDiagnostic[]=[];
  for(const doc of documents) for(const link of doc.links) {
    let url:URL;
    try { url=new URL(link.url,new URL(doc.route,SITE)); } catch { diagnostics.push({...link,file:doc.file,kind:'route',target:link.url,message:`링크 주소를 해석하지 못했습니다: ${link.url}`});continue; }
    if(url.origin!==new URL(SITE).origin) continue; // No external network validation.
    let path:string,anchor:string;
    try { path=decodeURIComponent(url.pathname);anchor=decodeURIComponent(url.hash.slice(1)); } catch { diagnostics.push({file:doc.file,line:link.line,kind:'route',target:link.url,message:`링크의 URL 인코딩을 확인하세요: ${link.url}`});continue; }
    if(path.endsWith('/index.html'))path=path.slice(0,-'index.html'.length);
    if(!path.endsWith('/')&&!/\.[^/]+$/.test(path))path+='/';
    path=aliases.get(path)??path;
    if(link.url.startsWith('#')) {
      if(anchor&&anchor.toLowerCase()!=='top'&&!doc.ids.has(anchor))diagnostics.push({file:doc.file,line:link.line,kind:'anchor',target:link.url,message:`이 문서에 #${anchor} 앵커가 없습니다: ${link.url}`});
      continue;
    }
    if(privateRoutes.has(path)) { diagnostics.push({file:doc.file,line:link.line,kind:'private-link',target:link.url,message:`공개되지 않은 초안·보관 글을 참조합니다: ${link.url}`});continue; }
    const ids=routes.get(path);
    if(!ids) {
      const base=resolve(root,'public'), asset=resolve(base,`.${path}`);
      if(asset.startsWith(base+sep)&&existsSync(asset)&&statSync(asset).isFile()) continue;
      diagnostics.push({file:doc.file,line:link.line,kind:'route',target:link.url,message:`존재하지 않는 내부 경로입니다: ${link.url}`});
    } else if(anchor&&anchor.toLowerCase()!=='top'&&!ids.has(anchor)) diagnostics.push({file:doc.file,line:link.line,kind:'anchor',target:link.url,message:`대상 페이지에 #${anchor} 앵커가 없습니다: ${link.url}`});
  }
  return diagnostics;
}
