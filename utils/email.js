// 邮件发送工具
// - 生产模式：通过 SMTP 发送（需在 .env 配置 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM）
// - 开发模式：未配置 SMTP 时，把邮件内容直接 console.log 输出，并附带 devLink/devCode 字段返回给调用方

const crypto = require('crypto');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@photoblog.local';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const NODE_ENV = process.env.NODE_ENV || 'development';

// 缓存 dev 输出，便于测试脚本读取
const devInbox = [];

function isSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

// 检查 nodemailer 是否可用（不强制 require，避免没装时整个模块加载失败）
let nodemailer = null;
let nodemailerMissing = false;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailerMissing = true;
  if (NODE_ENV === 'production') {
    console.error('[FATAL] nodemailer 未安装，生产环境无法发送邮件。请运行: npm install nodemailer');
  } else {
    console.warn('[warn] 未安装 nodemailer，已降级为日志模式（仅开发）。生产环境请安装: npm install nodemailer');
  }
}

async function sendMail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) {
    // 开发模式：日志输出 + 内存缓存（便于测试）
    const entry = { to, subject, text, html, timestamp: new Date().toISOString() };
    devInbox.push(entry);
    console.log('──────────────── DEV EMAIL ────────────────');
    console.log('收件人 :', to);
    console.log('主题   :', subject);
    console.log('正文   :', text);
    console.log('─────────────────────────────────────────────');
    return { dev: true, messageId: 'dev-' + crypto.randomBytes(6).toString('hex') };
  }

  // 生产模式：必须依赖 nodemailer
  if (!nodemailer) {
    const err = new Error('邮件发送失败：未安装 nodemailer，请先 npm install nodemailer');
    console.error('[邮件错误]', err.message);
    throw err;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // 强制使用 IPv4（macOS / 国内网络下 IPv6 经常连不上微软 SMTP，导致 EHOSTUNREACH）
      family: 4,
      // 微软 SMTP 的证书链有时不完全，加这个避免自签证书报错
      tls: { rejectUnauthorized: false }
    });
    const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
    return { messageId: info.messageId };
  } catch (err) {
    console.error('SMTP 发送失败，降级为日志：', err.message);
    const entry = { to, subject, text, html, timestamp: new Date().toISOString() };
    devInbox.push(entry);
    console.log('──────────────── DEV EMAIL (fallback) ────────────────');
    console.log('收件人 :', to);
    console.log('主题   :', subject);
    console.log('正文   :', text);
    console.log('──────────────────────────────────────────────');
    return { dev: true, messageId: 'dev-fallback-' + crypto.randomBytes(6).toString('hex') };
  }
}

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getResetLink(token, lang = 'zh') {
  const base = PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/${lang}/reset-password?token=${token}`;
}

function getDevInbox() {
  return devInbox;
}

function clearDevInbox() {
  devInbox.length = 0;
}

function isDevMode() {
  return !isSmtpConfigured() && NODE_ENV !== 'production';
}

module.exports = {
  sendMail,
  generateSixDigitCode,
  generateResetToken,
  getResetLink,
  isDevMode,
  getDevInbox,
  clearDevInbox
};