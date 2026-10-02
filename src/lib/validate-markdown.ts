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

export async function validateMarkdown(content: Content, root = process.cwd()) {
  let currentFile = '', current:LinkDocument;
  let sourceLines=new Map<string,number[]>();
  function positions() { return (tree:any) => { visit(tree,'element',(node:any)=>{
    if(node.tagName==='a'&&typeof node.properties?.href==='string'&&node.position?.start.line) {
      const url=node.properties.href;sourceLines.set(url,[...(sourceLines.get(url)??[]),node.position.start.line]);
    }
  }); }; }
  const documents:LinkDocument[]=[], warnings:LinkDiagnostic[]=[];
  const options = createMarkdownOptions(content, [positions], link => warnings.push({file:currentFile,line:link.line,message:`끊어졌거나 공개되지 않은 wikilink [[${link.target}]]; 텍스트로 표시합니다.`}));
  const renderer = await options.processor.createRenderer(options);
  const errors: MarkdownIssue[] = [];
  for (const entry of [...content.posts, ...content.pages]) {
    currentFile = entry.file;sourceLines=new Map();
    current={file:entry.file,route:documentRoute(entry),ids:new Set(),links:[]};
    try {
      const rendered=await renderer.render(entry.body, { fileURL: pathToFileURL(resolve(root, entry.file)), frontmatter: entry.data });
      // Inspect final HTML after Astro has assigned real heading/footnote IDs.
      // Reuse the existing HTML parser; this is diagnostics only, not a second renderer.
      sanitizeHtml(rendered.code,{allowedTags:false,allowedAttributes:false,allowVulnerableTags:true,transformTags:{'*':(tag,attrs)=>{
        if(attrs.id) {
          if(current.ids.has(attrs.id))warnings.push({file:currentFile,line:0,message:`중복 HTML 앵커 #${attrs.id}: 링크 대상이 모호할 수 있습니다.`});
          current.ids.add(attrs.id);
        }
        if(tag==='a'&&attrs.href)current.links.push({url:attrs.href,line:sourceLines.get(attrs.href)?.shift()??0});
        return {tagName:tag,attribs:attrs};
      }}});
      if('key' in entry || entry.data.status==='published')documents.push(current);
    } catch (error) { errors.push({ file: entry.file, title: entry.data.title, message: error instanceof Error ? error.message : String(error) }); }
  }
  // Astro's collection loader can log renderer errors and continue; make them fatal here.
  if (errors.length) throw new MarkdownValidationError(errors);
  warnings.push(...internalLinkDiagnostics(content,documents,root));
  for(const warning of warnings)console.warn(`${warning.file}${warning.line?`:${warning.line}`:''}: ${warning.message}`);
  return warnings;
}
