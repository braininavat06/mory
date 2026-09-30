export {};
const root = document.documentElement;
const selector = document.querySelector<HTMLSelectElement>('[data-theme-select]');
const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(preference: string) {
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
}
if (selector) {
  selector.value = root.dataset.themePreference ?? 'system';
  selector.addEventListener('change', () => {
    applyTheme(selector.value);
    try { localStorage.setItem('mory-theme', selector.value); } catch {}
  });
}
media.addEventListener('change', () => { if (root.dataset.themePreference === 'system') applyTheme('system'); });
window.addEventListener('storage', event => {
  if (event.key !== 'mory-theme' && event.key !== null) return;
  const preference = ['light', 'dark'].includes(event.newValue ?? '') ? event.newValue! : 'system';
  applyTheme(preference);
  if (selector) selector.value = preference;
});
const dialog = document.querySelector<HTMLDialogElement>('[data-search-dialog]');
const opener = document.querySelector<HTMLButtonElement>('[data-open-search]');
opener?.addEventListener('click', () => {
  dialog?.showModal();
  dialog?.querySelector<HTMLInputElement>('input')?.focus();
});
dialog?.querySelector('[data-close-search]')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog?.addEventListener('close', () => opener?.focus());
