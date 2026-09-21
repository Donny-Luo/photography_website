const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('只支持图片格式 (jpg, png, gif, webp)'));
  }
});

// 获取所有分类
router.get('/', (req, res) => {
  db.all('SELECT * FROM categories ORDER BY created_at DESC', [], (err, categories) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    res.json(categories);
  });
});

// 创建分类（管理员）
router.post('/', authenticateToken, requireAdmin, [
  body('name').trim().notEmpty().withMessage('分类名称不能为空')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description } = req.body;
  db.run(
    'INSERT INTO categories (name, description) VALUES (?, ?)',
    [name, description || ''],
    function(err) {
      if (err) return res.status(500).json({ error: '创建失败' });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 更新分类（管理员）
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { name, description } = req.body;
  db.run(
    'UPDATE categories SET name = ?, description = ? WHERE id = ?',
    [name, description || '', req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ success: true });
    }
  );
});

// 删除分类（管理员）
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run('DELETE FROM categories WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: '删除失败' });
    res.json({ success: true });
  });
});

module.exports = router;
module.exports.upload = upload;
