import '../../src/styles/global.css';
import '../../src/scripts/search.ts';
import '../../src/scripts/toc.ts';
const toc = document.querySelector<HTMLDetailsElement>('[data-toc]');
if (toc) toc.open = matchMedia('(min-width: 1000px)').matches;
// Preview navigation never leaves the editor; headings remain interactive.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) if (!link.getAttribute('href')?.startsWith('#')) link.addEventListener('click', event => { event.preventDefault(); });
