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
})();
