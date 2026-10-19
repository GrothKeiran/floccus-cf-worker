# 安全配置与故障排查

## 已实现的保护

- 管理密码使用 Workers 原生 `node:crypto` scrypt、独立 128-bit 随机盐、N=16384/r=8/p=5、256-bit 输出。该配置在 OWASP 推荐列表中，且已在真实线上 Worker 确认平台支持；不再使用被线上平台拒绝的 600,000 次 PBKDF2。没有自制弱哈希、明文密码或日志密码。
- 管理 token / device 应用密码来自 `crypto.getRandomValues` 的 32 随机字节。D1 仅保存 TOKEN_PEPPER 作为 HMAC 密钥得到的摘要。它们不是低熵用户口令，不需要逐请求重复昂贵密码派生。
- 等长摘要通过 Workers `crypto.subtle.timingSafeEqual` 比较。未知账号也执行等量 scrypt，避免直接跳过产生明显时序枚举。
- 管理和 DAV 分离：管理为 Bearer，会话 24 小时；DAV 为用户名+独立应用密码 Basic；登录密码不可直接同步。
- 不发 Cookie，不读取浏览器已有 Cookie，不依赖 Cookie 会话，因而不伪造 Cookie 的 CSRF 防护。管理 API 要求 Authorization 和 JSON Content-Type；不反射 CORS Origin，不支持跨域网页自动携带身份。
- 强制 HTTPS，唯独本地 loopback 开发可开 HTTP。无重定向认证，响应 no-store、nosniff、CSP、HSTS，无远端 URL 抓取。
- 数据行与父外键带 user_id；所有查询从认证上下文注入作用域。SQL 值全使用绑定，不拼接用户名/URL/节点标题。
- 流式读取限制实际累计字节数，不能靠省略或伪造 Content-Length 绕过；JSON 8 KiB，锁正文 1 KiB，XBEL 默认 512 KiB；严格 UTF-8、XML/层级/URL 验证。
- 临时文件只能由当前租约所有者查看或提交；D1 原子抢锁及版本 CAS；随机 generation 阻止旧锁越过过期/重抢边界。
- 节点 ID 删除墓碑和 highestId 防止按旧 ID 复活；重复同文档提交是幂等的，不是“允许任意旧请求无限重放”。
- 审计只保存账户生命周期、登录事件、设备变更和快照提交等安全事件。请求 500 仅记随机 requestId/CF-Ray，不记密码、认证头、查询参数、正文或 SQL 堆栈。用户数据删除时个人日志级联删除。

### 限流与配额

D1 原子固定窗口计数（不是单 isolate 内存限流）：

| 维度 | 限制/分钟 |
|---|---|
| IP（所有 `/api/` / `/dav/`） | 1800 |
| 注册/管理员建号每 IP | 5 |
| 登录每 IP | 15 |
| 登录每用户名 | 10 |
| 管理员重置每 IP | 5 |
| 账号管理接口每用户 | 120 |
| DAV 每用户 | 1200 |

IP 使用 Cloudflare 覆写的 `CF-Connecting-IP`，不信任 `X-Forwarded-For`。直接运行在无 Cloudflare 保护的开发端口不能视为可靠 IP 防护。固定窗口允许边界突发，D1 限流也有数据库成本；公开服务应配合 Cloudflare 适当的 WAF/速率限制规则、使用量告警和付费资源预算，不把应用层限流包装成完整 DDoS 防护。

每账号最多 50 个活跃凭证，新增使用单 SQL 原子配额判断。文件节点默认最多 5,000、最多 64 层；包含墓碑的累计历史节点限制 50,000，达到后需导出并规划新账户/基线，不自动清墓碑释放空间。全账号存储与管理员建号总量仍受 D1 全库额度约束，默认禁止公开注册。

可在项目目录定期执行 `npm audit --audit-level=high` 检查锁文件依赖。首次交付已修复旧测试运行时已知高危公告，最终全依赖审计为 0；这不是外部渗透测试或未知漏洞保证。

## 必须理解的威胁边界

1. Basic 和 Bearer 是持有即授权的凭证。TLS 降低窃听风险，但**拿到有效凭证的攻击者可模拟该设备**；原版 Floccus 不发送 nonce/请求签名。不能宣传“完全阻止被盗凭证重放”。撤销设备/会话并轮换管理秘密是恢复办法。
2. 同一个应用密码不能共享给多台设备；参见 [协议说明](PROTOCOL.md#为什么每设备必须单独应用密码)。不能在不修改官方扩展的前提下区分相同凭证的两个客户端。
3. 服务器可看见明文书签。D1 平台安全不是端到端加密。本版不接受 Floccus 加密文件，因为需要节点校验/墓碑；明确留空 passphrase，不偷偷上传明文替代用户加密意图。
4. 能管理 Cloudflare 账号、D1 或 ADMIN_TOKEN 的管理员有高权限。ADMIN_TOKEN 不是普通用户 token；只在管理终端使用，不填进扩展，不发给普通用户。
5. 损失 Floccus 缓存后的新 ID 重建语义无法由 WebDAV 识别；同 URL 允许重复收藏。墓碑不意味着能识别跨新 ID 的同一“逻辑书签”。
6. 应用层校验 URL 安全不等于浏览器内容安全，也不访问 URL 校验是否真实存在。脚本、data、file 和内部页面书签会拒绝全次上传，不能当成已经悄悄同步/跳过。
7. 本地 workerd 没有复现 Cloudflare 全球网络、Free CPU/配额、区域故障或浏览器 extension 权限/签名限制；回归测试不是外部安全审计。

## Secrets 与本地文件

- `.dev.vars` 与 `.cache/`、`backups/` 已 gitignore。真实 Secret 使用 `wrangler secret put`，不填进 TOML、源码或截图。
- `.cache/client/session.json` 含实际管理 token；CLI 退出登录会删除它，文件权限 0600 只是本地操作系统辅助保护，不能代替机器安全。
- export JSON 含个人书签；全库 SQL 还有密码哈希/凭证摘要，应加密和限制访问。
- TOKEN_PEPPER 变更使现有令牌摘要无法验证；所有用户需重新登录并创建设备凭证。变更后应安全删除旧 credentials、staging、sync_locks，避免旧设备/锁遗留；管理密码的独立盐 scrypt 不依赖 pepper。
- 恢复旧 D1 备份可能恢复已撤销的 token 摘要，恢复后先撤销全部 credentials，再开放同步。
- ADMIN_TOKEN 泄露：立刻用 Wrangler 重新设置，检查 Cloudflare 与审计记录；有理由怀疑用户凭证也泄露时一并撤销，不能仅改 README 值。

## 故障排查

| 现象 | 检查/处理 |
|---|---|
| 401 / Floccus 认证失败 | 后端选 WebDAV；用户名正确；用该设备 app_ 密码而不是登录密码；检查是否被撤销；不要让 Access 登录页阻挡 |
| 404 首次 XBEL | 正常，首次官方同步创建；若不是首次，核对用户名、URL `/dav/` 和固定文件名，注意不要用错账号 |
| 404 未知路径 | 只支持固定 bookmarks.xbel 及 .temp/.lock，不是通用文件服务 |
| 423 resource_locked | 另一设备同步中；等待完成或 15 分钟到期。确认没有共享应用密码；不要手工删其他设备锁 |
| 同凭证再次 PUT 锁 423 | 90 秒内保护；官方正常续租间隔 2 分钟。重复/同时启动两套相同凭证配置是不受支持的操作 |
| 412 stale_sync_retry / highest_id_regression | 基线变化或旧 ID 复活；暂停，备份本地，再正常重新同步。不要回滚 highestId、删墓碑或强制覆盖 |
| 422 unsafe_url / unsafe_xml | 移走不同意的 scheme；XBEL 必须是官方生成格式，不包含 HTML、加密 JSON、外部实体或任意扩展字段 |
| 422 history_node_limit | 含墓碑历史数达到累计上限；导出并规划新的账号/同步基线，不能自动回收 ID |
| 413 | 实际文档/派生数据超限；减少同步子树或按账号合理分拆。改限制前验证 CPU/D1 限制 |
| 429 | 等 Retry-After；调查轮询频率、共享账号数量和错误认证，别用无限重试扩大 D1 开销 |
| E019 / PROPFIND 长度错误 | 代理应保留 PROPFIND/MOVE/PUT/DELETE、Destination、Overwrite、Depth；不要把 XML 长度算成 JS 字符数，不做透明正文改写 |
| 免费套餐 CPU 超限 | 查看 Workers 指标；强哈希/大快照可能需要 Paid，不修改哈希为不安全值 |
| 503 secrets_not_configured | 独立真实 Secrets 至少32字符，不能保留 replace 示例；确认远端 Secret 已设置，非只有本地 `.dev.vars` |
| 500 | 核对绑定 DB、远端迁移状态、D1 配额/服务故障；检查匿名 requestId 事件，不把认证请求全文贴到 issue |
| 本地迁移成功但 dev 没数据 | 都用 npm 脚本的 `.cache/wrangler/state`；改变 database_id 后本地绑定是另一数据库 |
| 部署成功但没有跨设备变化 | 确认双方选原生书签栏、同用户同文件、独立设备密码、双向策略且启用；检查本地同步日志与扩展 host 权限 |
| 测试拉取源码失败 | 首次需 GitHub 网络/Git；固定 SHA 不变。成功准备后可离线重复跑，不能无证据替换上游实现 |

验证 cron 可在本地 dev 运行时：

```bash
curl --fail http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

这是 Wrangler 开发专用路由，不是线上给匿名访问者的任务接口。**不要把带调试 Explorer 的 `wrangler dev --ip 0.0.0.0` 暴露给不可信网络**；常规只用默认 loopback。

## 网页管理与一次性初始化（v0.2.0）

- `/admin` 只提供静态同源页面，不向 HTML、JS 或状态接口注入任何环境密码、管理员 Token 或用户列表。
- 新空库用 `BOOTSTRAP_USERNAME` 与 Secret `BOOTSTRAP_PASSWORD` 授权一次性建号；必须提交匹配凭证，公开访问网页或状态接口本身不会建号。
- D1 事务 guard 与持久 `bootstrap_state` 标记保证并发最多成功一次；已有用户时拒绝初始化；删除初始账号后保留标记，不会自动重建。
- 初始变量不是重置密码机制，初始化成功后建议移除；后续仍用数据库密码哈希验证。
- 管理会话保存在页面内存，不使用 Cookie/浏览器存储；刷新或关闭会丢失本地会话。退出通过 API 撤销会话，其他未退出会话仍按原到期时间失效。
- 状态变更 API 拒绝显式跨源 Origin，兼容不携带 Origin 的 CLI；页面使用严格同源 CSP，不加载第三方脚本、不用 innerHTML 插入设备名。
- 应用密码只在签发时返回，列表不含密码原文或摘要；每台浏览器独立签发，账户密码仍不能用于 DAV。
