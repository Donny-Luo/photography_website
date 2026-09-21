// 通用工具函数 - Tailwind 风格

async function api(url, options = {}) {
  // 复制 options，避免污染调用方
  const config = { ...options };

  // FormData / Blob / ArrayBuffer / URLSearchParams：直接发送，不设置 JSON 头
  const isFormData = typeof FormData !== 'undefined' && config.body instanceof FormData;
  const isBinary = config.body instanceof Blob || config.body instanceof ArrayBuffer || config.body instanceof URLSearchParams;

  // 不自动设置 Content-Type，让 fetch 为 FormData 自动加 boundary
  if (isFormData || isBinary) {
    if (config.headers) {
      // 移除可能存在的 Content-Type，避免干扰 boundary
      const h = { ...config.headers };
      delete h['Content-Type'];
      delete h['content-type'];
      config.headers = h;
    }
  } else {
    // 普通 JSON 请求
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    if (config.body && typeof config.body !== 'string') {
      config.body = JSON.stringify(config.body);
    }
  }

  config.credentials = 'include';

  // CSRF 防护：写操作（POST/PUT/PATCH/DELETE）自动附带 x-csrf-token 请求头
  const method = (config.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers = { ...(config.headers || {}), 'x-csrf-token': getCsrfToken() };
  }

  const res = await fetch(url, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || '请求失败');
  return data;
}

async function getCurrentUser() {
  try { return await api('/api/auth/me'); } catch { return null; }
}

async function renderUserStatus() {
  const user = await getCurrentUser();
  const navLogin = document.getElementById('navLogin');
  const navRegister = document.getElementById('navRegister');
  const navProfile = document.getElementById('navProfile');
  const navAdmin = document.getElementById('navAdmin');
  const logoutBtn = document.getElementById('logoutBtn');

  if (user) {
    if (navLogin) navLogin.classList.add('hidden');
    if (navRegister) navRegister.classList.add('hidden');
    if (navProfile) {
      navProfile.classList.remove('hidden');
      navProfile.href = window.L ? window.L('/profile') : '/profile';
    }
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (navAdmin && user.role === 'admin') {
      navAdmin.classList.remove('hidden');
      navAdmin.href = '/admin';
    }
  } else {
    if (navLogin) navLogin.classList.remove('hidden');
    if (navRegister) navRegister.classList.remove('hidden');
    if (navProfile) navProfile.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (navAdmin) navAdmin.classList.add('hidden');
  }
  return user;
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  } catch (err) { console.error(err); }
}

document.addEventListener('DOMContentLoaded', () => {
  applyFeatureFlags();
  renderUserStatus();
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
});

function showMessage(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateX(100%)';
    div.style.transition = 'all 0.3s ease';
    setTimeout(() => div.remove(), 300);
  }, 2500);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 读取指定 cookie 的值
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// 获取后端下发的 CSRF token（配合 middleware/csrf.js 双提交校验）
function getCsrfToken() {
  return getCookie('csrf_token');
}

// 生成照片图片 URL：
// - locked（未订阅的付费作品）：返回空字符串，前端应渲染占位而非真实图
// - premium：走受保护的 /api/photos/:id/image
// - 普通照片：走静态 /uploads/<filename>
function photoImageUrl(p) {
  if (!p) return '';
  if (p.locked) return '';
  if (p.is_premium) return '/api/photos/' + p.id + '/image';
  return '/uploads/' + p.filename;
}

// 付费订阅功能是否开启（由 /js/config.js 注入）
function subscriptionEnabled() {
  return !!(window.APP_CONFIG && window.APP_CONFIG.subscriptionEnabled);
}

// 根据功能开关调整全局 UI（如隐藏订阅入口）
function applyFeatureFlags() {
  if (!subscriptionEnabled()) {
    document.querySelectorAll('a[data-i18n="nav.subscribe"]').forEach(el => {
      el.style.display = 'none';
    });
  }
}
