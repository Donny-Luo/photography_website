const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin, optionalAuth, canViewPremium } = require('../middleware/auth');

const router = express.Router();

// 封面上传配置（保存到 /public/uploads/covers/）
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'covers');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'cover-' + uniqueSuffix + ext);
  }
});

const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('封面只支持图片格式 (jpg/png/gif/webp)'));
  }
});

// 获取所有摄影集（公开，支持分页 + 搜索）—— 优先级：自定义封面 > 选定的照片封面 > 默认占位
router.get('/', (req, res) => {
  const { keyword, page, pageSize } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize) || 24));
  const offset = (pageNum - 1) * size;

  const where_ = [];
  const params = [];
  const kw = (keyword || '').trim();
  if (kw) {
    where_.push('(a.name LIKE ? OR a.description LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like);
  }
  const whereSql = where_.length ? ' WHERE ' + where_.join(' AND ') : '';

  // 总数
  db.get(`SELECT COUNT(*) AS total FROM albums a${whereSql}`, params, (err, countRow) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    const total = countRow.total;
    const totalPages = Math.max(1, Math.ceil(total / size));

    db.all(
      `SELECT a.id, a.name, a.description, a.custom_cover, a.cover_photo_id, a.created_at,
              COUNT(pa.photo_id) as photo_count,
              (SELECT filename FROM photos WHERE id = a.cover_photo_id) as cover_filename
       FROM albums a
       LEFT JOIN photo_albums pa ON a.id = pa.album_id
       ${whereSql}
       GROUP BY a.id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, size, offset],
      (err, albums) => {
        if (err) return res.status(500).json({ error: '服务器错误' });
        res.json({
          items: albums,
          pagination: { page: pageNum, pageSize: size, total, totalPages }
        });
      }
    );
  });
});

// 获取单个摄影集（含照片列表）
router.get('/:id', optionalAuth, (req, res) => {
  const albumId = req.params.id;

  db.get('SELECT * FROM albums WHERE id = ?', [albumId], (err, album) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!album) return res.status(404).json({ error: '摄影集不存在' });

    db.all(
      `SELECT p.*, c.name as category_name
       FROM photo_albums pa
       JOIN photos p ON pa.photo_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE pa.album_id = ?
       ORDER BY pa.photo_id ASC`,
      [albumId],
      (err, photos) => {
        if (err) return res.status(500).json({ error: '服务器错误' });
        // 付费门控：未订阅 / 非管理员的付费照片隐藏文件名
        const canView = canViewPremium(req);
        const sanitized = photos.map(p => {
          if (p.is_premium && !canView) {
            return { ...p, filename: null, locked: true };
          }
          return { ...p, locked: false };
        });
        res.json({ ...album, photos: sanitized });
      }
    );
  });
});

// 创建摄影集（管理员）
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '请输入摄影集名称' });
  }

  db.run(
    'INSERT INTO albums (name, description) VALUES (?, ?)',
    [name.trim(), description || ''],
    function (err) {
      if (err) return res.status(500).json({ error: '创建失败' });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 更新摄影集基础信息（管理员）
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { name, description, cover_photo_id } = req.body;

  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (cover_photo_id !== undefined) { fields.push('cover_photo_id = ?'); values.push(cover_photo_id || null); }

  if (fields.length === 0) return res.json({ success: true });

  values.push(req.params.id);
  db.run(`UPDATE albums SET ${fields.join(', ')} WHERE id = ?`, values, (err) => {
    if (err) return res.status(500).json({ error: '更新失败' });
    res.json({ success: true });
  });
});

// 上传自定义封面（管理员）
router.post('/:id/cover-upload', authenticateToken, requireAdmin, uploadCover.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择封面图片' });

  const albumId = req.params.id;
  const newCover = 'covers/' + req.file.filename;

  // 先查旧封面，删除旧文件
  db.get('SELECT custom_cover FROM albums WHERE id = ?', [albumId], (err, row) => {
    if (err) {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: '服务器错误' });
    }
    if (!row) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: '摄影集不存在' });
    }

    // 删除旧封面文件
    if (row.custom_cover) {
      const oldPath = path.join(__dirname, '..', 'public', 'uploads', row.custom_cover);
      fs.unlink(oldPath, () => {});
    }

    db.run('UPDATE albums SET custom_cover = ? WHERE id = ?', [newCover, albumId], (err) => {
      if (err) return res.status(500).json({ error: '保存失败' });
      res.json({ success: true, cover: newCover });
    });
  });
});

// 删除自定义封面（管理员）—— 回到使用照片封面或默认占位
router.delete('/:id/cover-upload', authenticateToken, requireAdmin, (req, res) => {
  const albumId = req.params.id;
  db.get('SELECT custom_cover FROM albums WHERE id = ?', [albumId], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!row) return res.status(404).json({ error: '摄影集不存在' });

    if (row.custom_cover) {
      const oldPath = path.join(__dirname, '..', 'public', 'uploads', row.custom_cover);
      fs.unlink(oldPath, () => {});
    }
    db.run('UPDATE albums SET custom_cover = NULL WHERE id = ?', [albumId], (err) => {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true });
    });
  });
});

// 从已有照片设置封面（管理员）
router.post('/:id/cover', authenticateToken, requireAdmin, (req, res) => {
  const { photo_id } = req.body;
  if (!photo_id) return res.status(400).json({ error: '请提供照片ID' });

  db.get(
    'SELECT id FROM photo_albums WHERE album_id = ? AND photo_id = ?',
    [req.params.id, photo_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!row) return res.status(400).json({ error: '该照片不属于此摄影集' });

      db.run('UPDATE albums SET cover_photo_id = ? WHERE id = ?', [photo_id, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: '设置失败' });
        res.json({ success: true });
      });
    }
  );
});

// 删除摄影集（管理员）
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  // 删除自定义封面文件
  db.get('SELECT custom_cover FROM albums WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (row && row.custom_cover) {
      const oldPath = path.join(__dirname, '..', 'public', 'uploads', row.custom_cover);
      fs.unlink(oldPath, () => {});
    }
    db.run('DELETE FROM albums WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true });
    });
  });
});

module.exports = router;
