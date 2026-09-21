// 管理员专用：用户管理接口
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 工具：根据 unix 秒数算剩余天数（避免 SQLite UTC 时区歧义）
function daysLeftFromNow(unixSec) {
  if (!unixSec) return 0;
  const diff = unixSec * 1000 - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

// ===== 列出所有用户（分页 + 搜索）=====
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  const keyword = (req.query.keyword || '').trim();
  const role = (req.query.role || '').trim(); // 'admin' | ''

  const where_ = [];
  const params = [];
  if (keyword) {
    where_.push('(username LIKE ? OR email LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (role === 'admin' || role === 'user') {
    where_.push('role = ?');
    params.push(role);
  }
  const whereSql = where_.length ? 'WHERE ' + where_.join(' AND ') : '';

  // 总数
  db.get(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params, (err, countRow) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    const total = countRow.total;

    // 列表（用 SQL 内置 epoch 计算订阅剩余天数，绕开 Node 本地时区歧义）
    db.all(
      `SELECT id, username, email, role, avatar,
              subscription_end,
              created_at,
              CASE
                WHEN subscription_end IS NULL THEN 0
                ELSE CAST((strftime('%s', subscription_end) - strftime('%s','now')) AS INTEGER)
              END AS remain_secs,
              (SELECT COUNT(*) FROM comments WHERE user_id = users.id) AS comment_count,
              (SELECT COUNT(*) FROM subscriptions WHERE user_id = users.id) AS sub_count
       FROM users
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
      (err, rows) => {
        if (err) return res.status(500).json({ error: '服务器错误' });

        const items = rows.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
          avatar: u.avatar,
          createdAt: u.created_at,
          subscriptionEnd: u.subscription_end,
          isSubscribed: u.remain_secs > 0,
          daysLeft: daysLeftFromNow(u.remain_secs / 1), // remain 已经是秒单位
          commentCount: u.comment_count,
          subCount: u.sub_count
        }));

        res.json({
          items,
          pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
        });
      }
    );
  });
});

// ===== 单个用户详情（含订阅历史 + 评论历史摘要）=====
router.get('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const uid = req.params.id;
  db.get(
    `SELECT id, username, email, role, avatar, subscription_end, created_at,
            CASE
              WHEN subscription_end IS NULL THEN 0
              ELSE CAST((strftime('%s', subscription_end) - strftime('%s','now')) AS INTEGER)
            END AS remain_secs
     FROM users WHERE id = ?`,
    [uid],
    (err, user) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!user) return res.status(404).json({ error: '用户不存在' });

      // 订阅历史
      db.all(
        `SELECT id, plan_type, amount, status, payment_method, created_at
         FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
        [uid],
        (err, subs) => {
          if (err) return res.status(500).json({ error: '服务器错误' });

          // 评论历史
          db.all(
            `SELECT c.id, c.content, c.created_at, p.title AS photo_title, p.id AS photo_id
             FROM comments c LEFT JOIN photos p ON c.photo_id = p.id
             WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 50`,
            [uid],
            (err, comments) => {
              if (err) return res.status(500).json({ error: '服务器错误' });

              res.json({
                ...user,
                isSubscribed: (user.remain_secs || 0) > 0,
                daysLeft: Math.ceil((user.remain_secs || 0) / 86400),
                subscriptionEnd: user.subscription_end,
                subscriptions: subs,
                comments
              });
            }
          );
        }
      );
    }
  );
});

// ===== 管理员延长/赠送会员 =====
router.post('/users/:id/grant-subscription', authenticateToken, requireAdmin, [
  require('express-validator').body('days').isInt({ min: 1, max: 3650 }).withMessage('天数必须在 1-3650 之间')
], (req, res) => {
  const errors = require('express-validator').validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const uid = req.params.id;
  const days = parseInt(req.body.days);

  db.get('SELECT id, subscription_end FROM users WHERE id = ?', [uid], (err, user) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 计算新的到期时间：在已有到期基础上延长，或从现在开始
    const nowSec = Math.floor(Date.now() / 1000);
    const oldSec = user.subscription_end ? Math.floor(new Date(user.subscription_end + 'Z').getTime() / 1000) : 0;
    const baseSec = oldSec > nowSec ? oldSec : nowSec;
    const newSec = baseSec + days * 24 * 60 * 60;
    const newEnd = new Date(newSec * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.run('UPDATE users SET subscription_end = ? WHERE id = ?', [newEnd, uid], (err) => {
      if (err) return res.status(500).json({ error: '操作失败' });
      res.json({ success: true, message: `已赠送/延长 ${days} 天会员`, subscriptionEnd: newEnd });
    });
  });
});

// ===== 撤销会员 =====
router.post('/users/:id/revoke-subscription', authenticateToken, requireAdmin, (req, res) => {
  const uid = req.params.id;
  db.run('UPDATE users SET subscription_end = NULL WHERE id = ?', [uid], (err) => {
    if (err) return res.status(500).json({ error: '操作失败' });
    res.json({ success: true, message: '已撤销会员' });
  });
});

// ===== 重置用户密码 =====
router.post('/users/:id/reset-password', authenticateToken, requireAdmin, [
  require('express-validator').body('new_password').isLength({ min: 6 }).withMessage('新密码至少 6 个字符')
], async (req, res) => {
  const errors = require('express-validator').validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const uid = req.params.id;
  const hashed = await bcrypt.hash(req.body.new_password, 10);

  db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, uid], function(err) {
    if (err) return res.status(500).json({ error: '操作失败' });
    if (this.changes === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, message: '密码已重置' });
  });
});

// ===== 切换角色（admin ↔ user）=====
router.post('/users/:id/toggle-role', authenticateToken, requireAdmin, (req, res) => {
  const uid = req.params.id;
  // 不能把自己降级
  if (parseInt(uid) === req.user.id) {
    return res.status(400).json({ error: '不能修改自己的角色' });
  }

  db.get('SELECT role FROM users WHERE id = ?', [uid], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!row) return res.status(404).json({ error: '用户不存在' });

    const newRole = row.role === 'admin' ? 'user' : 'admin';
    db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, uid], (err) => {
      if (err) return res.status(500).json({ error: '操作失败' });
      res.json({ success: true, role: newRole, message: `已切换为${newRole === 'admin' ? '管理员' : '普通用户'}` });
    });
  });
});

// ===== 删除用户 =====
// 注意：数据库已启用外键（foreign_keys=ON），所以 subscriptions / comments 等引用用户 id 的行
// 会阻止 DELETE。先在事务里级联清掉所有依赖行，再删用户，最后提交。
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.user.id) {
    return res.status(400).json({ error: '不能删除自己' });
  }

  // 1. 先拿用户头像（后面要清文件）和当前用户名（占位确认存在）
  db.get('SELECT id, avatar FROM users WHERE id = ?', [uid], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!row) return res.status(404).json({ error: '用户不存在' });

    // 2. 把该用户的所有评论下涉及 reply_to_user_id 的引用置 NULL（避免子级回复悬挂）
    db.serialize(() => {
      db.run('BEGIN');
      db.run('UPDATE comments SET reply_to_user_id = NULL WHERE reply_to_user_id = ?', [uid]);
      db.run('UPDATE comments SET parent_id = NULL WHERE parent_id IN (SELECT id FROM comments WHERE user_id = ?)', [uid]);
      db.run('DELETE FROM comments WHERE user_id = ?', [uid]);
      db.run('DELETE FROM subscriptions WHERE user_id = ?', [uid]);
      db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [uid], function(err) {
        if (err) {
          return db.run('ROLLBACK', () => res.status(500).json({ error: '删除失败（关联数据）' }));
        }
        db.run('DELETE FROM users WHERE id = ?', [uid], function(err) {
          if (err) {
            return db.run('ROLLBACK', () => res.status(500).json({ error: '删除失败' }));
          }
          db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: '提交失败' });
            // 3. 删用户成功后再清头像文件（失败也不影响主流程）
            if (row.avatar) {
              try {
                const fs = require('fs');
                const path = require('path');
                fs.unlinkSync(path.join(__dirname, '..', 'public', 'uploads', row.avatar));
              } catch (e) { /* 文件可能已被删，忽略 */ }
            }
            res.json({ success: true, message: '用户已删除（已级联清理订阅/评论）' });
          });
        });
      });
    });
  });
});

// ===== 总览统计 =====
router.get('/users-stats', authenticateToken, requireAdmin, (req, res) => {
  db.serialize(() => {
    const result = { total: 0, admins: 0, normal: 0, subscribed: 0, withAvatar: 0 };
    db.get('SELECT COUNT(*) AS c FROM users', (e, r) => { result.total = r.c; });
    db.get('SELECT COUNT(*) AS c FROM users WHERE role = "admin"', (e, r) => { result.admins = r.c; });
    db.get('SELECT COUNT(*) AS c FROM users WHERE role = "user"', (e, r) => { result.normal = r.c; });
    db.get(`SELECT COUNT(*) AS c FROM users
            WHERE subscription_end IS NOT NULL
              AND CAST(strftime('%s', subscription_end) AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)`,
      (e, r) => { result.subscribed = r.c; });
    db.get('SELECT COUNT(*) AS c FROM users WHERE avatar IS NOT NULL', (e, r) => {
      result.withAvatar = r.c;
      res.json(result);
    });
  });
});

module.exports = router;