import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,cpSync,symlinkSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { writeFixtureContent } from '../../tests/fixtures.ts';
import { readContent } from '../../src/lib/content.ts';
import { Store } from '../server/store.ts';
const source=resolve('.');
const build=(root:string)=>{const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('R2_')||key.startsWith('MORY_'))delete env[key];execFileSync('npm',['run','build'],{cwd:root,env,stdio:'pipe',maxBuffer:8_000_000});execFileSync('npm',['run','verify'],{cwd:root,env,stdio:'pipe',maxBuffer:8_000_000});};
const html=(root:string,path:string)=>readFileSync(join(root,'dist',path,'index.html'),'utf8');
export const stressMarkdown=`## ${'긴 제목 LongHeading'.repeat(25)}

${'https://example.com/'.repeat(20)}

\`${'inline_code_'.repeat(70)}\`

\`\`\`typescript
const long = '${'wide code line '.repeat(70)}';
\`\`\`

| ${'WideHeader'.repeat(30)} | second |
| --- | --- |
| ${'WideCell'.repeat(30)} | value |

> [!warning]
> ${'긴 경고 내용 '.repeat(25)}

> ${'blockquote '.repeat(25)}

![[image.webp|600]]
::alt[PUBLIC ALT]
::caption[PUBLIC **CAPTION**]

$E=mc^2$

$$
${Array(60).fill('x^2').join('+')}
$$

각주[^long]

[^long]: ${'footnote '.repeat(70)}
`;
test('public outputs use Git published snapshots, canonical aliases and no CMS draft data; zero archive builds',()=>{
 const root=mkdtempSync(join(tmpdir(),'mory-public-polish-'));let store:Store|undefined;
 try {
  for(const name of ['src','public','scripts','astro.config.ts','tsconfig.json','package.json'])cpSync(join(source,name),join(root,name),{recursive:true});symlinkSync(join(source,'node_modules'),join(root,'node_modules'));writeFixtureContent(root);
  const content=readContent(root),first=content.posts.find(p=>p.data.slug==='a-place-to-write')!,second=content.posts.find(p=>p.data.slug==='markdown-notes')!;
  const image='mory-asset-01K6F4J0M00000000000000009.webp';
  first.data.title='PUBLIC TITLE';first.data.description='PUBLIC DESCRIPTION';first.data.imageDimensions={[image]:{width:600,height:400}};first.body='PUBLICBODYTOKEN\n\n'+stressMarkdown.replace('image.webp',image);
  second.body='No heading body';second.data.description='';
  for(const post of [first,second])writeFileSync(join(root,post.file),`---\n${stringify(post.data)}---\n${post.body}`);
  writeFileSync(join(root,'src/data/categories.yaml'),stringify({sample:{name:'PUBLIC CATEGORY '+ '긴분류'.repeat(20),order:10},empty:{name:'빈 분류',order:20}}));
  writeFileSync(join(root,'data/series/sample-series.yaml'),stringify({id:'sample-series',name:'PUBLIC SERIES '+ '긴시리즈'.repeat(20),description:'',posts:[first.data.id,second.data.id]}));
  writeFileSync(join(root,'data/series/empty.yaml'),stringify({id:'empty',name:'빈 시리즈',description:'',posts:[]}));
  for(const key of ['home','about'])writeFileSync(join(root,`src/content/pages/${key}.md`),`---\ntitle: ${key}\ndescription: ${key}\n---\n# ${key}\n\n::recent-writing{count=5}\n\n::category-list\n\n::series-list\n\n::writing-search\n`);
  store=new Store(root,join(root,'runtime'));
  const draft=store.get(`post:${first.data.id}`);store.save(draft.key,draft.revision,{data:{...draft.value.data,title:'UNPUBLISHED TITLE',description:'UNPUBLISHED DESCRIPTION',slug:'unpublished-slug',category:'empty'},body:'UNPUBLISHEDBODYTOKEN\n\n![[image.webp]]\n::alt[UNPUBLISHED ALT]\n::caption[UNPUBLISHED CAPTION]'},true);
  for(const key of ['categories:registry','series:sample-series','page:home']){const d=store.get(key);store.save(key,d.revision,{...d.value,data:key.startsWith('series:')?{...d.value.data,name:'UNPUBLISHED SERIES'}:key==='categories:registry'?{...d.value.data,sample:{name:'UNPUBLISHED CATEGORY',order:10}}:d.value.data,body:key==='page:home'?'UNPUBLISHED HOME':d.value.body});}
  build(root);
  const main=html(root,'writing/a-place-to-write');assert.match(main,/PUBLIC TITLE/);assert.match(main,/PUBLIC DESCRIPTION/);assert.match(main,/PUBLIC ALT/);assert.match(main,/PUBLIC <strong>CAPTION<\/strong>/);assert.match(main,/width="600" height="400"/);assert.doesNotMatch(main,/UNPUBLISHED|draft-example|archived-example/);
  for(const route of ['','about','writing','category/sample','series/sample-series'])assert.doesNotMatch(html(root,route),/UNPUBLISHED|draft-example|archived-example/);
  assert.doesNotMatch(html(root,'writing/markdown-notes'),/class="toc"/);assert.match(html(root,'writing/markdown-notes'),/<meta name="description" content="[^"]+"/);assert.match(html(root,'category/empty'),/아직 공개된 글이 없습니다/);
  const alias=html(root,'writing/first-note');assert.match(alias,/content="0;url=\/writing\/a-place-to-write\/"/);assert.match(alias,/noindex,follow/);assert.match(alias,/rel="canonical" href="https:\/\/mory.place\/writing\/a-place-to-write\/"/);assert.doesNotMatch(alias,/data-pagefind-body/);assert.match(alias,/window.location.search \+ window.location.hash/);
  const rss=readFileSync(join(root,'dist/rss.xml'),'utf8'),sitemap=readFileSync(join(root,'dist/sitemap-0.xml'),'utf8');for(const output of [rss,sitemap])assert.doesNotMatch(output,/first-note|draft-example|archived-example|UNPUBLISHED|404/);
  const notFound=readFileSync(join(root,'dist/404.html'),'utf8');assert.match(notFound,/페이지를 찾을 수 없습니다/);assert.match(notFound,/noindex,follow/);assert.match(notFound,/href="\/writing\/"/);
  const index=JSON.parse(readFileSync(join(root,'dist/pagefind/pagefind-entry.json'),'utf8'));assert.equal(Object.values(index.languages).reduce((n:number,l:any)=>n+l.page_count,0),2);
  if(process.env.MORY_KEEP_POLISH_FIXTURE){writeFileSync('/tmp/mory-polish-fixture-path',root);store.close();store=undefined;return;}
  store.close();store=undefined;rmSync(join(root,'runtime'),{recursive:true,force:true});rmSync(join(root,'src/content/posts'),{recursive:true,force:true});rmSync(join(root,'data/series'),{recursive:true,force:true});build(root);
  assert.match(html(root,'writing'),/아직 공개된 글이 없습니다/);assert.match(html(root,''),/data-empty-archive/);assert.doesNotMatch(readFileSync(join(root,'dist/rss.xml'),'utf8'),/<item>/);
  assert.ok(!existsSync(join(root,'dist/writing/a-place-to-write/index.html')));assert.deepEqual(JSON.parse(readFileSync(join(root,'dist/pagefind/pagefind-entry.json'),'utf8')).languages,{});
 } finally {store?.close();if(!process.env.MORY_KEEP_POLISH_FIXTURE)rmSync(root,{recursive:true,force:true});}
});
