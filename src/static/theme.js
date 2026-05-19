(() => {
  const KEY = 'pfmon-theme';
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  function preferred() {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (_e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  apply(preferred());
  window.pfmonToggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch (_e) {}
  };

  // Called from the controls form's hx-on::after-request: mirror the current
  // form state into the address bar so a hard refresh (F5) restores the same
  // filter / sort. We replaceState rather than pushState because each keystroke
  // would otherwise pile up a back-history entry.
  window.pfmonSyncUrl = (form) => {
    const fd = new FormData(form);
    for (const [k, v] of [...fd]) if (!v) fd.delete(k);
    const qs = new URLSearchParams(fd).toString();
    history.replaceState(null, '', qs ? `/?${qs}` : '/');
  };
})();
