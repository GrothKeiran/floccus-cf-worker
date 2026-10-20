const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Floccus 书签同步管理</title><link rel="stylesheet" href="/admin/app.css"><script src="/admin/app.js" defer></script></head>
<body><main><header><span class="eyebrow">CLOUDFLARE WORKERS + D1</span><h1>Floccus 书签同步管理</h1><p>Floccus 直接填写 Worker 的 USERNAME 和 PASSWORD；这里提供可选设备管理与备份。</p></header>
<p id="message" role="status" aria-live="polite"></p>
<section id="login-panel" class="card"><h2 id="login-title">登录管理</h2>
<p id="setup-note">正在读取初始化状态…</p>
<form id="login-form"><label for="username">用户名</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="64" required>
<label for="password">账户密码</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="14" maxlength="256" required>
<button id="login-button" type="submit" disabled>登录</button></form>
<p class="muted">这里使用账户密码，不使用 ADMIN_TOKEN 或 app_ 开头的设备密码。首次只需配置 USERNAME、PASSWORD 与 DB 绑定，再访问 /init。<a href="/init">初始化数据库</a></p></section>
<section id="account-panel" hidden><div class="card account-heading"><div><h2>设备管理</h2><p>当前账户：<strong id="account-name"></strong></p></div><button id="logout" type="button" class="secondary">退出登录</button></div>
<div class="card"><h2>可选：独立应用密码</h2><p>日常同步可直接使用账户密码，无需生成。需要单独撤销设备或区分并发配置时，再为每台浏览器单独生成应用密码。</p>
<form id="device-form"><label for="device-label">设备名称</label><input id="device-label" maxlength="100" placeholder="例如：Chrome-电脑A" required><button id="create-device" type="submit">生成应用密码</button></form>
<div id="credential-panel" hidden><h3>复制到 Floccus</h3><p class="warning">应用密码仅在此次显示，请保存到密码管理器。刷新页面后无法再次查看。</p>
<label for="webdav-url">WebDAV URL</label><input id="webdav-url" readonly>
<label for="floccus-username">用户名</label><input id="floccus-username" readonly>
<label for="application-password">Floccus 的认证密码</label><input id="application-password" readonly autocomplete="off" spellcheck="false"><button id="copy-password" type="button" class="secondary">复制应用密码</button>
<p>后端选择 WebDAV；文件名填 <code>bookmarks.xbel</code>；文件类型选 XBEL；另一个“加密密码”框必须留空。本地目录选择原生书签栏，正常使用双向合并。</p></div></div>
<div class="card"><h2>已签发的应用密码</h2><p class="muted">此列表不显示账户密码连接。撤销只使对应应用密码失效，不影响账户密码或书签。设备密码无法再次显示，丢失后请撤销并重新创建。</p><ul id="device-list"></ul><button id="refresh-devices" type="button" class="secondary">刷新设备列表</button></div>
<div class="card"><h2>备份与安全</h2><button id="export" type="button" class="secondary">导出账户备份 JSON</button><p class="muted">备份包含书签和同步状态，请妥善保存，不要上传公开仓库。网页会话仅保存在当前页面内存中，刷新或关闭后需要重新登录。</p></div></section>
<footer>首次访问 /init 会自动建表，并将 USERNAME、PASSWORD 初始化到用户表。密码只保存安全哈希；配置变更后部署并访问 /init 可更新原账号；书签保持不变，旧凭证将被撤销。</footer>
</main></body></html>`;
const style = `:root{color-scheme:light dark;font:16px/1.65 system-ui,sans-serif;background:#f4f6fa;color:#17243c}*{box-sizing:border-box}body{margin:0}main{max-width:840px;margin:auto;padding:42px 22px}h1{font-size:clamp(26px,5vw,36px);line-height:1.25}h2{margin-top:0;font-size:21px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#4269a2}.card{background:#fff;border:1px solid #dce3ee;border-radius:16px;padding:26px;margin:20px 0;box-shadow:0 5px 22px #17376108}label{display:block;margin:14px 0 6px;font-weight:600}input{width:100%;padding:12px;border:1px solid #aab8cc;border-radius:8px;font:inherit;background:transparent;color:inherit}input:focus{outline:2px solid #4c7be3;outline-offset:2px}button{font:inherit;cursor:pointer;border:1px solid #2852ad;background:#2852ad;color:#fff;padding:10px 18px;border-radius:8px;margin-top:18px}button:disabled{opacity:.55;cursor:wait}.secondary{background:transparent;color:#2852ad}.muted,footer{font-size:14px;color:#5c6b81}footer{margin-top:28px}.warning{color:#80531b;background:#fff4d9;padding:12px;border-radius:8px}#message{white-space:pre-wrap;padding:0}#message:not(:empty){padding:12px 16px;background:#e7efff;border-radius:8px}#message.error{background:#fff0f0;color:#8c2222}.account-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.account-heading button{margin:0}#device-list{padding:0;list-style:none}#device-list li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #e2e7ef;overflow-wrap:anywhere}#device-list button{margin:0;flex-shrink:0}#credential-panel{margin-top:24px;border-top:1px solid #dce3ee;padding-top:12px}code{font-family:ui-monospace,monospace}[hidden]{display:none!important}@media(prefers-color-scheme:dark){:root{background:#111827;color:#e6edf7}.card{background:#192235;border-color:#34425b}input{border-color:#68758c}.muted,footer{color:#afbed2}.secondary{color:#b4ceff;border-color:#7898d3}#message:not(:empty){background:#243957}#message.error{background:#49272d;color:#ffb8b8}.warning{background:#40351e;color:#f4d695}#device-list li,#credential-panel{border-color:#34425b}}`;
const script = String.raw`(() => {
'use strict';
const $ = id => document.getElementById(id);
let token = '';
let setupState = null;
const errors = {
  unauthorized: '账号或密码错误，或会话已过期。',
  bootstrap_not_configured: '请在 Cloudflare 设置 USERNAME 和 Secret 类型的 PASSWORD（至少14字符），保存后访问 /init。',
  database_not_initialized: '请先访问 /init，程序会自动创建全部表、生成内部密钥并初始化账号，不需要导入 SQL。',
  setup_already_completed: '数据库已初始化，请使用现有账号登录；更改环境变量不会重置密码。',
  rate_limited: '操作过于频繁，请稍后再试。',
  credential_limit: '有效凭证数量达到上限，请先撤销不用的设备，或稍后重新登录。',
  secrets_not_configured: '请检查 Cloudflare 中的 ADMIN_TOKEN、TOKEN_PEPPER Secrets。',
  invalid_label: '请填写不超过100字符的设备名称。',
  origin_not_allowed: '请求来源不被允许，请从本 Worker 自己的 /admin 页面操作。'
};
function message(text, bad = false) { $('message').textContent = text; $('message').classList.toggle('error', bad); }
function clearSession() {
  token = '';
  $('password').value = '';
  $('application-password').value = '';
  $('credential-panel').hidden = true;
  $('account-panel').hidden = true;
  $('login-panel').hidden = false;
  $('device-list').replaceChildren();
}
async function api(path, method = 'GET', body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const requestToken = token;
  if (requestToken) headers.Authorization = 'Bearer ' + requestToken;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (requestToken && token !== requestToken) throw new Error('会话已改变，请在当前账号下重试。');
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && token) clearSession();
    const code = data && data.error || 'unknown_error';
    throw Object.assign(new Error(errors[code] || '请求失败：' + code + '（' + response.status + '）。请检查 D1 迁移、绑定和生产环境变量。'), { code, status: response.status });
  }
  return data;
}
async function loadSetup() {
  setupState = await api('/api/setup/status');
  $('login-title').textContent = setupState.initialized ? '登录管理' : '首次初始化';
  $('login-button').textContent = setupState.initialized ? '登录' : '初始化并登录';
  $('login-button').disabled = !setupState.databaseInitialized || (!setupState.initialized && !setupState.bootstrapConfigured);
  $('setup-note').textContent = !setupState.databaseInitialized
    ? '先在 Cloudflare 设置 USERNAME、PASSWORD，绑定 D1 为 DB，然后访问 /init。程序会自动建表和创建账号，无需手工导入 SQL。'
    : setupState.initialized
    ? '使用已有账户密码登录。修改 USERNAME、PASSWORD 后部署并访问 /init，可更新原账号，保留书签并撤销旧凭证。'
    : setupState.bootstrapConfigured
      ? '数据库已准备好。可先访问 /init 自动导入 USERNAME、PASSWORD，或输入匹配的初始凭证完成兼容初始化。'
      : '请在 Cloudflare 设置 USERNAME、PASSWORD，保存后访问 /init。';
}
async function devices() {
  const rows = await api('/api/devices');
  const list = $('device-list'); list.replaceChildren();
  if (!rows.length) { const empty = document.createElement('li'); empty.textContent = '还没有设备，先在上方生成应用密码。'; list.append(empty); }
  for (const device of rows) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = device.label + ' · ' + new Date(device.created_at).toLocaleString();
    const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'secondary'; revoke.textContent = '撤销';
    revoke.addEventListener('click', async () => {
      if (!confirm('撤销“' + device.label + '”的应用密码？该设备将无法继续同步，书签不会被删除。')) return;
      revoke.disabled = true;
      try { await api('/api/devices/' + encodeURIComponent(device.id), 'DELETE'); await devices(); message('设备已撤销。'); }
      catch (error) { message(error.message, true); revoke.disabled = false; }
    });
    item.append(label, revoke); list.append(item);
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true; message('正在处理…');
  const username = $('username').value.trim().toLowerCase();
  const password = $('password').value;
  try {
    await loadSetup(); $('login-button').disabled = true;
    if (!setupState.initialized) {
      try { await api('/api/setup', 'POST', { username, password }); }
      catch (error) { if (error.code !== 'setup_already_completed') throw error; }
    }
    const login = await api('/api/login', 'POST', { username, password }); token = login.accessToken;
    const account = await api('/api/me');
    $('account-name').textContent = account.username;
    $('floccus-username').value = account.username;
    $('webdav-url').value = location.origin + '/dav/';
    $('login-panel').hidden = true; $('account-panel').hidden = false;
    await devices();
    message('登录成功。请为每台浏览器分别生成应用密码。新增设备时无需修改 Worker 变量或 D1 表。');
  } catch (error) { message(error.message, true); }
  finally { $('password').value = ''; $('login-button').disabled = !setupState || !setupState.databaseInitialized || (!setupState.initialized && !setupState.bootstrapConfigured); }
});
$('device-form').addEventListener('submit', async event => {
  event.preventDefault(); $('create-device').disabled = true;
  $('credential-panel').hidden = true; $('application-password').value = '';
  try {
    const result = await api('/api/devices', 'POST', { label: $('device-label').value.trim() });
    $('application-password').value = result.applicationPassword;
    $('credential-panel').hidden = false;
    message('应用密码已生成，请立即保存，然后填进当前浏览器的 Floccus。');
    await devices();
  } catch (error) { message(error.message, true); }
  finally { $('create-device').disabled = false; }
});
$('copy-password').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('application-password').value); message('应用密码已复制，请勿粘贴到公开聊天或截图中。'); }
  catch { $('application-password').focus(); $('application-password').select(); message('浏览器未允许自动复制，请手动复制已选中的密码。'); }
});
$('refresh-devices').addEventListener('click', () => devices().catch(error => message(error.message, true)));
$('logout').addEventListener('click', async () => {
  let note = '已退出登录。'; let bad = false;
  try { await api('/api/logout', 'POST'); }
  catch { note = '已清除本页会话；服务器退出请求未成功，原会话会在到期时失效。'; bad = true; }
  finally { clearSession(); message(note, bad); }
});
$('export').addEventListener('click', async () => {
  try {
    const backup = await api('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'floccus-backup-' + new Date().toISOString().replaceAll(':', '-') + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('已开始下载账户备份，请安全保存。');
  } catch (error) { message(error.message, true); }
});
loadSetup().catch(error => message(error.message, true));
})();`;
export function adminRoutes(req: Request, path: string): Response | null {
  const resources: Record<string, [string, string]> = {
    '/admin': [page, 'text/html; charset=utf-8'],
    '/admin/': [page, 'text/html; charset=utf-8'],
    '/admin/app.js': [script, 'application/javascript; charset=utf-8'],
    '/admin/app.css': [style, 'text/css; charset=utf-8'],
  };
  const resource = resources[path];
  if (!resource) return null;
  if (!['GET', 'HEAD'].includes(req.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  return new Response(req.method === 'HEAD' ? null : resource[0], { headers: { 'Content-Type': resource[1] } });
}
