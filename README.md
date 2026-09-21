# 📸 光影集 - 摄影师个人作品展示与付费订阅网站

一个完整的摄影师作品展示网站，支持用户注册登录、评论互动、付费订阅、后台照片管理等功能。

## ✨ 核心功能

- 📱 **响应式作品展示** - 瀑布流布局的首页，支持按分类筛选
- 🔐 **用户系统** - 注册、登录、角色权限（普通用户 / 管理员）
- 💬 **评论互动** - 登录用户可对作品发表评论
- 💎 **付费订阅** - 月度/年度/终身会员套餐，付费作品自动解锁（**支持开关**，见下方）
- 🛠️ **后台管理** - 照片上传（支持拖拽）、分类管理、评论审核、订单查看
- 🔒 **付费内容保护** - 未订阅用户只能看到模糊预览和水印

## 🎛️ 可禁用功能（功能开关）

项目使用单一开关来整体控制付费订阅功能，方便「先用免费版上线、以后再开通会员」的渐进式运营。

### 开关位置

编辑 `photo-blog/config.js`：

```js
// true  = 启用付费订阅（完整流程）
// false = 关闭付费订阅
const SUBSCRIPTION_ENABLED = false;
```

### 关闭状态下的行为

- ✅ 后台：管理员仍可查看「订阅订单」tab、历史订单与统计数据；只是不会再产生新订单
- ✅ 数据：`subscriptions` 表里历史订单全部保留，不会删除
- ✅ 普通照片：完全不受影响
- ⚠️ 付费作品：所有访客都能直接查看高清原图（不再需要登录/订阅）
- ⚠️ 前台：顶部导航的「订阅」入口会被自动隐藏
- ⚠️ 订阅页：打开 `/subscribe`（或 `/zh/subscribe`、`/en/subscribe`）会显示「订阅功能暂未开放，敬请期待」
- ⚠️ API：用户侧订阅接口 `GET /api/subscriptions/plans`、`POST /api/subscriptions/subscribe`、`GET /api/subscriptions/status` 一律返回 `403 {"error":"订阅功能暂未开放"}`
- ⚠️ 个人中心：隐藏「订阅状态」标签页

### 重新开启订阅

1. 把 `config.js` 里 `SUBSCRIPTION_ENABLED` 改成 `true`
2. 重启服务：`npm start` 或 `pm2 restart photo-blog`

无需改其他任何文件——所有订阅相关代码、路由、UI 都完整保留，开关关闭时只是被短路绕过。

### 想再加新的功能开关？

`config.js` 已经在导出对象里加新字段，例如：

```js
const SUBSCRIPTION_ENABLED = false;
const COMMENT_ENABLED = true;
module.exports = { SUBSCRIPTION_ENABLED, COMMENT_ENABLED };
```

然后：
1. 在 `server.js` 的 `/js/config.js` 路由里把这些值注入到前端：`res.send(\`window.APP_CONFIG = { subscriptionEnabled: ${SUBSCRIPTION_ENABLED}, commentEnabled: ${COMMENT_ENABLED} };\`);`
2. 前端可通过 `window.APP_CONFIG.xxx` 读取
3. 后端需在路由里 `require('../config')` 后判断

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 数据库 | SQLite（零配置，开箱即用） |
| 认证 | JWT + Cookie |
| 文件上传 | Multer |
| 前端 | 原生 HTML/CSS/JavaScript（无框架） |
| 样式 | 自定义 CSS（响应式） |

**为什么选择 SQLite？**
- 无需安装数据库，复制项目即可运行
- 单文件存储，方便备份
- 后期可平滑迁移到 MySQL/PostgreSQL

## ⚡ 性能与可扩展性

项目对常见的性能热点做了轻量优化，不依赖任何第三方图像处理库：

### 1. 图片懒加载 + CLS 友好占位
- 上传时用 `utils/imageDimensions.js` 解析 JPEG/PNG/GIF/WebP 头，提取宽高写入 `photos.width / photos.height`。
- 列表渲染时给图片加上 `width / height / loading="lazy" / decoding="async"`，并用数据库真实尺寸动态设置占位框 `aspect-ratio`，避免图片加载完成后页面抖动（CLS ≈ 0）。
- 旧照片尺寸为 NULL 时降级为默认 3:2 占位，不会出错。

### 2. SQLite 性能与一致性
- `PRAGMA foreign_keys = ON`：启用外键约束，配合应用层事务级联删除（`routes/adminUsers.js` 的 DELETE 用户接口），防止出现孤儿记录。
- `PRAGMA journal_mode = WAL`：读写并发，提升并发性能。
- `PRAGMA busy_timeout = 5000`：写锁冲突时等待 5 秒再报错，避免瞬时锁竞争造成 500。

### 3. 列表分页 + 搜索
- 管理员后台用户/照片列表支持 `page / pageSize / keyword / role` 参数（已在 `routes/adminUsers.js` 实现）。
- 前台首页/搜索可在 `routes/photos.js` 继续扩展 `page / pageSize / keyword`。

### 4. 订阅支付架构
- 详见下一节「接入真实支付」。

## 📦 项目结构

```
photo-blog/
├── server.js              # 服务器入口
├── package.json
├── .env.example           # 环境变量模板
├── db/
│   └── database.js        # 数据库初始化
├── middleware/
│   └── auth.js            # JWT 认证中间件
├── routes/
│   ├── auth.js            # 注册登录接口
│   ├── photos.js          # 照片接口
│   ├── categories.js      # 分类接口
│   ├── comments.js        # 评论接口
│   └── subscriptions.js   # 订阅接口
├── public/                # 前端静态资源
│   ├── index.html         # 首页
│   ├── photo.html         # 作品详情页
│   ├── login.html         # 登录页
│   ├── register.html      # 注册页
│   ├── subscribe.html     # 订阅页
│   ├── admin.html         # 后台管理
│   ├── css/
│   ├── js/
│   └── uploads/           # 上传的照片
└── README.md
```

## 🚀 快速开始

### 环境要求

- **Node.js** 16+ （[下载地址](https://nodejs.org)）
- npm（Node.js 自带）

### 安装步骤

1. **进入项目目录**
   ```bash
   cd photo-blog
   ```

2. **安装依赖**
   ```bash
   npm install
   ```
   
   如果安装慢，可以切换国内镜像：
   ```bash
   npm install --registry https://registry.npmmirror.com
   ```

3. **配置环境变量（可选）**
   ```bash
   cp .env.example .env
   ```
   默认配置即可直接运行。

4. **启动服务器**
   ```bash
   npm start
   ```

5. **访问网站**
   
   打开浏览器访问 http://localhost:3000

### 初始化管理员账户

首次启动时，通过环境变量配置管理员账户（不会自动生成公开的默认密码）：

在 `.env` 中设置：

```
ADMIN_EMAIL=admin@photoblog.com
ADMIN_PASSWORD=你的强密码（至少 8 位）
```

- 若已存在该邮箱的管理员账户，不会覆盖其密码。
- 若未设置 `ADMIN_PASSWORD`，将跳过管理员自动创建，需手动初始化。

## 📖 使用说明

### 前台功能

| 功能 | 访问方式 |
|------|---------|
| 浏览作品 | 首页 http://localhost:3000 |
| 查看作品详情 | 点击任意作品 |
| 注册账户 | http://localhost:3000/register |
| 登录账户 | http://localhost:3000/login |
| 订阅会员 | http://localhost:3000/subscribe |
| 评论作品 | 登录后在作品详情页底部 |

### 后台管理

访问 http://localhost:3000/admin，使用管理员账户登录。

#### 📊 数据概览
- 查看用户数、照片数、评论数、订阅数、总营收

#### 📷 照片管理
- 查看所有上传的照片
- 删除违规或不需要的照片

#### ⬆️ 上传照片
- 拖拽或点击上传图片
- 设置标题、描述、分类
- 标记为「付费订阅」

#### 🗂️ 分类管理
- 添加新分类（例如：风光、人像、街拍）
- 删除不需要的分类

#### 💬 评论管理
- 查看所有评论
- 删除不当评论

#### 💰 订阅订单
- 查看所有订阅订单
- 追踪营收数据

## 💳 接入真实支付（生产环境）

当前版本使用**模拟支付**（点击订阅按钮立即生效）。

### 接入支付宝

1. 注册[支付宝开放平台](https://open.alipay.com/)
2. 创建应用并获取 APPID
3. 安装 SDK：`npm install alipay-sdk`
4. 在 `routes/subscriptions.js` 的 `/subscribe` 接口中接入

### 接入微信支付

1. 注册[微信支付商户号](https://pay.weixin.qq.com/)
2. 安装 SDK：`npm install wechatpay-node-v3`
3. 修改 `/subscribe` 接口

### 接入 Stripe（国际）

```bash
npm install stripe
```

参考 [Stripe 官方文档](https://stripe.com/docs/api) 进行集成。

## 🌐 部署到服务器

### 部署到云服务器（推荐）

```bash
# 1. 使用 PM2 守护进程
npm install -g pm2
pm2 start server.js --name photo-blog
pm2 save
pm2 startup

# 2. 配置 Nginx 反向代理
# /etc/nginx/sites-available/default
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

### 部署到 Vercel / Railway

将项目推送到 GitHub，然后导入到：
- [Vercel](https://vercel.com/) - 免费额度，适合个人项目
- [Railway](https://railway.app/) - 免费额度，数据库支持好

⚠️ 注意：SQLite 在云平台上需要使用持久化存储或迁移到云数据库。

## 🔒 安全建议

部署到生产环境前：

1. ✅ 修改 `JWT_SECRET` 为复杂随机字符串
2. ✅ 修改默认管理员密码
3. ✅ 启用 HTTPS
4. ✅ 修改管理员邮箱
5. ✅ 限制上传文件类型和大小（已内置）
6. ✅ 添加请求频率限制（建议引入 `express-rate-limit`）

## 🐛 常见问题

**Q: 启动时提示端口被占用？**
A: 修改 `.env` 中的 `PORT` 为其他端口，例如 3001。

**Q: 上传图片失败？**
A: 检查 `public/uploads/` 目录是否有写权限。

**Q: 如何重置数据库？**
A: 删除 `db/photo_blog.db` 文件后重启服务器即可。

**Q: 如何迁移到 MySQL？**
A: 修改 `db/database.js` 中的 sqlite3 为 mysql2，SQL 语句基本兼容。

## 📝 后续功能规划

- [ ] 邮箱验证
- [ ] 找回密码
- [ ] 作品点赞 / 收藏
- [ ] 摄影师个人主页
- [ ] 多语言支持
- [ ] CDN 集成
- [ ] 图片自动压缩
- [ ] 水印自动添加

## 📄 许可证

MIT License - 可自由用于个人和商业项目

---

💡 如有问题，请随时联系作者。祝你的摄影作品被更多人看到！📸
