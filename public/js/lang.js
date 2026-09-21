// 语言切换器
(function () {
  function detectLang() {
    const path = location.pathname;
    if (path.startsWith('/en')) return 'en';
    if (path.startsWith('/zh')) return 'zh';
    const saved = localStorage.getItem('preferred_lang');
    if (saved) return saved;
    const navLang = (navigator.language || 'zh').toLowerCase();
    return navLang.startsWith('zh') ? 'zh' : 'en';
  }

  function updateLangSwitchButton(lang) {
    // 按钮显示点击后会切换到的目标语言
    const labels = { zh: 'English', en: '中文' };
    const el = document.getElementById('langLabel');
    if (el) el.textContent = labels[lang] || lang;
  }

  function setupLangSwitch(currentLang) {
    const btn = document.getElementById('langSwitch');
    if (!btn) return;
    updateLangSwitchButton(currentLang);
    btn.addEventListener('click', () => {
      const newLang = currentLang === 'zh' ? 'en' : 'zh';
      localStorage.setItem('preferred_lang', newLang);
      // 同时写入 cookie（有效期 1 年），便于服务器端根路径默认语言识别
      document.cookie = 'preferred_lang=' + newLang + '; path=/; max-age=' + (365 * 24 * 60 * 60) + '; SameSite=Lax';
      // 替换 URL 中的语言前缀
      const path = location.pathname;
      const newPath = path.replace(/^\/(zh|en)/, '') || '/';
      // 为页面内的相对链接也调整语言前缀（让跳转保持语言一致）
      location.href = '/' + newLang + (newPath === '/' ? '' : newPath) + location.search + location.hash;
    });
  }

  // 暴露一个全局 L(path) 函数：自动给相对路径加上语言前缀
  // 用法：L('/photo/1') => '/zh/photo/1'
  window.L = function (path) {
    if (!path) return path;
    // 已带语言前缀、绝对 URL、后台路径、API、资源路径直接返回
    if (/^\/(zh|en)\//.test(path) || /^https?:/.test(path) ||
        path.startsWith('/admin') || path.startsWith('/api') ||
        path.startsWith('/uploads') || path.startsWith('/css') ||
        path.startsWith('/js') || path.startsWith('/locales') ||
        path.startsWith('#') || path.startsWith('javascript:')) {
      return path;
    }
    return '/' + currentLang + (path.startsWith('/') ? path : '/' + path);
  };

  // 替换页面内所有相对链接，自动加上当前语言前缀
  function patchLinks(currentLang) {
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('javascript')) return;
      if (href.startsWith('/zh') || href.startsWith('/en')) return;
      // 后台管理不带前缀
      if (href.startsWith('/admin')) return;
      // 已经是 /uploads 等资源路径
      if (href.startsWith('/uploads') || href.startsWith('/api')) return;
      a.setAttribute('href', '/' + currentLang + href);
    });
  }

  // 初始化
  async function init() {
    const lang = detectLang();
    await loadTranslations(lang);
    applyI18n();
    setupLangSwitch(lang);
    // 等 DOM 渲染完成后修复链接
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => patchLinks(lang));
    } else {
      patchLinks(lang);
    }
  }

  // 暴露给其他页面手动调用
  window.initLang = init;

  // 自动执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
