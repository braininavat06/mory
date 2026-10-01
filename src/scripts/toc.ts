export {};
const toc = document.querySelector<HTMLDetailsElement>('[data-toc]');
if (toc) {
  const links = [...toc.querySelectorAll<HTMLAnchorElement>('a')];
  links.forEach(link => link.addEventListener('click', () => {
    if (matchMedia('(max-width: 999px)').matches) toc.open = false;
  }));
  const headings = links.map(link => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let queued = false;
  const update = () => {
    queued = false;
    let active = 0;
    headings.forEach((heading, index) => { if (heading && heading.getBoundingClientRect().top <= 140) active = index; });
    links.forEach((link, index) => index === active ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current'));
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}
