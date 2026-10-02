export {};
const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]');
if (button) {
  const update = () => { button.hidden = window.scrollY < 240; };
  window.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => {
    const toc = document.querySelector<HTMLDetailsElement>('[data-toc]');
    if (toc && matchMedia('(max-width: 999px)').matches) toc.open = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const main = document.querySelector<HTMLElement>('main');
    if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
    update();
  });
  update();
}
// Reserve the actual mobile overlay height, including an expanded TOC.
const toc = document.querySelector<HTMLElement>('.toc');
if (toc) new ResizeObserver(() => {
  document.documentElement.style.setProperty('--toc-height', `${toc.getBoundingClientRect().height}px`);
}).observe(toc);
