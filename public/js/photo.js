let currentUser = null;
let photoId = null;

// 付费未订阅时的占位图（深色块），保持布局高度且不加载真实原图
const LOCK_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#1f2937"/></svg>'
);

async function loadPhoto() {
  photoId = location.pathname.split('/').pop();

  // 处理从摄影集页进入的情况，调整返回链接
  setupBackLink();

  try {
    const photo = await api('/api/photos/' + photoId);
    currentUser = await getCurrentUser();

    document.getElementById('photoTitle').textContent = photo.title;
    document.getElementById('photoDescription').textContent = photo.description || '';
    document.getElementById('photoViews').textContent = photo.views;
    document.getElementById('photoDate').textContent = formatDate(photo.created_at);

    if (photo.locked) {
      // 未订阅的付费作品：不加载真实原图，用深色占位 + 遮罩
      document.getElementById('photoImage').src = LOCK_PLACEHOLDER;
      document.getElementById('photoImage').alt = photo.title;
      document.getElementById('premiumOverlay').classList.remove('hidden');
      document.getElementById('premiumOverlay').classList.add('flex');
    } else {
      document.getElementById('photoImage').src = photoImageUrl(photo);
      document.getElementById('photoImage').alt = photo.title;
    }

    if (photo.category_name) {
      document.getElementById('photoCategory').textContent = photo.category_name;
      document.getElementById('photoCategory').classList.remove('hidden');
    }

    if (photo.is_premium && subscriptionEnabled()) {
      document.getElementById('photoPremium').classList.remove('hidden');
    }

    if (currentUser) {
      document.getElementById('commentForm').classList.remove('hidden');
    } else {
      document.getElementById('loginToComment').classList.remove('hidden');
    }

    await loadComments();
    await renderUserStatus();
  } catch (err) {
    showMessage('加载失败: ' + err.message, 'error');
  }
}

async function loadComments() {
  try {
    const data = await api('/api/comments/photo/' + photoId);
    // 兼容旧接口（直接返回数组）；新接口返回 {total, tree}
    const tree = Array.isArray(data) ? data : (data.tree || []);
    const total = Array.isArray(data) ? data.length : (data.total || tree.length);

    document.getElementById('commentCount').textContent = total;
    const list = document.getElementById('commentList');
    if (total === 0) {
      list.innerHTML = `<p class="text-center text-gray-400 py-8">${window.i18n.t('photo.noComments')}</p>`;
      return;
    }
    list.innerHTML = tree.map(c => renderComment(c, 0)).join('');

    // 绑定回复按钮事件
    list.querySelectorAll('.reply-btn').forEach(btn => {
      btn.addEventListener('click', () => openReplyForm(btn.dataset.id, btn.dataset.username, btn.dataset.userid));
    });
    list.querySelectorAll('.reply-cancel').forEach(btn => {
      btn.addEventListener('click', () => closeReplyForm(btn.dataset.id));
    });
    list.querySelectorAll('.reply-submit').forEach(btn => {
      btn.addEventListener('click', () => submitReply(btn.dataset.id));
    });
  } catch (err) { console.error(err); }
}

// 递归渲染一条评论（YouTube 风格：缩进 + 回复按钮 + 内联回复框）
function renderComment(c, depth) {
  // 顶层评论（depth=0）不缩进；所有回复（depth>=1）共享同一个缩进位置，不再嵌套向右推
  const indentClass = depth >= 1 ? 'comment-indented' : '';
  const repliesHtml = (c.replies || []).map(r => renderComment(r, depth + 1)).join('');
  const isLoggedIn = !!currentUser;
  const replyText = window.i18n && window.i18n.t ? window.i18n.t('photo.reply') : '回复';
  const placeholder = window.i18n && window.i18n.t ? window.i18n.t('photo.commentPlaceholder') : '写下你的评论...';
  const submitText = window.i18n && window.i18n.t ? window.i18n.t('photo.submitComment') : '发表';
  const cancelText = window.i18n && window.i18n.t ? window.i18n.t('photo.cancel') : '取消';

  return `
    <div class="comment-node ${indentClass}" data-id="${c.id}">
      <div class="flex gap-3 py-3 border-b border-gray-100">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          ${escapeHtml(((c.username || '') + '?').charAt(0).toUpperCase())}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="font-medium text-gray-900">${escapeHtml(c.username || '匿名')}</span>
            ${c.reply_to_username ? `<span class="text-xs text-gray-500">回复</span><span class="text-xs text-gray-700 font-medium">@${escapeHtml(c.reply_to_username)}</span>` : ''}
            <span class="text-xs text-gray-400">${formatDate(c.created_at)}</span>
          </div>
          <p class="text-gray-700 text-sm whitespace-pre-wrap break-words">${escapeHtml(c.content)}</p>
          ${isLoggedIn ? `<div class="mt-1.5 flex items-center gap-3 text-xs">
            <button type="button" class="reply-btn text-indigo-600 hover:text-indigo-700 font-medium" data-id="${c.id}" data-username="${escapeHtml(c.username || '')}" data-userid="${c.user_id}">↩ ${replyText}</button>
          </div>` : ''}
        </div>
      </div>
      <div class="reply-form-wrap" data-id="${c.id}" style="display:none;"></div>
      <div class="replies-container">${repliesHtml}</div>
    </div>
  `;
}

function openReplyForm(commentId, username, userId) {
  // 关闭其它已打开的回复框
  document.querySelectorAll('.reply-form-wrap').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });

  const wrap = document.querySelector(`.reply-form-wrap[data-id="${commentId}"]`);
  if (!wrap) return;

  const placeholder = window.i18n && window.i18n.t ? window.i18n.t('photo.commentPlaceholder') : '写下你的评论...';
  const submitText = window.i18n && window.i18n.t ? window.i18n.t('photo.submitComment') : '发表';
  const cancelText = window.i18n && window.i18n.t ? window.i18n.t('photo.cancel') : '取消';

  wrap.innerHTML = `
    <div class="ml-12 mb-3 mt-1 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div class="text-xs text-gray-500 mb-2">@${escapeHtml(username)}</div>
      <textarea class="reply-textarea w-full px-3 py-2 border border-gray-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" rows="2" maxlength="500" placeholder="${placeholder}"></textarea>
      <div class="flex justify-end gap-2 mt-2">
        <button type="button" class="reply-cancel px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800" data-id="${commentId}">${cancelText}</button>
        <button type="button" class="reply-submit px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium" data-id="${commentId}" data-userid="${userId}">${submitText}</button>
      </div>
    </div>
  `;
  wrap.style.display = 'block';
  const ta = wrap.querySelector('textarea');
  if (ta) { ta.focus(); }

  // 绑定本次新建的按钮
  wrap.querySelector('.reply-cancel').addEventListener('click', () => closeReplyForm(commentId));
  wrap.querySelector('.reply-submit').addEventListener('click', () => submitReply(commentId));
}

function closeReplyForm(commentId) {
  const wrap = document.querySelector(`.reply-form-wrap[data-id="${commentId}"]`);
  if (!wrap) return;
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}

async function submitReply(parentId) {
  const wrap = document.querySelector(`.reply-form-wrap[data-id="${parentId}"]`);
  if (!wrap) return;
  const ta = wrap.querySelector('textarea');
  const btn = wrap.querySelector('.reply-submit');
  if (!ta || !btn) return;

  const content = ta.value.trim();
  if (!content) {
    ta.focus();
    return;
  }

  const userId = parseInt(btn.dataset.userid, 10) || null;
  const submitText = btn.textContent;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    await api('/api/comments', {
      method: 'POST',
      body: {
        photo_id: parseInt(photoId, 10),
        content,
        parent_id: parseInt(parentId, 10),
        reply_to_user_id: userId
      }
    });
    closeReplyForm(parentId);
    showMessage(window.i18n && window.i18n.t ? window.i18n.t('photo.commentSuccess') : '回复成功', 'success');
    await loadComments();
  } catch (err) {
    showMessage(err.message, 'error');
    btn.disabled = false;
    btn.textContent = submitText;
  }
}

async function submitComment() {
  const content = document.getElementById('commentInput').value.trim();
  if (!content) { showMessage(window.i18n.t('photo.commentPlaceholder'), 'error'); return; }
  try {
    await api('/api/comments', { method: 'POST', body: { photo_id: parseInt(photoId), content } });
    document.getElementById('commentInput').value = '';
    showMessage(window.i18n.t('photo.commentSuccess'), 'success');
    await loadComments();
  } catch (err) { showMessage(err.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPhoto();
  const btn = document.getElementById('submitComment');
  if (btn) btn.addEventListener('click', submitComment);
});

// 根据 URL 中的 from=album&id=X 参数，调整返回链接为「返回作品集」并指向对应摄影集
function setupBackLink() {
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const albumId = params.get('id');
  if (from !== 'album' || !albumId) return; // 默认仍指向作品列表

  const backLink = document.getElementById('backLink');
  const backText = document.getElementById('backLinkText');
  if (!backLink || !backText) return;

  // 根据当前页面语言推断前缀（保留 i18n 切换能力）
  const path = location.pathname;
  const langPrefix = path.startsWith('/en') ? '/en' : (path.startsWith('/zh') ? '/zh' : '');
  backLink.setAttribute('href', (langPrefix || '') + '/album/' + albumId);

  // 切换 i18n key 与文本
  if (backText.dataset.i18n) backText.dataset.i18n = 'albums.backToAlbum';
  backText.textContent = window.i18n && window.i18n.t ? window.i18n.t('albums.backToAlbum') : '返回作品集';
}
