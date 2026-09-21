const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 递归删除某评论及所有后代回复
function deleteCommentTree(commentId, cb) {
  db.get('SELECT id FROM comments WHERE id = ?', [commentId], (err, c) => {
    if (err || !c) return cb && cb(err || new Error('not found'));
    db.all('SELECT id FROM comments WHERE parent_id = ?', [commentId], (err, kids) => {
      if (err) return cb && cb(err);
      let i = 0;
      const next = () => {
        if (i >= kids.length) {
          return db.run('DELETE FROM comments WHERE id = ?', [commentId], (e) => cb && cb(e));
        }
        const kidId = kids[i++].id;
        deleteCommentTree(kidId, next);
      };
      next();
    });
  });
}

// 获取照片的所有评论（含嵌套结构）
router.get('/photo/:photoId', (req, res) => {
  db.all(
    `SELECT c.id, c.photo_id, c.user_id, c.parent_id, c.reply_to_user_id,
            c.content, c.status, c.created_at,
            u.username, u.avatar,
            ru.username AS reply_to_username
     FROM comments c
     LEFT JOIN users u  ON c.user_id = u.id
     LEFT JOIN users ru ON c.reply_to_user_id = ru.id
     WHERE c.photo_id = ? AND c.status = 'approved'
     ORDER BY c.created_at ASC`,
    [req.params.photoId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '服务器错误' });

      // 构造嵌套树（最多 6 层防止极端深嵌套时性能问题）
      const byId = {};
      const tree = [];
      rows.forEach(r => { byId[r.id] = { ...r, replies: [] }; });
      rows.forEach(r => {
        const node = byId[r.id];
        if (r.parent_id && byId[r.parent_id]) {
          byId[r.parent_id].replies.push(node);
        } else {
          tree.push(node);
        }
      });
      // 顶层按时间倒序
      tree.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      // 每层内部也按时间倒序（最新回复在最上面）
      const sortReplies = (nodes) => {
        if (!nodes) return;
        nodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        nodes.forEach(n => sortReplies(n.replies));
      };
      sortReplies(tree);
      res.json({ total: rows.length, tree });
    }
  );
});

// 获取所有评论（管理员）
router.get('/all', authenticateToken, requireAdmin, (req, res) => {
  db.all(
    `SELECT c.*, u.username, p.title as photo_title
     FROM comments c
     LEFT JOIN users u ON c.user_id = u.id
     LEFT JOIN photos p ON c.photo_id = p.id
     ORDER BY c.created_at DESC`,
    [],
    (err, comments) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      res.json(comments);
    }
  );
});

// 发表评论 / 回复（支持嵌套）
router.post('/', authenticateToken, [
  body('photo_id').isInt().withMessage('照片ID无效'),
  body('content').trim().isLength({ min: 1, max: 500 }).withMessage('评论内容1-500字符'),
  body('parent_id').optional().isInt().withMessage('parent_id 必须为整数'),
  body('reply_to_user_id').optional().isInt().withMessage('reply_to_user_id 必须为整数')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { photo_id, content, parent_id, reply_to_user_id } = req.body;

  // 如果是回复，校验父评论存在且属于同一张照片
  const insert = () => {
    db.run(
      'INSERT INTO comments (photo_id, user_id, content, parent_id, reply_to_user_id) VALUES (?, ?, ?, ?, ?)',
      [photo_id, req.user.id, content, parent_id || null, reply_to_user_id || null],
      function(err) {
        if (err) return res.status(500).json({ error: '发表评论失败' });
        res.json({ success: true, id: this.lastID });
      }
    );
  };

  if (parent_id) {
    db.get('SELECT photo_id FROM comments WHERE id = ? AND status = ?', [parent_id, 'approved'], (err, parent) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!parent) return res.status(404).json({ error: '父评论不存在或已删除' });
      if (parent.photo_id !== parseInt(photo_id, 10)) {
        return res.status(400).json({ error: '父评论不属于这张照片' });
      }
      insert();
    });
  } else {
    insert();
  }
});

// 删除评论（管理员或评论作者，连同所有子回复一起删除）
router.delete('/:id', authenticateToken, (req, res) => {
  db.get('SELECT user_id FROM comments WHERE id = ?', [req.params.id], (err, comment) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!comment) return res.status(404).json({ error: '评论不存在' });

    if (req.user.role !== 'admin' && comment.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除此评论' });
    }

    deleteCommentTree(req.params.id, (err) => {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true });
    });
  });
});

// 更新评论状态（管理员）
router.put('/:id/status', authenticateToken, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'pending', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '状态无效' });
  }

  db.run('UPDATE comments SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: '更新失败' });
    res.json({ success: true });
  });
});

module.exports = router;
