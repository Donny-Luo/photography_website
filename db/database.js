const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'photo_blog.db');
const db = new sqlite3.Database(dbPath);

// 注意：SQLite PRAGMA 实际为 session 级，但 sqlite3 异步 API 下必须显式在创建表前执行
// 真正生效路径：把这些 PRAGMA 串到 initDatabase() 内 db.serialize() 头部（见下方）

// 初始化数据库表
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 关键 PRAGMA 必须在建表前执行（sqlite3 异步 API 串行生效）
      // foreign_keys：启用外键约束（默认关闭会导致 ON DELETE CASCADE/SET NULL 全部失效）
      // journal_mode=WAL：读写并发，提升并发性能
      // busy_timeout：写锁冲突时等待 5 秒
      db.run('PRAGMA foreign_keys = ON;');
      db.run('PRAGMA journal_mode = WAL;');
      db.run('PRAGMA busy_timeout = 5000;');

      // 用户表
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        avatar TEXT,
        subscription_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 邮箱验证码表（6位数字，10 分钟过期）
      db.run(`CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 密码重置 token 表（1 小时过期，单次使用）
      db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      // 分类表
      db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 摄影集表（与分类并存，一张照片可同时归入多个摄影集）
      db.run(`CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        cover_photo_id INTEGER,
        custom_cover TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 照片-摄影集关联表（多对多）
      db.run(`CREATE TABLE IF NOT EXISTS photo_albums (
        photo_id INTEGER NOT NULL,
        album_id INTEGER NOT NULL,
        PRIMARY KEY (photo_id, album_id),
        FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
      )`);

      // 照片表
      db.run(`CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        filename TEXT NOT NULL,
        category_id INTEGER,
        is_premium BOOLEAN DEFAULT 0,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )`);

      // 评论表
      db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'approved',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (photo_id) REFERENCES photos(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);

      // 评论索引（在父级迁移完成后由 init 末尾创建，避免老库缺列时失败）

      // 订阅订单表
      db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_type TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) {
          reject(err);
        } else {
          // 自动迁移：为已有 albums 表添加 custom_cover 字段
          migrateAlbums().then(() => {
            // 自动迁移：为已有 users 表添加 avatar 字段
            migrateUsers().then(() => {
              // 自动迁移：为已有 comments 表添加 parent_id 字段（嵌套回复）
              migrateComments().then(() => {
                // 自动迁移：为已有 photos 表添加 width / height 字段（用于缩略图占位 + CLS 友好渲染）
                migratePhotoDimensions().then(() => {
                  // 初始化管理员账户（按环境变量 ADMIN_EMAIL / ADMIN_PASSWORD）
                  createDefaultAdmin().then(resolve).catch(reject);
                }).catch(reject);
              }).catch(reject);
            }).catch(reject);
          }).catch(reject);
        }
      });
    });
  });
}

// 数据库迁移：为已有表添加缺失字段
function migrateAlbums() {
  return new Promise((resolve) => {
    db.all("PRAGMA table_info(albums)", (err, columns) => {
      if (err) { resolve(); return; }
      const hasCustomCover = columns.some(c => c.name === 'custom_cover');
      if (!hasCustomCover) {
        db.run("ALTER TABLE albums ADD COLUMN custom_cover TEXT", (err) => {
          console.log('✅ 已迁移: albums.custom_cover 字段');
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// 数据库迁移：为已有 users 表添加 avatar 字段
function migrateUsers() {
  return new Promise((resolve) => {
    db.all("PRAGMA table_info(users)", (err, columns) => {
      if (err) { resolve(); return; }
      const hasAvatar = columns.some(c => c.name === 'avatar');
      if (!hasAvatar) {
        db.run("ALTER TABLE users ADD COLUMN avatar TEXT", (err) => {
          console.log('✅ 已迁移: users.avatar 字段');
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// 数据库迁移：为已有 photos 表添加 width / height 字段（用于占位 + CLS 友好渲染）
// 旧照片尺寸为 NULL 时，前端用默认 3:2 占位，不会出错
function migratePhotoDimensions() {
  return new Promise((resolve) => {
    db.all("PRAGMA table_info(photos)", (err, columns) => {
      if (err) { resolve(); return; }
      const hasW = columns.some(c => c.name === 'width');
      const hasH = columns.some(c => c.name === 'height');
      if (hasW && hasH) { resolve(); return; }
      const add = (sql) => new Promise((r) => db.run(sql, () => r()));
      (async () => {
        if (!hasW) await new Promise(r => db.run("ALTER TABLE photos ADD COLUMN width INTEGER", () => r()));
        if (!hasH) await new Promise(r => db.run("ALTER TABLE photos ADD COLUMN height INTEGER", () => r()));
        console.log('✅ 已迁移: photos.width / photos.height 字段');
        resolve();
      })();
    });
  });
}

// 数据库迁移：为已有 comments 表添加 parent_id（嵌套回复用）和 reply_to_user_id
function migrateComments() {
  return new Promise((resolve) => {
    db.all("PRAGMA table_info(comments)", (err, columns) => {
      if (err) { resolve(); return; }
      const needParent = !columns.some(c => c.name === 'parent_id');
      const needReplyTo = !columns.some(c => c.name === 'reply_to_user_id');
      const addColumn = (sql, done) => db.run(sql, (e) => done && done(e));
      const finish = () => {
        // 迁移完成后再创建依赖 parent_id 的索引（老库在列存在后才不会报错）
        db.run(`CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status)`);
        console.log('✅ 已迁移: comments.parent_id / reply_to_user_id 字段');
        resolve();
      };
      if (!needParent && !needReplyTo) { finish(); return; }
      addColumn("ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE", () => {
        addColumn("ALTER TABLE comments ADD COLUMN reply_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL", finish);
      });
    });
  });
}

// 创建管理员账户（仅当通过环境变量显式配置了初始密码时才自动创建）
// 不再硬编码默认密码，也不在日志中打印明文密码
async function createDefaultAdmin() {
  return new Promise((resolve, reject) => {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@photoblog.com';
    const adminPassword = process.env.ADMIN_PASSWORD;

    // 未配置初始密码：跳过自动创建，避免出现公开的默认凭据
    if (!adminPassword) {
      console.log('ℹ️  未设置 ADMIN_PASSWORD，跳过默认管理员自动创建。');
      console.log('   如需初始化管理员，请在 .env 中配置 ADMIN_EMAIL 与 ADMIN_PASSWORD 后重启。');
      return resolve();
    }

    if (adminPassword.length < 8) {
      return reject(new Error('ADMIN_PASSWORD 至少需要 8 个字符'));
    }

    db.get('SELECT id FROM users WHERE email = ?', [adminEmail], async (err, row) => {
      if (err) return reject(err);

      // 管理员已存在：不覆盖现有密码
      if (row) return resolve();

      try {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        // 用户名取自邮箱 @ 前面的部分，避免与已有普通用户撞名
        const username = adminEmail.split('@')[0] || 'admin';
        db.run(
          'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
          [username, adminEmail, hashedPassword, 'admin'],
          (err) => {
            if (err) return reject(err);
            console.log('✅ 管理员账户已创建（邮箱由 ADMIN_EMAIL 配置）');
            resolve();
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { db, initDatabase };
