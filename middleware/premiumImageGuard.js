const { db } = require('../db/database');

// 阻止对「付费照片原图」的直接静态访问：
// 付费原图必须通过受保护的 /api/photos/:id/image 接口获取，
// 这里拦截 /uploads/<filename> 的直链（返回 404，避免泄露文件存在性）。
// 封面 / 头像位于子目录（/uploads/covers/、/uploads/avatars/），不受影响。
function premiumImageGuard(req, res, next) {
  const m = req.path.match(/^\/uploads\/([^/]+)$/);
  if (!m) return next();

  const filename = m[1];
  db.get('SELECT is_premium FROM photos WHERE filename = ?', [filename], (err, row) => {
    if (err || !row || !row.is_premium) return next();
    res.status(404).end();
  });
}

module.exports = premiumImageGuard;
