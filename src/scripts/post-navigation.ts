export {};
const all = document.querySelector<HTMLElement>('[data-post-navigation="all"]');
const category = document.querySelector<HTMLElement>('[data-post-navigation="category"]');
if (all && category && new URL(location.href).searchParams.get('category') === category.dataset.navigationCategory) {
  all.hidden = true;
  category.hidden = false;
}
