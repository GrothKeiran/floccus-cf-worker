const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Floccus 书签备份</title><link rel="stylesheet" href="/admin/app.css"><script src="/admin/app.js" defer></script></head>
<body><main><header><span class="eyebrow">CLOUDFLARE WORKERS + D1</span><h1>书签备份</h1><p>使用同步账号登录，下载当前账号的备份文件。</p></header>
<p id="message" role="status" aria-live="polite"></p>
<section id="login-panel" class="card"><h2>登录备份工具</h2><p id="setup-note">正在读取服务状态…</p>
<form id="login-form"><label for="username">用户名</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="64" required>
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="14" maxlength="256" required>
<button id="login-button" type="submit" disabled>登录</button></form></section>
<section id="account-panel" hidden><div class="card"><h2>导出备份</h2><p>当前账号：<strong id="account-name"></strong></p>
<button id="export" type="button">下载备份 JSON</button><button id="logout" type="button" class="secondary">退出登录</button>
<p class="muted">备份包含书签、目录、同步状态及删除记录，不包含密码和凭证。请妥善保管，不要上传公开仓库。此文件用于数据备份，不是可直接导入浏览器的 HTML 书签文件。</p>
<p class="muted">会话仅保存在当前页面内存中，刷新或关闭后需要重新登录。</p></div></section>
<footer>修改用户名或密码：在 Worker 修改 USERNAME / PASSWORD，保存部署后访问 <a href="/init">/init</a>。日常同步在 Floccus 中完成。</footer>
</main></body></html>`;
const style = `:root{color-scheme:light dark;font:16px/1.65 system-ui,sans-serif;background:#f4f6fa;color:#17243c}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:auto;padding:42px 22px}h1{font-size:clamp(26px,5vw,36px);line-height:1.25}h2{margin-top:0;font-size:21px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#4269a2}.card{background:#fff;border:1px solid #dce3ee;border-radius:16px;padding:26px;margin:20px 0;box-shadow:0 5px 22px #17376108}label{display:block;margin:14px 0 6px;font-weight:600}input{width:100%;padding:12px;border:1px solid #aab8cc;border-radius:8px;font:inherit;background:transparent;color:inherit}input:focus{outline:2px solid #4c7be3;outline-offset:2px}button{font:inherit;cursor:pointer;border:1px solid #2852ad;background:#2852ad;color:#fff;padding:10px 18px;border-radius:8px;margin:18px 12px 0 0}button:disabled{opacity:.55;cursor:wait}.secondary{background:transparent;color:#2852ad}.muted,footer{font-size:14px;color:#5c6b81}footer{margin-top:28px}a{color:inherit}#message{white-space:pre-wrap;padding:0}#message:not(:empty){padding:12px 16px;background:#e7efff;border-radius:8px}#message.error{background:#fff0f0;color:#8c2222}code{font-family:ui-monospace,monospace}[hidden]{display:none!important}@media(prefers-color-scheme:dark){:root{background:#111827;color:#e6edf7}.card{background:#192235;border-color:#34425b}input{border-color:#68758c}.muted,footer{color:#afbed2}.secondary{color:#b4ceff;border-color:#7898d3}#message:not(:empty){background:#243957}#message.error{background:#49272d;color:#ffb8b8}}`;
const script = String.raw`(() => {
'use strict';
const $ = id => document.getElementById(id);
let token = '';
let ready = false;
let loggingIn = false;
let exporting = false;
let sessionGeneration = 0;
const errors = {
  unauthorized: '账号或密码错误，或会话已过期。',
  database_not_initialized: '请先完成 Worker 配置并访问 /init。',
  rate_limited: '操作过于频繁，请稍后再试。',
  credential_limit: '登录会话数量达到上限，请稍后重试。',
  origin_not_allowed: '请从本 Worker 的备份页面操作。'
};
function message(text, bad = false) { $('message').textContent = text; $('message').classList.toggle('error', bad); }
function clearSession() {
  token = ''; sessionGeneration += 1;
  $('password').value = ''; $('account-name').textContent = '';
  $('account-panel').hidden = true; $('login-panel').hidden = false;
  $('login-button').disabled = !ready;
}
async function api(path, method = 'GET', body, checkSession = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const requestToken = token;
  if (requestToken) headers.Authorization = 'Bearer ' + requestToken;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
  const data = response.status === 204 ? null : await response.json();
  if (checkSession && requestToken && token !== requestToken) throw new Error('会话已改变，请重新登录后操作。');
  if (!response.ok) {
    if (response.status === 401 && requestToken && token === requestToken) clearSession();
    const code = data && data.error || 'unknown_error';
    throw Object.assign(new Error(errors[code] || '请求失败（' + response.status + '），请检查服务配置。'), { status: response.status });
  }
  return data;
}
async function loadSetup() {
  const state = await api('/api/setup/status');
  ready = Boolean(state.databaseInitialized && state.initialized);
  $('login-button').disabled = !ready;
  $('setup-note').textContent = ready ? '使用当前同步账号的用户名和密码登录。' : '请先设置 Worker 的 USERNAME、PASSWORD 和 DB 绑定，保存部署并访问 /init，然后刷新本页。';
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (loggingIn || !ready) return;
  loggingIn = true; $('login-button').disabled = true;
  const username = $('username').value.trim().toLowerCase();
  const password = $('password').value; $('password').value = '';
  try {
    const login = await api('/api/login', 'POST', { username, password });
    token = login.accessToken; sessionGeneration += 1;
    const account = await api('/api/me');
    $('account-name').textContent = account.username;
    $('login-panel').hidden = true; $('account-panel').hidden = false;
    message('登录成功，可以下载备份。');
  } catch (error) { clearSession(); message(error.message, true); }
  finally { loggingIn = false; $('password').value = ''; $('login-button').disabled = !ready; }
});
$('export').addEventListener('click', async () => {
  if (exporting || !token) return;
  exporting = true; $('export').disabled = true;
  try {
    const backup = await api('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = 'floccus-backup-' + new Date().toISOString().replaceAll(':', '-') + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('备份下载已开始，请妥善保管文件。');
  } catch (error) { message(error.message, true); }
  finally { exporting = false; $('export').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  if (!token) return;
  const pending = api('/api/logout', 'POST', undefined, false);
  clearSession(); const generation = sessionGeneration;
  try { await pending; if (generation === sessionGeneration) message('已退出登录。'); }
  catch (error) {
    if (generation === sessionGeneration) message(error.status === 401 ? '已退出登录。' : '已清除本页会话；服务器退出请求未成功，原会话会在到期时失效。', error.status !== 401);
  }
});
return loadSetup().catch(error => { ready = false; $('login-button').disabled = true; message(error.message, true); });
})();`;
export function adminRoutes(req: Request, path: string): Response | null {
  if (!['GET', 'HEAD'].includes(req.method)) return null;
  const content = path === '/admin' || path === '/admin/' ? [page, 'text/html; charset=utf-8']
    : path === '/admin/app.js' ? [script, 'application/javascript; charset=utf-8']
      : path === '/admin/app.css' ? [style, 'text/css; charset=utf-8'] : null;
  return content ? new Response(req.method === 'HEAD' ? null : content[0], { headers: { 'Content-Type': content[1] } }) : null;
}
