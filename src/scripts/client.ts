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

const rssDialog = document.querySelector<HTMLDialogElement>('[data-rss-dialog]');
const rssOpener = document.querySelector<HTMLAnchorElement>('[data-open-rss]');
const rssAddress = rssDialog?.querySelector<HTMLInputElement>('#rss-address');
const rssStatus = rssDialog?.querySelector<HTMLElement>('[data-rss-copy-status]');
rssOpener?.addEventListener('click', event => {
  if (!rssDialog) return;
  event.preventDefault();
  if (rssStatus) rssStatus.textContent = '';
  rssDialog.showModal();
});
rssDialog?.querySelector('[data-close-rss]')?.addEventListener('click', () => rssDialog.close());
rssDialog?.addEventListener('click', event => { if (event.target === rssDialog) rssDialog.close(); });
rssDialog?.addEventListener('close', () => rssOpener?.focus());
rssDialog?.querySelector('[data-copy-rss]')?.addEventListener('click', async () => {
  if (!rssAddress || !rssStatus) return;
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(rssAddress.value);
    rssStatus.textContent = '구독 주소를 복사했습니다.';
  } catch {
    rssAddress.focus(); rssAddress.select();
    rssStatus.textContent = '주소를 선택했습니다. 길게 누르거나 복사 메뉴로 복사하세요.';
  }
});
