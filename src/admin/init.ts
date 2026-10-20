export function initPage(errorCode?: string, status = 200): Response {
  const messages: Record<string, string> = {
    username_password_not_configured: '请在 Worker 添加文本变量 USERNAME 和 Secret 类型的 PASSWORD（14～256字符），保存部署后重新访问 /init。',
    database_binding_required: '请先创建自己的 D1 数据库，并以 DB 为变量名绑定到本 Worker。',
    legacy_pepper_required: '旧库存在设备凭证。请先保留原 TOKEN_PEPPER 再访问 /init，程序会自动将其安全保存，避免使原设备失效。',
    secret_configuration_conflict: '旧 Secret 与数据库内部配置不一致。已停止，不会擅自替换密钥或重置凭证。',
    environment_account_unbound: '尚未确认环境变量对应的原账号。请先将 USERNAME、PASSWORD 设为原账号当前凭证，部署并访问 /init 完成关联，再修改变量。',
    environment_account_deleted: '环境变量关联的账号已删除。初始化不会重建账号或改用其他用户，请保留数据库并通过管理员恢复。',
    environment_account_changed_retry: '账号在本次处理期间发生了其他修改。请确认正在使用当前部署版本，再重新访问 /init。',
    username_unavailable: '新用户名已被其他账号使用，原账号和书签未改动。请更换 USERNAME，部署后重试。',
    rate_limited: '初始化操作过于频繁，请稍后重试。',
    secrets_not_configured: '旧版可选 Secret 不合法。保留正确旧值；新空库只需 USERNAME、PASSWORD 和 DB 绑定，不必设置其他 Secret。',
  };
  const text = errorCode ? messages[errorCode] ?? '初始化未完成。请检查 D1 绑定、账号密码配置与 Worker 日志；不要清空原数据库。' : '数据库表结构和迁移记录已准备好。变量中的账号配置已应用。修改账号或密码时会更新原账号并撤销旧凭证，原有书签保持不变。';
  const configuration = errorCode ? '' : '<p>Floccus 选择 WebDAV，URL 填本站地址加 <code>/dav/</code>，用户名和认证密码填写 <code>USERNAME</code>、<code>PASSWORD</code>。文件名 <code>bookmarks.xbel</code>、类型 XBEL，加密口令留空。</p>';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Floccus 数据库初始化</title><link rel="stylesheet" href="/admin/app.css"></head><body><main><header><h1>${errorCode ? '请完成配置' : '初始化完成'}</h1></header><section class="card"><p>${text}</p><p>新部署只需：D1 绑定名 <code>DB</code>，用户名变量 <code>USERNAME</code>，密码 Secret <code>PASSWORD</code>。内部密钥自动生成并保存在 D1，不需要手工导入 SQL。</p>${configuration}<a href="/admin">可选：导出书签备份</a></section><p>配置不变时重复访问 /init 不会撤销凭证或更换内部密钥。修改 USERNAME 或 PASSWORD 后，保存部署并访问 /init，将更新原账号，保留书签并撤销旧凭证。初始化接口只使用已部署的环境配置，不接受 URL 参数指定账号。</p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
