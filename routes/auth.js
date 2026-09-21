const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const createRateLimiter = require('../middleware/rateLimit');
const {
  sendMail,
  generateSixDigitCode,
  generateResetToken,
  getResetLink,
  isDevMode
} = require('../utils/email');

const router = express.Router();

// 暴力破解限流（按 IP）
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 15,
  message: '登录尝试过于频繁，请 15 分钟后再试'
});
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 10,
  message: '注册请求过于频繁，请稍后再试'
});
const forgotPasswordLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 10,
  message: '重置请求过于频繁，请稍后再试'
});

// ===== 头像上传配置 =====
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('头像仅支持 jpg/png/gif/webp 格式'));
  }
});

// 注册
router.post('/register', registerLimiter, [
  body('username').trim().isLength({ min: 3 }).withMessage('用户名至少3个字符'),
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6个字符')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username], async (err, row) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (row) return res.status(400).json({ error: '用户名或邮箱已被使用' });

      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        [username, email, hashedPassword, 'user'],
        function(err) {
          if (err) return res.status(500).json({ error: '注册失败' });

          const token = jwt.sign({ id: this.lastID, username, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
          res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
          res.json({
            success: true,
            user: { id: this.lastID, username, email, role: 'user' },
            token
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 登录
router.post('/login', loginLimiter, [
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('password').notEmpty().withMessage('请输入密码')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!user) return res.status(401).json({ error: '邮箱或密码错误' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: '邮箱或密码错误' });

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });

    const isSubscribed = user.subscription_end && new Date(user.subscription_end) > new Date();

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isSubscribed,
        subscriptionEnd: user.subscription_end
      },
      token
    });
  });
});

// 登出
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// 获取当前用户信息
router.get('/me', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, role, avatar, subscription_end, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!user) return res.status(404).json({ error: '用户不存在' });

      const isSubscribed = user.subscription_end && new Date(user.subscription_end) > new Date();
      res.json({
        ...user,
        isSubscribed,
        subscriptionEnd: user.subscription_end
      });
    }
  );
});

// ===== 头像上传 =====
router.post('/avatar', authenticateToken, (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '头像文件不能超过 2MB' });
      }
      // 仅对我们自己的文件类型校验返回友好提示，其余错误模糊处理，避免泄露内部细节
      if (err && err.message && /头像仅支持/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[头像上传错误]', err);
      return res.status(400).json({ error: '上传失败' });
    }
    if (!req.file) return res.status(400).json({ error: '请选择头像图片' });

    const newAvatar = 'avatars/' + req.file.filename;

    db.get('SELECT avatar FROM users WHERE id = ?', [req.user.id], (dbErr, row) => {
      if (dbErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: '服务器错误' });
      }
      if (row && row.avatar) {
        const oldPath = path.join(__dirname, '..', 'public', 'uploads', row.avatar);
        fs.unlink(oldPath, () => {});
      }

      db.run('UPDATE users SET avatar = ? WHERE id = ?', [newAvatar, req.user.id], (uErr) => {
        if (uErr) return res.status(500).json({ error: '保存失败' });
        res.json({ success: true, avatar: newAvatar });
      });
    });
  });
});

// 删除头像（恢复首字母默认）
router.delete('/avatar', authenticateToken, (req, res) => {
  db.get('SELECT avatar FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (row && row.avatar) {
      const oldPath = path.join(__dirname, '..', 'public', 'uploads', row.avatar);
      fs.unlink(oldPath, () => {});
    }
    db.run('UPDATE users SET avatar = NULL WHERE id = ?', [req.user.id], (err) => {
      if (err) return res.status(500).json({ error: '删除失败' });
      res.json({ success: true });
    });
  });
});

// 修改密码（已登录用户）
router.post('/change-password', authenticateToken, [
  body('old_password').notEmpty().withMessage('请输入当前密码'),
  body('new_password').isLength({ min: 6 }).withMessage('新密码至少6个字符')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { old_password, new_password } = req.body;

  db.get('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, user) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const isMatch = await bcrypt.compare(old_password, user.password);
    if (!isMatch) return res.status(400).json({ error: '当前密码不正确' });

    const hashedPassword = await bcrypt.hash(new_password, 10);

    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id], (err) => {
      if (err) return res.status(500).json({ error: '修改失败' });
      res.json({ success: true, message: '密码修改成功' });
    });
  });
});

// 修改用户名（已登录用户）
router.post('/change-username', authenticateToken, [
  body('new_username').trim().isLength({ min: 3 }).withMessage('用户名至少3个字符')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const newUsername = req.body.new_username.trim();

  db.get('SELECT id FROM users WHERE username = ? AND id != ?', [newUsername, req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (row) return res.status(400).json({ error: '该用户名已被占用' });

    db.run('UPDATE users SET username = ? WHERE id = ?', [newUsername, req.user.id], (err) => {
      if (err) return res.status(500).json({ error: '修改失败' });
      res.json({ success: true, message: '用户名修改成功', username: newUsername });
    });
  });
});

// ===== 改邮箱（双校验：旧密码 + 新邮箱验证码）=====
// 步骤 1：发送验证码到【新邮箱】
router.post('/send-email-code', authenticateToken, [
  body('new_email').isEmail().withMessage('邮箱格式不正确'),
  body('purpose').isIn(['change_email']).withMessage('purpose 非法')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { new_email, purpose } = req.body;

  db.get('SELECT id FROM users WHERE email = ? AND id != ?', [new_email, req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (row) return res.status(400).json({ error: '该邮箱已被其他账户使用' });

    // 60 秒内同一邮箱不能重发
    db.get(
      `SELECT (strftime('%s','now') - strftime('%s', created_at)) AS elapsed
       FROM email_verification_codes
       WHERE email = ? AND purpose = ?
       ORDER BY id DESC LIMIT 1`,
      [new_email, purpose],
      (err, last) => {
        if (err) return res.status(500).json({ error: '服务器错误' });
        if (last && last.elapsed !== null && Number(last.elapsed) < 60) {
          return res.status(429).json({ error: '请稍后再发送（防刷间隔 60 秒）' });
        }

        const code = generateSixDigitCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.run(
          'INSERT INTO email_verification_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)',
          [new_email, code, purpose, expiresAt],
          async (err) => {
            if (err) return res.status(500).json({ error: '发送失败' });

            const lang = req.body.lang || 'en';
            const subject = lang === 'zh' ? '【光影集】修改邮箱验证码' : '[Lumière] Your verification code';
            const text = (lang === 'zh'
              ? `您的验证码为 ${code}，10 分钟内有效，请勿泄露给他人。`
              : `Your verification code is ${code}. Valid for 10 minutes. Please do not share it.`);

            await sendMail({ to: new_email, subject, text });

            const resp = { success: true, message: '验证码已发送' };
            if (isDevMode()) resp.devCode = code;
            res.json(resp);
          }
        );
      }
    );
  });
});

// 步骤 2：提交旧密码 + 新邮箱 + 验证码  → 完成修改
router.post('/change-email', authenticateToken, [
  body('new_email').isEmail().withMessage('邮箱格式不正确'),
  body('current_password').notEmpty().withMessage('请输入当前密码以验证身份'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('验证码为 6 位数字')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { new_email, current_password, code } = req.body;

  // 校验旧密码
  db.get('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, user) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) return res.status(400).json({ error: '当前密码不正确' });

    // 校验验证码
    db.get(
      `SELECT id, expires_at, used,
              (strftime('%s', expires_at) - strftime('%s','now')) AS remain
       FROM email_verification_codes
       WHERE email = ? AND code = ? AND purpose = 'change_email'
       ORDER BY id DESC LIMIT 1`,
      [new_email, code],
      (err, row) => {
        if (err) return res.status(500).json({ error: '服务器错误' });
        if (!row) return res.status(400).json({ error: '验证码不正确' });
        if (row.used) return res.status(400).json({ error: '验证码已使用' });
        if (Number(row.remain) <= 0) return res.status(400).json({ error: '验证码已过期，请重新发送' });

        // 检查邮箱是否被他人占用
        db.get('SELECT id FROM users WHERE email = ? AND id != ?', [new_email, req.user.id], (err, existRow) => {
          if (err) return res.status(500).json({ error: '服务器错误' });
          if (existRow) return res.status(400).json({ error: '该邮箱已被其他账户使用' });

          db.serialize(() => {
            db.run('UPDATE users SET email = ? WHERE id = ?', [new_email, req.user.id]);
            db.run('UPDATE email_verification_codes SET used = 1 WHERE id = ?', [row.id], (err) => {
              if (err) return res.status(500).json({ error: '修改失败' });
              res.json({ success: true, message: '邮箱修改成功', email: new_email });
            });
          });
        });
      }
    );
  });
});

// ===== 忘记密码 =====
// 步骤 1：请求重置链接
router.post('/forgot-password', forgotPasswordLimiter, [
  body('email').isEmail().withMessage('邮箱格式不正确')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, lang = 'en' } = req.body;

  // 无论邮箱是否存在都返回成功（防枚举）
  db.get('SELECT id, username FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (user) {
      // 60 秒防刷
      db.get(
        `SELECT (strftime('%s','now') - strftime('%s', created_at)) AS elapsed
         FROM password_reset_tokens WHERE user_id = ?
         ORDER BY id DESC LIMIT 1`,
        [user.id],
        async (err, last) => {
          if (last && last.elapsed !== null && Number(last.elapsed) < 60) {
            return res.json({ success: true, message: '如邮箱存在，重置链接已发送' });
          }

          const token = generateResetToken();
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

          db.run(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt],
            async (err) => {
              if (err) return res.status(500).json({ error: '服务器错误' });

              const resetLink = getResetLink(token, lang);
              const subject = lang === 'zh' ? '【光影集】密码重置链接' : '[Lumière] Password Reset Link';
              const text = (lang === 'zh'
                ? `您好 ${user.username}，\n\n请点击以下链接重置您的密码（1 小时内有效）：\n${resetLink}\n\n如非本人操作，请忽略此邮件。`
                : `Hi ${user.username},\n\nPlease use the link below to reset your password (valid for 1 hour):\n${resetLink}\n\nIf you didn't request this, please ignore this email.`);

              await sendMail({ to: email, subject, text });

              const resp = { success: true, message: '如邮箱存在，重置链接已发送' };
              if (isDevMode()) {
                resp.devLink = resetLink;
                resp.devToken = token;
              }
              res.json(resp);
            }
          );
        }
      );
    } else {
      // 用户不存在也返回相同响应，防止邮箱枚举攻击
      res.json({ success: true, message: '如邮箱存在，重置链接已发送' });
    }
  });
});

// 步骤 2：使用 token 重置密码
router.post('/reset-password', [
  body('token').notEmpty().withMessage('缺少重置令牌'),
  body('new_password').isLength({ min: 6 }).withMessage('新密码至少6个字符')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { token, new_password } = req.body;

  db.get(
    `SELECT id, user_id, expires_at, used,
            (strftime('%s', expires_at) - strftime('%s','now')) AS remain
     FROM password_reset_tokens WHERE token = ?`,
    [token],
    async (err, row) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!row) return res.status(400).json({ error: '重置链接无效' });
      if (row.used) return res.status(400).json({ error: '重置链接已使用' });
      if (Number(row.remain) <= 0) return res.status(400).json({ error: '重置链接已过期，请重新申请' });

      const hashedPassword = await bcrypt.hash(new_password, 10);

      db.serialize(() => {
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, row.user_id]);
        db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [row.id], (err) => {
          if (err) return res.status(500).json({ error: '重置失败' });
          res.json({ success: true, message: '密码重置成功，请使用新密码登录' });
        });
      });
    }
  );
});

// 校验重置 token 是否有效（供 reset-password 页面加载时检查）
router.get('/reset-password/:token', (req, res) => {
  db.get(
    `SELECT id, expires_at, used,
            (strftime('%s', expires_at) - strftime('%s','now')) AS remain
     FROM password_reset_tokens WHERE token = ?`,
    [req.params.token],
    (err, row) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      if (!row) return res.status(404).json({ valid: false, error: '重置链接无效' });
      if (row.used) return res.status(400).json({ valid: false, error: '重置链接已使用' });
      if (Number(row.remain) <= 0) return res.status(400).json({ valid: false, error: '重置链接已过期' });
      res.json({ valid: true });
    }
  );
});

module.exports = router;