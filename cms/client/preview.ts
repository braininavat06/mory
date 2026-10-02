import '../../src/styles/global.css';
import '../../src/scripts/search.ts';
import '../../src/scripts/toc.ts';
import '../../src/scripts/back-to-top.ts';
const toc = document.querySelector<HTMLDetailsElement>('[data-toc]');
if (toc) toc.open = matchMedia('(min-width: 1000px)').matches;
// Native fragment navigation can scroll the outer CMS until the frame border
// touches the viewport edge. Scroll only the preview, retaining some outer space.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
  const href = link.getAttribute('href');
  link.addEventListener('click', event => {
    event.preventDefault();
    if (!href?.startsWith('#')) return;
    let target: HTMLElement | null;
    try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
    catch { return; }
    if (!target) return;
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 32, behavior: 'instant' });
    const frame = window.frameElement;
    if (frame && window.parent !== window) {
      const pane = frame.closest('.preview-pane') ?? frame;
      const top = pane.getBoundingClientRect().top;
      if (top < 48) window.parent.scrollBy({ top: top - 48, behavior: 'instant' });
    }
  });
}
