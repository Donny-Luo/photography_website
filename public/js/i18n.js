// 多语言支持
let currentLang = 'zh';
let translations = {};

async function loadTranslations(lang) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    translations = await res.json();
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    return translations;
  } catch (err) {
    console.error('加载翻译失败:', err);
    return {};
  }
}

function t(key, params) {
  const keys = key.split('.');
  let value = translations;
  for (const k of keys) {
    value = value?.[k];
  }
  if (value === undefined) return key;
  // 简单参数替换 {name}
  if (params) {
    Object.keys(params).forEach(p => {
      value = value.replace(`{${p}}`, params[p]);
    });
  }
  return value;
}

// 根据路径检测语言
function detectLangFromPath() {
  const path = location.pathname;
  if (path.startsWith('/en')) return 'en';
  if (path.startsWith('/zh')) return 'zh';
  return null;
}

// 自动跳转：根路径时根据浏览器语言跳转
function maybeRedirectToLang() {
  const detected = detectLangFromPath();
  if (detected) return detected;

  // 没有语言前缀，自动跳转
  const browserLang = (navigator.language || 'zh').toLowerCase();
  const lang = browserLang.startsWith('zh') ? 'zh' : 'en';
  // 仅替换第一段路径
  const newPath = '/' + lang + location.pathname + location.search + location.hash;
  location.replace(newPath);
  return lang;
}

// 应用所有 i18n 元素：扫描 [data-i18n] 属性
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // 同步 document.title
  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) document.title = t(titleEl.dataset.i18n);
}

// 切换语言（不刷新页面）
async function switchLang(lang) {
  if (lang === currentLang) return;
  await loadTranslations(lang);
  // 保存偏好
  localStorage.setItem('preferred_lang', lang);
  // 重新应用翻译
  applyI18n();
  // 触发自定义事件，让页面 JS 重新渲染
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  // 更新 URL（不刷新）
  const newPath = location.pathname.replace(/^\/(zh|en)/, '') || '/';
  history.replaceState({}, '', '/' + lang + newPath + location.search);
}

// 暴露到全局
window.i18n = {
  t,
  switchLang,
  loadTranslations,
  applyI18n,
  currentLang: () => currentLang,
  getLang: () => currentLang
};
