const express = require('express');
const path = require('path');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin, optionalAuth, canViewPremium } = require('../middleware/auth');
const { upload } = require('./categories');
const { getImageDimensions } = require('../utils/imageDimensions');

const router = express.Router();

// 付费门控：未订阅 / 非管理员的付费照片，隐藏文件名并标记 locked
function sanitizePhoto(p, canView) {
  if (p.is_premium && !canView) {
    return { ...p, filename: null, locked: true };
  }
  return { ...p, locked: false };
}

// 获取所有照片（前端展示，支持分页 + 搜索）
router.get('/', optionalAuth, (req, res) => {
  const { category_id, album_id, premium, keyword, page, pageSize } = req.query;

  // 分页参数（默认 page=1, pageSize=24；上限 100）
  const pageNum = Math.max(1, parseInt(page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize) || 24));
  const offset = (pageNum - 1) * size;

  // SQL 条件
  const where_ = [];
  const params = [];
  if (category_id) {
    where_.push('p.category_id = ?');
    params.push(category_id);
  }
  if (album_id) {
    where_.push('p.id IN (SELECT photo_id FROM photo_albums WHERE album_id = ?)');
    params.push(album_id);
  }
  if (premium !== undefined) {
    where_.push('p.is_premium = ?');
    params.push(premium === 'true' ? 1 : 0);
  }
  // 关键字搜索（标题 / 描述 / 分类名）
  const kw = (keyword || '').trim();
  if (kw) {
    where_.push('(p.title LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like, like);
  }
  const whereSql = where_.length ? ' WHERE ' + where_.join(' AND ') : '';

  // 1. 先查总数（用于分页）
  db.get(`SELECT COUNT(*) AS total FROM photos p LEFT JOIN categories c ON p.category_id = c.id${whereSql}`, params, (err, countRow) => {
    if (err) {
      console.error('查询照片总数错误:', err);
      return res.status(500).json({ error: '服务器错误' });
    }
    const total = countRow.total;
    const totalPages = Math.max(1, Math.ceil(total / size));

    // 2. 再查当前页数据
    const sql = `
      SELECT p.*, c.name as category_name,
             (SELECT GROUP_CONCAT(album_id, ',') FROM photo_albums WHERE photo_id = p.id) as album_ids
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereSql}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `;
    db.all(sql, [...params, size, offset], (err, photos) => {
      if (err) {
        console.error('查询照片错误:', err);
        return res.status(500).json({ error: '服务器错误' });
      }
      const canView = canViewPremium(req);
      res.json({
        items: photos.map(p => sanitizePhoto(p, canView)),
        pagination: {
          page: pageNum,
          pageSize: size,
          total,
          totalPages
        }
      });
    });
  });
});

// 获取单个照片详情
router.get('/:id', optionalAuth, (req, res) => {
  const photoId = req.params.id;

  // 增加浏览次数
  db.run('UPDATE photos SET views = views + 1 WHERE id = ?', [photoId]);

  db.get(
    `SELECT p.*, c.name as category_name,
            (SELECT GROUP_CONCAT(a.id || ':' || a.name, ',') FROM photo_albums pa
             JOIN albums a ON pa.album_id = a.id WHERE pa.photo_id = p.id) as albums
     FROM photos p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id = ?`,
    [photoId],
    (err, photo) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!photo) return res.status(404).json({ error: '照片不存在' });
      res.json(sanitizePhoto(photo, canViewPremium(req)));
    }
  );
});

// 获取照片图片（付费内容需鉴权；普通照片也走此接口以统一鉴权逻辑）
router.get('/:id/image', optionalAuth, (req, res) => {
  db.get('SELECT filename, is_premium FROM photos WHERE id = ?', [req.params.id], (err, photo) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!photo) return res.status(404).json({ error: '照片不存在' });

    if (photo.is_premium && !canViewPremium(req)) {
      return res.status(403).json({ error: '请订阅后查看付费作品' });
    }

    const filePath = path.join(__dirname, '..', 'public', 'uploads', photo.filename);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
});

// 上传照片（管理员）- 支持多文件批量上传
router.post('/', authenticateToken, requireAdmin, upload.array('images', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请选择要上传的图片' });
  }

  const { title, description, category_id, is_premium, album_ids } = req.body;

  if (!title) {
    // 删除已上传的文件
    req.files.forEach(f => require('fs').unlink(f.path, () => {}));
    return res.status(400).json({ error: '请输入照片标题' });
  }

  const premium = is_premium === 'true' || is_premium === '1' ? 1 : 0;
  const albumIdList = album_ids ? album_ids.split(',').filter(Boolean).map(Number) : [];

  // 为每张图生成独立标题（如果只有 1 张就用原标题，多张则自动加序号）
  const titles = req.files.length === 1
    ? [title]
    : req.files.map((f, i) => `${title} (${i + 1}/${req.files.length})`);

  const insertedIds = [];

  // 串行插入以保证 ID 顺序
  let index = 0;
  function insertNext() {
    if (index >= req.files.length) {
      // 全部插入完成，处理摄影集关联
      if (albumIdList.length > 0 && insertedIds.length > 0) {
        const stmt = db.prepare('INSERT OR IGNORE INTO photo_albums (photo_id, album_id) VALUES (?, ?)');
        insertedIds.forEach(pid => {
          albumIdList.forEach(aid => stmt.run(pid, aid));
        });
        stmt.finalize();
      }
      return res.json({
        success: true,
        count: insertedIds.length,
        ids: insertedIds,
        message: `成功上传 ${insertedIds.length} 张照片`
      });
    }

    const file = req.files[index];
    const photoTitle = titles[index];

    // 尝试读取图片尺寸（失败回退为 NULL，渲染侧使用 3:2 默认占位）
    const dims = getImageDimensions(file.path) || { width: null, height: null };

    db.run(
      'INSERT INTO photos (title, description, filename, category_id, is_premium, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [photoTitle, description || '', file.filename, category_id || null, premium, dims.width, dims.height],
      function (err) {
        if (err) {
          console.error('保存照片错误:', err);
          // 删除失败的文件
          require('fs').unlink(file.path, () => {});
        } else {
          insertedIds.push(this.lastID);
        }
        index++;
        insertNext();
      }
    );
  }
  insertNext();
});

// 批量修改照片分类（管理员）
router.post('/batch/update-category', authenticateToken, requireAdmin, (req, res) => {
  const { photo_ids, category_id } = req.body;
  if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
    return res.status(400).json({ error: '请选择照片' });
  }

  const placeholders = photo_ids.map(() => '?').join(',');
  db.run(
    `UPDATE photos SET category_id = ? WHERE id IN (${placeholders})`,
    [category_id || null, ...photo_ids],
    function (err) {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ success: true, affected: this.changes });
    }
  );
});

// 批量加入摄影集（管理员）
router.post('/batch/add-to-album', authenticateToken, requireAdmin, (req, res) => {
  const { photo_ids, album_id } = req.body;
  if (!Array.isArray(photo_ids) || photo_ids.length === 0 || !album_id) {
    return res.status(400).json({ error: '参数错误' });
  }

  const stmt = db.prepare('INSERT OR IGNORE INTO photo_albums (photo_id, album_id) VALUES (?, ?)');
  let count = 0;
  photo_ids.forEach(pid => {
    stmt.run(pid, album_id, function (err) {
      if (!err) count++;
    });
  });
  stmt.finalize(() => {
    res.json({ success: true, count });
  });
});

// 批量从摄影集移除（管理员）
router.post('/batch/remove-from-album', authenticateToken, requireAdmin, (req, res) => {
  const { photo_ids, album_id } = req.body;
  if (!Array.isArray(photo_ids) || photo_ids.length === 0 || !album_id) {
    return res.status(400).json({ error: '参数错误' });
  }

  const placeholders = photo_ids.map(() => '?').join(',');
  db.run(
    `DELETE FROM photo_albums WHERE album_id = ? AND photo_id IN (${placeholders})`,
    [album_id, ...photo_ids],
    function (err) {
      if (err) return res.status(500).json({ error: '操作失败' });
      res.json({ success: true, affected: this.changes });
    }
  );
});

// 批量删除（管理员）
router.post('/batch/delete', authenticateToken, requireAdmin, (req, res) => {
  const { photo_ids } = req.body;
  if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
    return res.status(400).json({ error: '请选择照片' });
  }

  // 先获取文件路径
  const placeholders = photo_ids.map(() => '?').join(',');
  db.all(`SELECT filename FROM photos WHERE id IN (${placeholders})`, photo_ids, (err, rows) => {
    if (err) return res.status(500).json({ error: '服务器错误' });

    // 删除文件
    const fs = require('fs');
    const path = require('path');
    rows.forEach(r => {
      if (r.filename) {
        const fp = path.join(__dirname, '..', 'public', 'uploads', r.filename);
        fs.unlink(fp, () => {});
      }
    });

    db.run(`DELETE FROM photos WHERE id IN (${placeholders})`, photo_ids, function (err) {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true, deleted: this.changes });
    });
  });
});

// 更新单张照片（管理员）- 用于上传后逐张编辑
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { title, description, category_id, is_premium } = req.body;
  const premium = is_premium === 'true' || is_premium === '1' ? 1 : 0;

  db.run(
    'UPDATE photos SET title = ?, description = ?, category_id = ?, is_premium = ? WHERE id = ?',
    [title, description || '', category_id || null, premium, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ success: true });
    }
  );
});

// 设置照片所属摄影集（管理员）
router.put('/:id/albums', authenticateToken, requireAdmin, (req, res) => {
  const photoId = req.params.id;
  const { album_ids } = req.body; // 数组
  if (!Array.isArray(album_ids)) {
    return res.status(400).json({ error: '参数错误' });
  }

  db.serialize(() => {
    db.run('DELETE FROM photo_albums WHERE photo_id = ?', [photoId]);
    const stmt = db.prepare('INSERT INTO photo_albums (photo_id, album_id) VALUES (?, ?)');
    album_ids.forEach(aid => stmt.run(photoId, aid));
    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ success: true });
    });
  });
});

// 删除照片（管理员）
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  db.get('SELECT filename FROM photos WHERE id = ?', [req.params.id], (err, photo) => {
    if (err) return res.status(500).json({ error: '服务器错误' });

    if (photo && photo.filename) {
      const filePath = require('path').join(__dirname, '..', 'public', 'uploads', photo.filename);
      require('fs').unlink(filePath, () => {});
    }

    db.run('DELETE FROM photos WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true });
    });
  });
});

module.exports = router;
