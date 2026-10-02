import sanitizeHtml from 'sanitize-html';
import { visit } from 'unist-util-visit';
import { documentRoute, internalLinkDiagnostics } from './internal-links.ts';
import type { LinkDocument, LinkDiagnostic } from './internal-links.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownOptions } from '../markdown/pipeline.ts';
import type { Content } from './content.ts';

export interface MarkdownIssue { file: string; title: string; message: string }
export class MarkdownValidationError extends Error {
  issues: MarkdownIssue[];
  constructor(issues: MarkdownIssue[]) {
    super(`Markdown 검증 실패:\n${issues.map(issue => `- ${issue.file}: ${issue.message}`).join('\n')}`);
    this.issues = issues;
  }
}

export interface MarkdownInspectionOptions {
  entries?: (Content['posts'][number]|Content['pages'][number])[];
  includePrivate?:boolean;
  targets?:Content;
  targetDocuments?:LinkDocument[];
  onWikilink?:(file:string,link:{target:string;label:string;line:number})=>void;
}
export async function inspectMarkdown(content: Content, root = process.cwd(), settings:MarkdownInspectionOptions={}) {
  let currentFile = '', current:LinkDocument;
  let sourceLines=new Map<string,number[]>();
  function positions() { return (tree:any) => { visit(tree,'element',(node:any)=>{
    if(node.tagName==='a'&&typeof node.properties?.href==='string'&&node.position?.start.line) {
      const url=node.properties.href;sourceLines.set(url,[...(sourceLines.get(url)??[]),node.position.start.line]);
    }
  }); }; }
  const documents:LinkDocument[]=[], warnings:LinkDiagnostic[]=[];
  const options = createMarkdownOptions(content, [positions], link => {
    settings.onWikilink?.(currentFile,link);
    const target=(settings.targets??content).posts.find(p=>p.data.slug===link.target||p.data.aliases.includes(link.target));
    warnings.push({file:currentFile,line:link.line,kind:'wikilink',target:link.target,severity:'warning',message:target?'공개되지 않은 글을 참조하는 위키링크입니다. 화면에는 텍스트로 표시됩니다.':'대상 글을 찾을 수 없는 위키링크입니다. 화면에는 텍스트로 표시됩니다.'});
  },{wikilinkContent:settings.targets});
  const renderer = await options.processor.createRenderer(options);
  const errors: MarkdownIssue[] = [];
  for (const entry of settings.entries??[...content.posts, ...content.pages]) {
    currentFile = entry.file;sourceLines=new Map();
    current={file:entry.file,route:documentRoute(entry),ids:new Set(),links:[]};
    try {
      const rendered=await renderer.render(entry.body, { fileURL: pathToFileURL(resolve(root, entry.file)), frontmatter: entry.data });
      // Inspect final HTML after Astro has assigned real heading/footnote IDs.
      // Reuse the existing HTML parser; this is diagnostics only, not a second renderer.
      sanitizeHtml(rendered.code,{allowedTags:false,allowedAttributes:false,allowVulnerableTags:true,transformTags:{'*':(tag,attrs)=>{
        if(attrs.id) {
          if(current.ids.has(attrs.id))warnings.push({file:currentFile,line:0,kind:'duplicate-anchor',target:`#${attrs.id}`,message:`중복 HTML 앵커 #${attrs.id}: 링크 대상이 모호할 수 있습니다.`});
          current.ids.add(attrs.id);
        }
        if(tag==='a'&&attrs.href)current.links.push({url:attrs.href,line:sourceLines.get(attrs.href)?.shift()??0});
        return {tagName:tag,attribs:attrs};
      }}});
      if(settings.includePrivate || 'key' in entry || entry.data.status==='published')documents.push(current);
    } catch (error) { errors.push({ file: entry.file, title: entry.data.title, message: error instanceof Error ? error.message : String(error) }); }
  }
  warnings.push(...internalLinkDiagnostics(settings.targets??content,documents,root,settings.targetDocuments??documents.filter(d=>content.pages.some(p=>p.file===d.file)||content.posts.some(p=>p.file===d.file&&p.data.status==='published'))));
  return {documents,warnings,errors};
}
export async function validateMarkdown(content: Content, root = process.cwd()) {
  const {warnings,errors}=await inspectMarkdown(content,root);
  // Astro's collection loader can log renderer errors and continue; make them fatal here.
  if (errors.length) throw new MarkdownValidationError(errors);
  for(const warning of warnings)console.warn(`${warning.file}${warning.line?`:${warning.line}`:''}: ${warning.message}`);
  return warnings;
}
