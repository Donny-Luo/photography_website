let currentFilter = 'all';

async function loadCategories() {
  try {
    const categories = await api('/api/categories');
    const container = document.getElementById('categoryFilters');
    // 保留 "全部作品" 按钮
    const allBtn = container.querySelector('[data-category="all"]');
    container.innerHTML = '';
    container.appendChild(allBtn);
    categories.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn px-5 py-2 bg-white border border-gray-200 text-gray-700 rounded-full text-sm font-medium hover:border-indigo-500 hover:text-indigo-600 transition';
      btn.dataset.category = c.id;
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        currentFilter = c.id;
        container.querySelectorAll('.filter-btn').forEach(b => {
          b.classList.remove('bg-indigo-600', 'text-white', 'shadow-md');
          b.classList.add('bg-white', 'border', 'border-gray-200', 'text-gray-700');
        });
        btn.classList.add('bg-indigo-600', 'text-white', 'shadow-md');
        btn.classList.remove('bg-white', 'border', 'border-gray-200', 'text-gray-700');
        loadPhotos();
      });
      container.appendChild(btn);
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadPhotos() {
  const grid = document.getElementById('photoGrid');
  grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">${window.i18n.t('home.loadingFailed')}...</div>`;
  try {
    // 后端 GET /api/photos 返回 { items, pagination }；旧版本可能直接返回数组（兼容）
    const data = await api('/api/photos?page=1&pageSize=24' + (currentFilter !== 'all' ? '&category_id=' + currentFilter : ''));
    const photos = Array.isArray(data) ? data : (data.items || []);
    if (photos.length === 0) {
      grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">${window.i18n.t('home.noWorks')}</div>`;
      return;
    }
    grid.innerHTML = photos.map(p => {
      const imgUrl = photoImageUrl(p);
      // 付费未订阅：渲染占位（不加载原图，避免泄露）
      const imageHtml = p.locked
        ? `<div class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-white gap-2">
             <span class="text-3xl">🔒</span>
             <span class="text-xs font-medium">${window.i18n.t('photo.lockedView')}</span>
           </div>`
        : `<img src="${imgUrl}" alt="${escapeHtml(p.title)}" loading="lazy" decoding="async"
              width="${p.width || ''}" height="${p.height || ''}"
              class="w-full h-full object-cover group-hover:scale-110 transition duration-500">`;
      // 根据真实尺寸动态设置占位框比例，避免图片加载后页面抖动（CLS 友好）
      const aspectStyle = (p.width && p.height)
        ? `aspect-ratio:${p.width}/${p.height};`
        : '';
      return `
        <a href="${L('/photo/' + p.id)}" class="group block bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
          <div class="bg-gray-100 overflow-hidden relative" style="${aspectStyle}">
            ${imageHtml}
            ${p.is_premium && subscriptionEnabled() ? `<span class="absolute top-3 right-3 px-2.5 py-1 bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-full text-xs font-medium shadow-lg">${window.i18n.t('photo.premium')}</span>` : ''}
          </div>
          <div class="p-5">
            <h3 class="font-bold mb-2 group-hover:text-indigo-600 transition truncate">${escapeHtml(p.title)}</h3>
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">${p.category_name || window.i18n.t('home.uncategorized')}</span>
              <span>👁 ${p.views || 0}</span>
            </div>
          </div>
        </a>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div class="col-span-full text-center py-20 text-red-400">${err.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadPhotos();
});

// 语言切换时重新加载
document.addEventListener('langchange', () => {
  loadCategories();
  loadPhotos();
});
