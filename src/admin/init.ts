export function initPage(errorCode?: string, status = 200): Response {
  const messages: Record<string, string> = {
    username_password_not_configured: '请在 Worker 添加文本变量 USERNAME 和 Secret 类型的 PASSWORD（14～256字符），保存部署后重新访问 /init。',
    database_binding_required: '请先创建自己的 D1 数据库，并以 DB 为变量名绑定到本 Worker。',
    legacy_pepper_required: '旧库存在设备凭证。请先保留原 TOKEN_PEPPER 再访问 /init，程序会自动将其安全保存，避免使原设备失效。',
    secret_configuration_conflict: '旧 Secret 与数据库内部配置不一致。已停止，不会擅自替换密钥或重置凭证。',
    secrets_not_configured: '旧版可选 Secret 不合法。保留正确旧值；新空库只需 USERNAME、PASSWORD 和 DB 绑定，不必设置其他 Secret。',
  };
  const text = errorCode ? messages[errorCode] ?? '初始化未完成。请检查 D1 绑定、账号密码配置与 Worker 日志；不要清空原数据库。' : '数据库表结构和迁移记录已准备好。变量中的账号已初始化进表；如果已有账号，则保持原账号和书签，不会覆盖密码。';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Floccus 数据库初始化</title><link rel="stylesheet" href="/admin/app.css"></head><body><main><header><h1>${errorCode ? '请完成配置' : '初始化完成'}</h1></header><section class="card"><p>${text}</p><p>新部署只需：D1 绑定名 <code>DB</code>，用户名变量 <code>USERNAME</code>，密码 Secret <code>PASSWORD</code>。内部密钥自动生成并保存在 D1，不需要手工导入 SQL。</p><a href="/admin">进入账号管理</a></section><p>重复访问 /init 不会清空书签、重置密码或更换内部密钥。初始化接口只使用已部署的环境配置，不接受 URL 参数指定账号。</p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
