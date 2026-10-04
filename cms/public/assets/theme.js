(() => {
  const key = 'mory-cms-theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  const saved = () => { try { return valid(localStorage.getItem(key)); } catch { return 'system'; } };
  let preference = saved();
  const apply = () => {
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    window.dispatchEvent(new Event('mory-themechange'));
  };
  window.addEventListener('mory-cms-theme-set', event => {
    preference = valid(event.detail);
    try { localStorage.setItem(key, preference); } catch {}
    apply();
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { preference = saved(); apply(); } });
  apply();
})();
