let currentUser = null;
let allCategories = [];
let allAlbums = [];
let selectedPhotoIds = new Set();

// Tab 切换
function switchTab(tabName) {
  // 侧边栏高亮
  document.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // 切换面板：去掉所有 hidden，给目标加上 active
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.classList.remove('active');
    t.classList.add('hidden');
  });
  const target = document.getElementById('tab-' + tabName);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  if (tabName === 'dashboard') loadStats();
  if (tabName === 'users') { loadUserStats(); loadUserList(); }
  if (tabName === 'photos') { loadPhotoList(); loadCategorySelects(); }
  if (tabName === 'upload') { loadCategorySelect(); loadAlbumCheckboxes(); }
  if (tabName === 'albums') loadAlbumList();
  if (tabName === 'categories') loadCategoryList();
  if (tabName === 'comments') loadCommentList();
  if (tabName === 'orders') loadOrderList();
}

async function loadAllAlbums() {
  try {
    const data = await api('/api/albums?page=1&pageSize=100');
    // 后端返回 { items, pagination }，兼容旧版直接数组
    allAlbums = Array.isArray(data) ? data : (data.items || []);
  } catch (e) { allAlbums = []; }
}
async function loadAllCategories() {
  try { allCategories = await api('/api/categories'); } catch (e) { allCategories = []; }
}

// 数据概览
async function loadStats() {
  try {
    const [stats, albumList] = await Promise.all([
      api('/api/subscriptions/stats'),
      api('/api/albums')
    ]);
    document.getElementById('statUsers').textContent = stats.totalUsers || 0;
    document.getElementById('statPhotos').textContent = stats.totalPhotos || 0;
    document.getElementById('statAlbums').textContent = albumList.length || 0;
    document.getElementById('statComments').textContent = stats.totalComments || 0;
    document.getElementById('statSubs').textContent = stats.totalSubscriptions || 0;
    // 营收按币种显示
    const cny = stats.totalRevenueCNY || 0;
    const usd = stats.totalRevenueUSD || 0;
    let revenueText = '';
    if (cny > 0) revenueText += `¥${cny} `;
    if (usd > 0) revenueText += `$${usd}`;
    if (!revenueText) revenueText = '¥0';
    document.getElementById('statRevenue').textContent = revenueText.trim();
    document.getElementById('statRevenue').style.fontSize = cny > 0 && usd > 0 ? '20px' : '32px';
  } catch (err) {
    console.error(err);
  }
}

// ===== 用户管理 =====
let userPage = 1;
const userPageSize = 20;

async function loadUserStats() {
  try {
    const stats = await api('/api/admin/users-stats');
    document.getElementById('uStatTotal').textContent = stats.total;
    document.getElementById('uStatAdmins').textContent = stats.admins;
    document.getElementById('uStatNormal').textContent = stats.normal;
    document.getElementById('uStatSubscribed').textContent = stats.subscribed;
    document.getElementById('uStatAvatar').textContent = stats.withAvatar;
  } catch (e) { console.error(e); }
}

async function loadUserList(page = 1) {
  userPage = page;
  const keyword = document.getElementById('userSearchInput').value.trim();
  const role = document.getElementById('userRoleFilter').value;
  const params = new URLSearchParams({ page, pageSize: userPageSize });
  if (keyword) params.append('keyword', keyword);
  if (role) params.append('role', role);

  try {
    const data = await api('/api/admin/users?' + params.toString());
    renderUserTable(data.items);
    renderUserPagination(data.pagination);
  } catch (err) {
    console.error(err);
    document.getElementById('userList').innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:#999;padding:24px">加载失败</td></tr>';
  }
}

function renderUserTable(items) {
  const tbody = document.getElementById('userList');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:24px">暂无用户</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(u => {
    const avatarHtml = u.avatar
      ? `<img src="/uploads/${u.avatar}" class="w-9 h-9 rounded-full object-cover" onerror="this.style.display='none'">`
      : `<div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">${escapeHtml(u.username[0].toUpperCase())}</div>`;
    const roleBadge = u.role === 'admin'
      ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">管理员</span>'
      : '<span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">用户</span>';
    const subBadge = u.isSubscribed
      ? `<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">✨ ${u.daysLeft}天</span>`
      : '<span class="px-2 py-1 bg-gray-50 text-gray-400 rounded text-xs">—</span>';
    const isMe = u.id === currentUser.id;
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-sm text-gray-500">#${u.id}</td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            ${avatarHtml}
            <span class="font-medium text-gray-900">${escapeHtml(u.username)}${isMe ? ' <span class="text-xs text-indigo-500">(我)</span>' : ''}</span>
          </div>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600">${escapeHtml(u.email)}</td>
        <td class="px-4 py-3">${roleBadge}</td>
        <td class="px-4 py-3">${subBadge}</td>
        <td class="px-4 py-3 text-sm text-gray-600">${u.commentCount}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${formatDate(u.createdAt)}</td>
        <td class="px-4 py-3">
          <button class="btn-action" onclick="openUserDetail(${u.id})">详情</button>
          ${!isMe ? `<button class="btn-action" onclick="toggleUserRole(${u.id})">${u.role === 'admin' ? '降为用户' : '升为管理员'}</button>` : ''}
          ${!isMe ? `<button class="btn-action danger" onclick="deleteUser(${u.id})">删除</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderUserPagination(p) {
  const el = document.getElementById('userPagination');
  if (p.totalPages <= 1) {
    el.innerHTML = `<span class="text-sm text-gray-500">共 ${p.total} 位用户</span>`;
    return;
  }
  let btns = '';
  btns += `<button class="btn-action ${p.page === 1 ? 'opacity-50 pointer-events-none' : ''}" onclick="loadUserList(${p.page - 1})">‹ 上一页</button>`;
  for (let i = 1; i <= p.totalPages; i++) {
    if (i === 1 || i === p.totalPages || Math.abs(i - p.page) <= 2) {
      btns += `<button class="btn-action ${i === p.page ? 'bg-indigo-600 text-white' : ''}" onclick="loadUserList(${i})">${i}</button>`;
    } else if (Math.abs(i - p.page) === 3) {
      btns += '<span class="px-2 text-gray-400">…</span>';
    }
  }
  btns += `<button class="btn-action ${p.page === p.totalPages ? 'opacity-50 pointer-events-none' : ''}" onclick="loadUserList(${p.page + 1})">下一页 ›</button>`;
  el.innerHTML = `<div class="flex items-center gap-2">${btns}</div><span class="text-sm text-gray-500">共 ${p.total} 位 / 第 ${p.page}/${p.totalPages} 页</span>`;
}

async function openUserDetail(id) {
  const modal = document.getElementById('userDetailModal');
  const body = document.getElementById('userDetailBody');
  body.innerHTML = '<div class="text-center py-12 text-gray-500">加载中...</div>';
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  try {
    const u = await api(`/api/admin/users/${id}`);
    const isMe = u.id === currentUser.id;
    const avatarHtml = u.avatar
      ? `<img src="/uploads/${u.avatar}" class="w-16 h-16 rounded-full object-cover border-4 border-white shadow">`
      : `<div class="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-3xl font-bold border-4 border-white shadow">${escapeHtml(u.username[0].toUpperCase())}</div>`;

    const subInfo = u.subscriptionEnd
      ? `<span class="px-2 py-1 ${u.isSubscribed ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'} rounded text-sm">${formatDate(u.subscriptionEnd)}${u.isSubscribed ? ' (有效)' : ' (已过期)'}</span>`
      : '<span class="text-gray-400 text-sm">未订阅</span>';

    const subsList = u.subscriptions && u.subscriptions.length
      ? `<table class="w-full text-sm admin-table mt-2">
           <thead class="bg-gray-50"><tr>
             <th class="px-3 py-2 text-left">时间</th><th class="px-3 py-2 text-left">套餐</th>
             <th class="px-3 py-2 text-left">金额</th><th class="px-3 py-2 text-left">状态</th>
           </tr></thead>
           <tbody>${u.subscriptions.map(s => `<tr>
             <td class="px-3 py-2">${formatDate(s.created_at)}</td>
             <td class="px-3 py-2">${s.plan_type}</td>
             <td class="px-3 py-2">${s.amount >= 100 ? '$' : '¥'}${s.amount}</td>
             <td class="px-3 py-2">${s.status}</td>
           </tr>`).join('')}</tbody>
         </table>`
      : '<p class="text-gray-400 text-sm">无订阅记录</p>';

    const commentsList = u.comments && u.comments.length
      ? `<div class="space-y-2 mt-2">${u.comments.map(c => `
          <div class="bg-gray-50 rounded-lg p-3 text-sm">
            <div class="text-gray-700">${escapeHtml(c.content)}</div>
            <div class="text-xs text-gray-400 mt-1">
              📷 ${escapeHtml(c.photo_title || '(已删除)')} · ${formatDate(c.created_at)}
            </div>
          </div>`).join('')}</div>`
      : '<p class="text-gray-400 text-sm">未发表过评论</p>';

    body.innerHTML = `
      <div class="flex items-start gap-4 mb-4">
        ${avatarHtml}
        <div class="flex-1">
          <h3 class="text-xl font-bold">${escapeHtml(u.username)}${isMe ? ' <span class="text-sm text-indigo-500">(你自己)</span>' : ''}</h3>
          <p class="text-gray-500">${escapeHtml(u.email)}</p>
          <div class="flex gap-2 mt-2">
            ${u.role === 'admin' ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">管理员</span>' : '<span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">普通用户</span>'}
            ${subInfo}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div><span class="text-gray-500">用户 ID</span><div class="font-medium">#${u.id}</div></div>
        <div><span class="text-gray-500">注册时间</span><div class="font-medium">${formatDate(u.created_at)}</div></div>
        <div><span class="text-gray-500">订阅记录数</span><div class="font-medium">${u.subscriptions.length}</div></div>
        <div><span class="text-gray-500">评论记录数</span><div class="font-medium">${u.comments.length}</div></div>
      </div>

      <div class="border-t pt-4 mt-4">
        <h4 class="font-bold mb-2">🎁 会员操作</h4>
        <div class="flex flex-wrap items-center gap-2">
          ${!isMe ? `
            <input id="grantDaysInput" type="number" min="1" max="3650" value="30" class="w-20 px-2 py-1.5 border rounded">
            <button class="btn-action" onclick="grantSubscription(${u.id})">赠送 / 延长会员</button>
            ${u.isSubscribed ? `<button class="btn-action danger" onclick="revokeSubscription(${u.id})">撤销会员</button>` : ''}
          ` : '<span class="text-gray-400 text-sm">不能操作自己的会员</span>'}
        </div>
      </div>

      <div class="border-t pt-4 mt-4">
        <h4 class="font-bold mb-2">📜 订阅记录</h4>
        ${subsList}
      </div>

      <div class="border-t pt-4 mt-4">
        <h4 class="font-bold mb-2">💬 评论记录</h4>
        ${commentsList}
      </div>

      <div class="border-t pt-4 mt-4">
        <h4 class="font-bold mb-2">🔑 密码管理</h4>
        ${!isMe ? `
          <div class="flex items-center gap-2">
            <input id="newPwdInput" type="text" placeholder="输入新密码（≥6位）" class="flex-1 px-3 py-2 border rounded">
            <button class="btn-action" onclick="adminResetPassword(${u.id})">重置密码</button>
          </div>
        ` : '<span class="text-gray-400 text-sm">请去 /zh/profile 修改自己的密码</span>'}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="text-center py-12 text-red-500">加载失败：${err.message}</div>`;
  }
}

function closeUserDetail() {
  const modal = document.getElementById('userDetailModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function toggleUserRole(id) {
  if (!confirm('确定要切换此用户的角色吗？')) return;
  try {
    const r = await api(`/api/admin/users/${id}/toggle-role`, { method: 'POST' });
    showMessage(r.message, 'success');
    loadUserList(userPage);
    loadUserStats();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('确定要删除此用户吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：所有该用户的评论、订阅记录将保留但失去归属。')) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    showMessage('用户已删除', 'success');
    loadUserList(userPage);
    loadUserStats();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function grantSubscription(id) {
  const days = parseInt(document.getElementById('grantDaysInput').value);
  if (!days || days < 1) {
    showMessage('请输入有效的天数', 'error');
    return;
  }
  try {
    const r = await api(`/api/admin/users/${id}/grant-subscription`, {
      method: 'POST',
      body: { days }
    });
    showMessage(r.message, 'success');
    openUserDetail(id); // 刷新详情
    loadUserStats();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function revokeSubscription(id) {
  if (!confirm('确定撤销该用户的会员资格？')) return;
  try {
    const r = await api(`/api/admin/users/${id}/revoke-subscription`, { method: 'POST' });
    showMessage(r.message, 'success');
    openUserDetail(id);
    loadUserStats();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function adminResetPassword(id) {
  const newPwd = document.getElementById('newPwdInput').value;
  if (!newPwd || newPwd.length < 6) {
    showMessage('请输入至少 6 位的新密码', 'error');
    return;
  }
  if (!confirm(`确定要把用户密码重置为「${newPwd}」吗？`)) return;
  try {
    const r = await api(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: { new_password: newPwd }
    });
    showMessage(r.message, 'success');
    document.getElementById('newPwdInput').value = '';
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

// 照片列表 + 多选
async function loadPhotoList() {
  await Promise.all([loadAllAlbums(), loadAllCategories()]);

  const filterCat = document.getElementById('photoFilterCategory').value;
  const filterAlbum = document.getElementById('photoFilterAlbum').value;
  const params = new URLSearchParams();
  if (filterCat) params.append('category_id', filterCat);
  if (filterAlbum) params.append('album_id', filterAlbum);

  try {
    const photos = await api('/api/photos?' + params.toString());
    const tbody = document.getElementById('photoList');
    if (photos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999">暂无照片</td></tr>';
      return;
    }

    // 获取每张照片的所属摄影集
    const photoAlbumsMap = {};
    photos.forEach(p => {
      if (p.album_ids) {
        p.album_ids.split(',').forEach(aid => {
          if (!photoAlbumsMap[aid]) photoAlbumsMap[aid] = [];
          photoAlbumsMap[aid].push(p.id);
        });
      }
    });

    tbody.innerHTML = photos.map(p => {
      const albumTags = (p.album_ids || '').split(',').filter(Boolean).map(aid => {
        const album = allAlbums.find(a => String(a.id) === aid);
        return album ? `<span class="album-tag">${escapeHtml(album.name)}</span>` : '';
      }).join('');
      return `
        <tr>
          <td><input type="checkbox" class="photo-check" data-id="${p.id}"></td>
          <td><img class="thumb" src="${photoImageUrl(p)}" alt="" loading="lazy" decoding="async"></td>
          <td>${escapeHtml(p.title)}</td>
          <td>${p.category_name || '未分类'}</td>
          <td><div class="album-tags-cell">${albumTags || '<span style="color:#ccc">-</span>'}</div></td>
          <td>${p.is_premium ? '<span class="premium-tag">付费</span>' : '免费'}</td>
          <td>${p.views || 0}</td>
          <td>${formatDate(p.created_at)}</td>
          <td>
            <button class="btn-action" onclick="openPhotoEdit(${p.id})">编辑</button>
            <button class="btn-action danger" onclick="deletePhoto(${p.id})">删除</button>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定复选框
    document.querySelectorAll('.photo-check').forEach(cb => {
      cb.addEventListener('change', updateBatchToolbar);
    });
    selectedPhotoIds.clear();
    updateBatchToolbar();
  } catch (err) {
    showMessage('加载失败: ' + err.message, 'error');
  }
}

function loadCategorySelects() {
  const opts = '<option value="">全部分类</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('photoFilterCategory').innerHTML = opts;

  const batchCatOpts = '<option value="">修改分类...</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') +
    '<option value="__none__">移除分类</option>';
  document.getElementById('batchCategory').innerHTML = batchCatOpts;

  const batchAlbumOpts = '<option value="">加入摄影集...</option>' +
    allAlbums.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  document.getElementById('batchAlbum').innerHTML = batchAlbumOpts;

  const filterAlbumOpts = '<option value="">全部摄影集</option>' +
    allAlbums.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  document.getElementById('photoFilterAlbum').innerHTML = filterAlbumOpts;
}

function updateBatchToolbar() {
  const checked = document.querySelectorAll('.photo-check:checked');
  selectedPhotoIds = new Set(Array.from(checked).map(cb => parseInt(cb.dataset.id)));
  document.getElementById('selectedCount').textContent = selectedPhotoIds.size;
  document.getElementById('batchToolbar').style.display = selectedPhotoIds.size > 0 ? 'flex' : 'none';
}

async function deletePhoto(id) {
  if (!confirm('确认删除这张照片？')) return;
  try {
    await api('/api/photos/' + id, { method: 'DELETE' });
    showMessage('删除成功', 'success');
    loadPhotoList();
  } catch (err) {
    showMessage('删除失败: ' + err.message, 'error');
  }
}

// 批量操作
async function batchUpdateCategory() {
  const catVal = document.getElementById('batchCategory').value;
  if (!catVal) { showMessage('请先选择分类', 'error'); return; }
  const category_id = catVal === '__none__' ? null : parseInt(catVal);
  const ids = Array.from(selectedPhotoIds);
  try {
    await api('/api/photos/batch/update-category', {
      method: 'POST', body: { photo_ids: ids, category_id }
    });
    showMessage(`已将 ${ids.length} 张照片更新分类`, 'success');
    selectedPhotoIds.clear();
    loadPhotoList();
  } catch (err) {
    showMessage('失败: ' + err.message, 'error');
  }
}

async function batchAddToAlbum() {
  const albumId = document.getElementById('batchAlbum').value;
  if (!albumId) { showMessage('请先选择摄影集', 'error'); return; }
  const ids = Array.from(selectedPhotoIds);
  try {
    await api('/api/photos/batch/add-to-album', {
      method: 'POST', body: { photo_ids: ids, album_id: parseInt(albumId) }
    });
    showMessage(`已将 ${ids.length} 张照片加入摄影集`, 'success');
    selectedPhotoIds.clear();
    loadPhotoList();
  } catch (err) {
    showMessage('失败: ' + err.message, 'error');
  }
}

async function batchDelete() {
  const ids = Array.from(selectedPhotoIds);
  if (!confirm(`确认删除选中的 ${ids.length} 张照片？此操作不可恢复！`)) return;
  try {
    await api('/api/photos/batch/delete', { method: 'POST', body: { photo_ids: ids } });
    showMessage(`已删除 ${ids.length} 张照片`, 'success');
    selectedPhotoIds.clear();
    loadPhotoList();
  } catch (err) {
    showMessage('失败: ' + err.message, 'error');
  }
}

// 分类管理
async function loadCategoryList() {
  try {
    const categories = await api('/api/categories');
    allCategories = categories;
    const tbody = document.getElementById('categoryList');
    if (categories.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">暂无分类</td></tr>';
      return;
    }
    tbody.innerHTML = categories.map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.description || '')}</td>
        <td>${formatDate(c.created_at)}</td>
        <td><button class="btn-action danger" onclick="deleteCategory(${c.id})">删除</button></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function loadCategorySelect() {
  try {
    const categories = await api('/api/categories');
    allCategories = categories;
    const select = document.getElementById('photoCategorySelect');
    select.innerHTML = '<option value="">未分类</option>' +
      categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

async function deleteCategory(id) {
  if (!confirm('确认删除此分类？相关照片不会删除，但会变为未分类')) return;
  try {
    await api('/api/categories/' + id, { method: 'DELETE' });
    showMessage('删除成功', 'success');
    loadCategoryList();
  } catch (err) {
    showMessage('删除失败: ' + err.message, 'error');
  }
}

// 摄影集管理
async function loadAlbumList() {
  try {
    const data = await api('/api/albums?page=1&pageSize=100');
    const albums = Array.isArray(data) ? data : (data.items || []);
    allAlbums = albums;
    const tbody = document.getElementById('albumList');
    if (albums.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999">暂无摄影集</td></tr>';
      return;
    }
    tbody.innerHTML = albums.map(a => {
      // 封面优先级：自定义封面 > 选定的照片封面 > 占位
      let cover;
      if (a.custom_cover) {
        cover = `<img src="/uploads/${a.custom_cover}" alt="">`;
      } else if (a.cover_filename) {
        cover = `<img src="/uploads/${a.cover_filename}" alt="">`;
      } else {
        cover = '📚';
      }
      const customBadge = a.custom_cover
        ? `<span class="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">自定义</span>`
        : '';
      return `
        <tr>
          <td><div class="album-cover">${cover}</div></td>
          <td>${escapeHtml(a.name)}${customBadge}</td>
          <td>${escapeHtml(a.description || '')}</td>
          <td>${a.photo_count} 张</td>
          <td>${formatDate(a.created_at)}</td>
          <td>
            <label class="btn-action" style="cursor:pointer">
              📷 自定义封面
              <input type="file" accept="image/*" data-album-id="${a.id}" class="album-cover-input hidden">
            </label>
            ${a.custom_cover ? `<button class="btn-action" onclick="removeCustomCover(${a.id})">移除封面</button>` : ''}
            <button class="btn-action danger" onclick="deleteAlbum(${a.id})">删除</button>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定封面上传
    tbody.querySelectorAll('.album-cover-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const albumId = e.target.dataset.albumId;
        if (!file) return;
        await uploadAlbumCover(albumId, file);
      });
    });
  } catch (err) {
    console.error(err);
  }
}

async function uploadAlbumCover(albumId, file) {
  const formData = new FormData();
  formData.append('cover', file);
  try {
    await api(`/api/albums/${albumId}/cover-upload`, { method: 'POST', body: formData });
    showMessage('封面上传成功', 'success');
    loadAlbumList();
  } catch (err) {
    showMessage('封面上传失败: ' + err.message, 'error');
  }
}

async function removeCustomCover(albumId) {
  if (!confirm('确认移除自定义封面？将回到默认封面或照片封面')) return;
  try {
    await api(`/api/albums/${albumId}/cover-upload`, { method: 'DELETE' });
    showMessage('已移除自定义封面', 'success');
    loadAlbumList();
  } catch (err) {
    showMessage('失败: ' + err.message, 'error');
  }
}

async function loadAlbumCheckboxes() {
  await loadAllAlbums();
  const container = document.getElementById('albumCheckboxes');
  if (allAlbums.length === 0) {
    container.innerHTML = '<span style="color:#999;font-size:13px">还没有摄影集，先去「摄影集」页面创建</span>';
  } else {
    container.innerHTML = allAlbums.map(a => `
      <label><input type="checkbox" value="${a.id}"> ${escapeHtml(a.name)}</label>
    `).join('');
  }
}

async function deleteAlbum(id) {
  if (!confirm('确认删除此摄影集？照片本身不会被删除，只是从该摄影集中移除')) return;
  try {
    await api('/api/albums/' + id, { method: 'DELETE' });
    showMessage('删除成功', 'success');
    loadAlbumList();
  } catch (err) {
    showMessage('删除失败: ' + err.message, 'error');
  }
}

// 评论管理
async function loadCommentList() {
  try {
    const comments = await api('/api/comments/all');
    const tbody = document.getElementById('commentList');
    if (comments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">暂无评论</td></tr>';
      return;
    }
    tbody.innerHTML = comments.map(c => `
      <tr>
        <td>${escapeHtml(c.username || '已删除用户')}</td>
        <td>${escapeHtml(c.photo_title || '-')}</td>
        <td>${escapeHtml(c.content)}</td>
        <td>${formatDate(c.created_at)}</td>
        <td><button class="btn-action danger" onclick="deleteComment(${c.id})">删除</button></td>
      </tr>
    `).join('');
  } catch (err) {
    showMessage('加载失败: ' + err.message, 'error');
  }
}

async function deleteComment(id) {
  if (!confirm('确认删除此评论？')) return;
  try {
    await api('/api/comments/' + id, { method: 'DELETE' });
    showMessage('删除成功', 'success');
    loadCommentList();
  } catch (err) {
    showMessage('删除失败: ' + err.message, 'error');
  }
}

// 订单管理
async function loadOrderList() {
  try {
    const orders = await api('/api/subscriptions/orders');
    const tbody = document.getElementById('orderList');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999">暂无订单</td></tr>';
      return;
    }
    const planNames = { monthly: '月度会员', yearly: '年度会员', lifetime: '终身会员' };
    tbody.innerHTML = orders.map(o => {
      const symbol = o.currency === 'USD' ? '$' : '¥';
      return `
      <tr>
        <td>#${o.id}</td>
        <td>${escapeHtml(o.username || '')}<br><small style="color:#999">${escapeHtml(o.email || '')}</small></td>
        <td>${planNames[o.plan_type] || o.plan_type}</td>
        <td><strong>${symbol}${o.amount}</strong> <small style="color:#999">${o.currency}</small></td>
        <td>${o.status === 'completed' ? '<span style="color:#10b981">已完成</span>' : '<span style="color:#f59e0b">待支付</span>'}</td>
        <td>${formatDate(o.created_at)}</td>
      </tr>
    `;
    }).join('');
  } catch (err) {
    showMessage('加载失败: ' + err.message, 'error');
  }
}

// ====== 批量上传 ======
let selectedFiles = [];

function setupUpload() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('photoFiles');
  const previewGrid = document.getElementById('previewGrid');
  const fileCount = document.getElementById('fileCount');

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    addFiles(Array.from(e.target.files));
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    addFiles(files);
  });

  function addFiles(files) {
    // 客户端预校验：单张不能超过 10MB，只接受图片格式
    const MAX_SIZE = 10 * 1024 * 1024;
    const validTypes = /^image\/(jpeg|jpg|png|gif|webp)$/;
    const accepted = [];
    const rejected = [];
    for (const f of files) {
      if (!validTypes.test(f.type)) {
        rejected.push(`"${f.name}" 不是支持的图片格式`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        const sizeMB = (f.size / 1024 / 1024).toFixed(1);
        rejected.push(`"${f.name}" 太大 (${sizeMB}MB)，单张图片不能超过 10MB`);
        continue;
      }
      accepted.push(f);
    }
    if (rejected.length > 0) {
      showMessage(rejected.join('；'), 'error');
    }
    selectedFiles = [...selectedFiles, ...accepted].slice(0, 50);
    renderPreview();
  }

  function renderPreview() {
    if (selectedFiles.length === 0) {
      document.getElementById('previewArea').style.display = 'none';
      document.getElementById('dropzoneContent').style.display = 'block';
      return;
    }
    document.getElementById('previewArea').style.display = 'block';
    document.getElementById('dropzoneContent').style.display = 'none';
    fileCount.textContent = `已选 ${selectedFiles.length} 张照片 (单次最多 50 张)`;
    previewGrid.innerHTML = selectedFiles.map((f, i) => {
      const url = URL.createObjectURL(f);
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      return `<div class="preview-item" data-idx="${i}">
        <img src="${url}" alt="">
        <button type="button" class="preview-remove" data-idx="${i}" title="从待上传列表中移除">×</button>
        <div class="preview-name">
          <span class="preview-name-text">${escapeHtml(f.name)}</span>
          <span class="preview-size">${sizeMB}MB</span>
        </div>
      </div>`;
    }).join('');
  }

  // 预览列表点击事件代理：点击 × 按钮移除对应文件
  previewGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.preview-remove');
    if (!btn) return;
    // 阻止冒泡到 dropzone，避免触发"打开文件选择器"
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(btn.dataset.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= selectedFiles.length) return;
    // 释放该文件的预览 URL 防止内存泄漏
    const removed = selectedFiles[idx];
    if (removed) {
      try {
        const img = previewGrid.querySelector(`.preview-item[data-idx="${idx}"] img`);
        if (img && img.src) URL.revokeObjectURL(img.src);
      } catch (_) {}
    }
    selectedFiles.splice(idx, 1);
    renderPreview();
  });

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      showMessage('请先选择照片', 'error');
      return;
    }

    const title = document.getElementById('photoTitleInput').value.trim();
    if (!title) {
      showMessage('请输入标题', 'error');
      return;
    }

    const msg = document.getElementById('uploadMsg');
    msg.textContent = `正在上传 ${selectedFiles.length} 张照片...`;
    msg.className = 'form-msg';
    msg.style.display = 'block';

    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('images', f));
    formData.append('title', title);
    formData.append('description', document.getElementById('photoDesc').value);
    formData.append('category_id', document.getElementById('photoCategorySelect').value);
    formData.append('is_premium', document.getElementById('photoPremium').value);

    const checkedAlbums = Array.from(document.querySelectorAll('#albumCheckboxes input:checked'))
      .map(cb => cb.value);
    if (checkedAlbums.length > 0) {
      formData.append('album_ids', checkedAlbums.join(','));
    }

    try {
      const data = await api('/api/photos', { method: 'POST', body: formData });

      msg.textContent = `✅ ${data.message}！可在下方对每张单独编辑`;
      msg.className = 'form-msg success';

      // 显示刚上传的照片，可逐张编辑
      showUploadedPhotos(data.ids);
      selectedFiles = [];
      renderPreview();
      document.getElementById('uploadForm').reset();
    } catch (err) {
      msg.textContent = '上传失败: ' + err.message;
      msg.className = 'form-msg error';
    }
  });
}

// 上传后逐张编辑
async function showUploadedPhotos(ids) {
  if (!ids || ids.length === 0) return;
  await Promise.all([loadAllCategories(), loadAllAlbums()]);

  const editor = document.getElementById('uploadedEditor');
  const list = document.getElementById('uploadedList');
  editor.style.display = 'block';

  // 拉取每张照片详情
  const photos = [];
  for (const id of ids) {
    try {
      const p = await api('/api/photos/' + id);
      photos.push(p);
    } catch (e) {}
  }

  list.innerHTML = photos.map(p => `
    <div class="uploaded-item" onclick="openPhotoEdit(${p.id})">
      <img src="${photoImageUrl(p)}" alt="" loading="lazy" decoding="async">
      <div class="uploaded-info">
        <div class="uploaded-title">${escapeHtml(p.title)}</div>
        <div style="color:#888">${p.is_premium ? '付费' : '免费'} · ${p.category_name || '未分类'}</div>
      </div>
    </div>
  `).join('');

  editor.scrollIntoView({ behavior: 'smooth' });
}

// 照片编辑弹窗
let editingPhotoId = null;
async function openPhotoEdit(id) {
  editingPhotoId = id;
  await Promise.all([loadAllCategories(), loadAllAlbums()]);

  try {
    const photo = await api('/api/photos/' + id);
    document.getElementById('modalPhotoImg').src = photoImageUrl(photo);
    document.getElementById('modalTitle').value = photo.title;
    document.getElementById('modalDesc').value = photo.description || '';
    document.getElementById('modalPremium').value = photo.is_premium ? 'true' : 'false';

    const catSelect = document.getElementById('modalCategory');
    catSelect.innerHTML = '<option value="">未分类</option>' +
      allCategories.map(c => `<option value="${c.id}" ${c.id === photo.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

    // 加载照片所属摄影集
    const photoAlbums = (photo.albums || '').split(',').filter(Boolean).map(s => s.split(':')[0]);
    const albumContainer = document.getElementById('modalAlbumChecks');
    if (allAlbums.length === 0) {
      albumContainer.innerHTML = '<span style="color:#999;font-size:13px">还没有摄影集</span>';
    } else {
      albumContainer.innerHTML = allAlbums.map(a => `
        <label><input type="checkbox" value="${a.id}" ${photoAlbums.includes(String(a.id)) ? 'checked' : ''}> ${escapeHtml(a.name)}</label>
      `).join('');
    }

    document.getElementById('photoEditModal').style.display = 'flex';
  } catch (err) {
    showMessage('加载失败: ' + err.message, 'error');
  }
}

function setupModal() {
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('photoEditModal').style.display = 'none';
  });

  document.getElementById('modalSaveBtn').addEventListener('click', async () => {
    if (!editingPhotoId) return;
    const title = document.getElementById('modalTitle').value.trim();
    if (!title) { showMessage('请输入标题', 'error'); return; }

    const albumIds = Array.from(document.querySelectorAll('#modalAlbumChecks input:checked'))
      .map(cb => parseInt(cb.value));

    try {
      // 保存基础信息
      await api('/api/photos/' + editingPhotoId, {
        method: 'PUT',
        body: {
          title,
          description: document.getElementById('modalDesc').value,
          category_id: document.getElementById('modalCategory').value || null,
          is_premium: document.getElementById('modalPremium').value
        }
      });
      // 保存摄影集
      await api('/api/photos/' + editingPhotoId + '/albums', {
        method: 'PUT', body: { album_ids: albumIds }
      });
      showMessage('保存成功', 'success');
      document.getElementById('photoEditModal').style.display = 'none';
      loadPhotoList();
    } catch (err) {
      showMessage('保存失败: ' + err.message, 'error');
    }
  });
}

// 快速新建摄影集
function setupQuickAlbum() {
  document.getElementById('newAlbumQuickBtn').addEventListener('click', async () => {
    const name = prompt('请输入摄影集名称');
    if (!name || !name.trim()) return;
    try {
      await api('/api/albums', { method: 'POST', body: { name: name.trim() } });
      showMessage('摄影集创建成功', 'success');
      await loadAlbumCheckboxes();
      await loadAllAlbums();
    } catch (err) {
      showMessage('创建失败: ' + err.message, 'error');
    }
  });
}

// 其他表单
function setupCategoryForm() {
  document.getElementById('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newCategoryName').value.trim();
    const description = document.getElementById('newCategoryDesc').value.trim();
    try {
      await api('/api/categories', { method: 'POST', body: { name, description } });
      showMessage('分类添加成功', 'success');
      e.target.reset();
      await loadAllCategories();
      loadCategoryList();
    } catch (err) {
      showMessage('添加失败: ' + err.message, 'error');
    }
  });
}

function setupAlbumForm() {
  document.getElementById('albumForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newAlbumName').value.trim();
    const description = document.getElementById('newAlbumDesc').value.trim();
    const coverFile = document.getElementById('newAlbumCover').files[0];

    try {
      // 1. 创建摄影集
      const result = await api('/api/albums', { method: 'POST', body: { name, description } });
      // 2. 如果选了封面，再上传
      if (coverFile && result.id) {
        const formData = new FormData();
        formData.append('cover', coverFile);
        await api(`/api/albums/${result.id}/cover-upload`, { method: 'POST', body: formData });
      }
      showMessage('摄影集创建成功', 'success');
      e.target.reset();
      loadAlbumList();
    } catch (err) {
      showMessage('创建失败: ' + err.message, 'error');
    }
  });
}

function setupFilters() {
  document.getElementById('photoFilterCategory').addEventListener('change', loadPhotoList);
  document.getElementById('photoFilterAlbum').addEventListener('change', loadPhotoList);
  document.getElementById('selectAll').addEventListener('change', (e) => {
    document.querySelectorAll('.photo-check').forEach(cb => cb.checked = e.target.checked);
    updateBatchToolbar();
  });
  document.getElementById('batchUpdateCategoryBtn').addEventListener('click', batchUpdateCategory);
  document.getElementById('batchAddToAlbumBtn').addEventListener('click', batchAddToAlbum);
  document.getElementById('batchDeleteBtn').addEventListener('click', batchDelete);
  document.getElementById('batchClearBtn').addEventListener('click', () => {
    document.querySelectorAll('.photo-check').forEach(cb => cb.checked = false);
    document.getElementById('selectAll').checked = false;
    updateBatchToolbar();
  });
}

// 修改密码弹窗逻辑
function setupPasswordModal() {
  const modal = document.getElementById('passwordModal');
  const openBtn = document.getElementById('changePasswordBtn');
  const closeBtn = document.getElementById('passwordModalClose');
  const saveBtn = document.getElementById('passwordSaveBtn');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      document.getElementById('oldPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('passwordMsg').classList.add('hidden');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const oldPwd = document.getElementById('oldPassword').value;
      const newPwd = document.getElementById('newPassword').value;
      const confirmPwd = document.getElementById('confirmPassword').value;
      const msg = document.getElementById('passwordMsg');

      // 前端校验
      if (!oldPwd || !newPwd || !confirmPwd) {
        msg.textContent = '请填写所有字段';
        msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
        msg.classList.remove('hidden');
        return;
      }
      if (newPwd.length < 6) {
        msg.textContent = '新密码至少 6 位';
        msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
        msg.classList.remove('hidden');
        return;
      }
      if (newPwd !== confirmPwd) {
        msg.textContent = '两次输入的新密码不一致';
        msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
        msg.classList.remove('hidden');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: { old_password: oldPwd, new_password: newPwd }
        });
        msg.textContent = '✅ 密码修改成功！请重新登录';
        msg.className = 'px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700';
        msg.classList.remove('hidden');
        showMessage('密码修改成功，即将登出', 'success');
        // 2 秒后登出
        setTimeout(async () => {
          await api('/api/auth/logout', { method: 'POST' });
          const lang = localStorage.getItem('preferred_lang') || 'zh';
          location.href = '/' + lang + '/login';
        }, 2000);
      } catch (err) {
        msg.textContent = err.message || '修改失败';
        msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
        msg.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存新密码';
      }
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await getCurrentUser();

  if (!currentUser || currentUser.role !== 'admin') {
    alert('需要管理员权限');
    // 后台登出跳到语言前缀的登录页
    const lang = localStorage.getItem('preferred_lang') || 'zh';
    location.href = '/' + lang + '/login';
    return;
  }

  document.getElementById('adminName').textContent = currentUser.username;
  document.getElementById('adminLogout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    const lang = localStorage.getItem('preferred_lang') || 'zh';
    location.href = '/' + lang + '/login';
  });

  document.querySelectorAll('.admin-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  // 用户管理：搜索 / 模态框关闭
  const userSearchBtn = document.getElementById('userSearchBtn');
  const userSearchInput = document.getElementById('userSearchInput');
  const userRoleFilter = document.getElementById('userRoleFilter');
  if (userSearchBtn) userSearchBtn.addEventListener('click', () => loadUserList(1));
  if (userSearchInput) {
    userSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') loadUserList(1);
    });
  }
  if (userRoleFilter) userRoleFilter.addEventListener('change', () => loadUserList(1));
  const userDetailClose = document.getElementById('userDetailClose');
  if (userDetailClose) userDetailClose.addEventListener('click', closeUserDetail);
  const userDetailModal = document.getElementById('userDetailModal');
  if (userDetailModal) {
    userDetailModal.addEventListener('click', e => {
      if (e.target === userDetailModal) closeUserDetail();
    });
  }

  setupUpload();
  setupModal();
  setupQuickAlbum();
  setupCategoryForm();
  setupAlbumForm();
  setupFilters();
  setupPasswordModal();

  loadStats();
});
