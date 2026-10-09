// 独立 SMTP 连通性测试（不依赖 dotenv）
// 用法：node _smtp_test.js 目标邮箱
// 注意：测试完删掉

const nodemailer = require('nodemailer');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

// 手动解析 .env（避免依赖 dotenv 包）
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx < 0) return;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

const env = loadEnv(path.join(__dirname, '.env'));
Object.assign(process.env, env);

const target = process.argv[2];
if (!target) {
  console.error('用法：node _smtp_test.js 目标邮箱');
  process.exit(1);
}

console.log('--- 配置 ---');
console.log('HOST :', process.env.SMTP_HOST);
console.log('PORT :', process.env.SMTP_PORT);
console.log('USER :', process.env.SMTP_USER);
console.log('FROM :', process.env.SMTP_FROM);
console.log('PASS :', process.env.SMTP_PASS ? '***已设置(' + process.env.SMTP_PASS.length + ' 位)***' : '❌ 未设置');

// 自动清洗密码（去掉空格和零宽字符）
if (process.env.SMTP_PASS) {
  const original = process.env.SMTP_PASS;
  const cleaned = process.env.SMTP_PASS.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  if (original !== cleaned) {
    console.log(`⚠️  密码中检测到 ${original.length - cleaned.length} 个不可见字符，已自动去除（清洗后 ${cleaned.length} 位）`);
    process.env.SMTP_PASS = cleaned;
  }
  if (cleaned.length !== 16) {
    console.log(`⚠️  清洗后密码长度 = ${cleaned.length} 位（Outlook App password 应为 16 位）`);
  }
}
console.log();

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('❌ SMTP 配置不完整，请检查 .env 中的 SMTP_HOST / SMTP_USER / SMTP_PASS');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false },
  // 强制 IPv4，绕过 macOS / 国内网络 IPv6 不通
  family: 4,
  // 自定义 DNS lookup：只解析 A 记录（IPv4），彻底绕开 AAAA 记录
  lookup: (hostname, options, callback) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        console.error('   DNS 解析失败：', err.message);
        return callback(err);
      }
      console.log('   DNS 解析：', hostname, '→', addresses[0]);
      callback(null, addresses[0], 4);
    });
  }
});

(async () => {
  try {
    console.log('--- 验证 SMTP 连接 ---');
    await transporter.verify();
    console.log('✅ SMTP 验证通过！');

    console.log('\n--- 发送测试邮件到', target, '---');
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: target,
      subject: '【测试】Photo Blog SMTP 配置成功',
      text: '这是一封测试邮件，说明你的 Outlook SMTP 配置已成功！',
      html: '<h2 style="color:#4f46e5">🎉 测试邮件</h2><p>你的 <b>Outlook SMTP</b> 配置成功！</p><p>如果收到这封邮件，说明你的 photo-blog 项目可以正常发送邮件了。</p>'
    });
    console.log('✅ 发送成功！');
    console.log('   messageId:', info.messageId);
    console.log('   response :', info.response);
  } catch (e) {
    console.error('❌ 失败：', e.message);
    console.error('   code:', e.code);
    console.error('   command:', e.command);
    if (e.response) console.error('   response:', e.response);
    if (e.responseCode) console.error('   responseCode:', e.responseCode);
  }
})();
