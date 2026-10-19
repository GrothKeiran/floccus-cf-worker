# 部署、费用与维护

首次部署请选择一种路线：[方式一：Wrangler 命令行](DEPLOY-WRANGLER.md)，或[方式二：Cloudflare 网页控制台](DEPLOY-DASHBOARD.md)。两者使用相同源码和迁移；本文主要介绍额度、备份、恢复与升级。

公开仓库只包含 `wrangler.example.toml`。Wrangler 操作前先复制为私有的 `wrangler.toml`，填自己的资源信息；控制台路线则在网页逐项配置，不读取 TOML。

## 部署前检查

1. 复制 `wrangler.example.toml` 为 `wrangler.toml`（已有配置不要覆盖），Node/npm 依赖使用锁文件，执行 `npm ci && npm run check`。此处 check 为本地类型/测试/构建，不会创建远端资源。
2. 登录正确 Cloudflare 账号。`node scripts/run.mjs wrangler whoami` 核对身份。
3. `npm run configure` 创建 `floccus-bookmarks` 并保存实际 UUID；已有数据库用交互输入 UUID 的方式绑定，不能使用全零本地 ID。
4. `npm run db:remote` 应用迁移；`ADMIN_TOKEN`、`TOKEN_PEPPER` 分别通过 Wrangler Secret 配置。各自至少 32 字符，推荐 32 随机字节。
5. `npm run deploy`，核对真实返回地址，验证 `/health/ready`，再使用管理 CLI 创建账号。
6. 线上仅开放 HTTPS。可以用自有 Worker Custom Domain；不要把 Cloudflare Access 的浏览器登录页面放在 `/dav/` 前面，官方扩展无法通过该额外认证页面。
7. `ALLOW_REGISTRATION` 保持 false。`ALLOW_INSECURE_LOCALHOST=true` 也只接受 loopback URL 的 HTTP，不使线上普通域名变成明文服务；可在生产改 false。

`wrangler.toml` 的 `DB` 绑定、数据库名和脚本一致。生产只有 Workers+D1；不使用额外的 KV、R2、Durable Objects、外部 PHP 或常驻服务。定时清理每天 **03:17 UTC（北京时间 11:17）** 执行。

本地迁移、dev 使用同一个 `.cache/wrangler/state`；请使用 package scripts，别误用默认 `.wrangler/state` 创建第二套本地库。

## 配置值

| 配置 | 默认 | 说明 |
|---|---|---|
| `ADMIN_TOKEN` | 无 | Secret，建号与密码恢复，推荐随机 32 bytes |
| `TOKEN_PEPPER` | 无 | 独立 Secret，为随机凭证/限流键生成 HMAC |
| `ALLOW_REGISTRATION` | false | 自助注册开关，无邮箱验证；不建议公开开启 |
| `ALLOW_INSECURE_LOCALHOST` | true | 只限回环域名开发 HTTP |
| `MAX_BODY_BYTES` | 524288 | XBEL 输入字节限制，硬上限 1,000,000 |
| `MAX_NODES` | 5000 | 活跃节点数，根不计；硬上限 10,000 |

另有固定限制：64 层、标题/URL 各 4096 字符、最多 50 个活跃凭证、每用户累计 50,000 个非根节点（包含墓碑）。派生节点 JSON 最大 1,500,000 bytes。调大输入限制不能绕过其他限制，不应在免费套餐未经压测直接提高。

## 免费与付费：不承诺“必定免费”

下列是 **2026-10-18** 核对官方文档的摘要，账单以 Cloudflare 当前账号、产品页面和合同为准：

| 产品 | 免费额度/限制 | 本项目影响 |
|---|---|---|
| Workers Free | 100,000 请求/日；每次 10 ms CPU | 文件往返包含多次请求；大 XML 和 scrypt 可能超过 CPU 限制 |
| D1 Free | 5,000,000 行读取/日；100,000 行写入/日 | 不是“SQL 请求数”，索引写入和清理也计费/计额度 |
| D1 Free 存储 | 账号共 5 GB、单库最大 500 MB | 多用户、墓碑、临时文件、审计及索引持续占用 |
| D1 每次请求 | Free 最多 50 个查询；单值/行 2,000,000 bytes；每查询最多 100 参数 | 本项目 JSON 批处理不按书签数增加查询数量，但节点/文档大小仍受限 |
| Workers Paid | 账号最低 $5/月；含每月 10M 请求及 30M CPU ms，超额请求 $0.30/M、CPU $0.02/M ms | 需要更高 CPU/调用量时才考虑，不由本项目自动开通 |
| D1 Paid | 每月含读取 25 billion 行、写入 50M 行；之后 $0.001/M 行读、$1/M 行写；含 5 GB，超额 $0.75/GB-month | 按官方 D1 页面核算，不能把 DO 的 SQLite 费率套到 D1 |

**强密码哈希**：线上 Workers 拒绝 600,000 次 PBKDF2（平台原生上限 100,000）。现使用原生 scrypt（N=16384、r=8、p=5，OWASP 推荐列表配置），已确认真实平台支持。未测得 Free CPU 计费，不保证全部负载可在免费额度下运行；不得为规避限制降低哈希强度。随机应用密码的每次 DAV 请求只做原生 HMAC，不重复 scrypt。

**行读写成本**：每请求含 D1 限流与凭证查询。一次有变化的全树提交要扫描节点和 JSON、写变化节点/墓碑/状态与索引；无变化的官方同步不 PUT 快照。单节点改动不再 upsert 写未变化行，但仍需全树解析/比较。不能用“每次只有一次 batch”当作“只算一次行写入”。

**其他可能费用**：自有域名注册、Cloudflare 付费安全/日志能力、开发机存储、网络或自选备份存储不由本项目包含。没有自动购买服务。Free 额度用尽通常是请求失败/停止工作，不是无限可用；应查看 D1/Workers 控制台 Usage，设置预算/CPU 上限，避免拒绝服务或意外账单。

官方依据：
- [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

## 备份

### 每用户导出（不含凭证）

已登录后执行：

```bash
npm run client -- export
```

在 `backups/` 生成 JSON 和 XBEL；模式 0600。JSON 含节点版本/删除墓碑，XBEL 供浏览器/Floccus 导入。这个备份**不是全库可直接恢复的 SQL**。

### D1 全库导出

停止客户端同步、等正在进行的写入结束，或在维护窗口撤销设备凭证；避免把异步外部操作误当跨文件全局事务。然后：

```bash
mkdir -p backups
umask 077
node scripts/run.mjs wrangler d1 export floccus-bookmarks --remote --output backups/d1-full.sql
```

固定文件名会覆盖旧备份前先另行归档；建议加密、离线保存，并另行保存 `TOKEN_PEPPER` Secret（不可提交仓库）。SQL 包含管理密码哈希、凭证摘要及所有用户内容，是高敏感备份。

Wrangler 当前本地 export 不提供 `--persist-to` 参数，不能给它随意添加该参数从而备份错误的库。本地数据可用管理 API 导出；全库维护流程主要面向线上 D1，未冒充已在线演练。

## 恢复

### 只恢复书签

先所有设备导出当前书签并暂停同步。通过浏览器导入备份 XBEL/合适的书签导出格式，在**新的账户/同步基线**中重新建立同步。不要向现有账号手工 PUT 含已删 ID 的旧 XBEL：这会被墓碑/最高 ID 保护拒绝。

若浏览器不支持直接导入 XBEL，可在离线测试环境使用 Floccus WebDAV + 导出文件恢复，或先用已核对可信工具转换格式；本项目没有假称浏览器原生都支持 XBEL。JSON 的 nodes 字段是结构化导出，不是一个可直接 POST 的自定义 Floccus API。

### 整库灾难恢复（新空 D1，保留旧库）

不要向已有 schema 的线上库直接叠加 `CREATE TABLE`。备份原配置，然后创建独立恢复库：

```bash
cp wrangler.toml backups/wrangler-before-restore.toml
node scripts/run.mjs wrangler d1 create floccus-bookmarks-restore
read -rp '刚创建的恢复库 UUID: ' RESTORE_D1_ID
npm run configure -- "$RESTORE_D1_ID"
# 当前绑定 DB 现在指向新的空库；逻辑 database_name 保持原名供脚本查找。
node scripts/run.mjs wrangler d1 execute floccus-bookmarks --remote --file backups/d1-full.sql
# 恢复旧凭证可能使已撤销的设备重新获得访问权，因此在上线前撤销它们。
node scripts/run.mjs wrangler d1 execute floccus-bookmarks --remote --command 'DELETE FROM credentials; DELETE FROM staging; DELETE FROM sync_locks;'
node scripts/run.mjs wrangler d1 migrations list floccus-bookmarks --remote
# 核查恢复库已有 schema 和迁移表后再发布；不要重放已导入的初始迁移。
npm run deploy
```

`database_name` 是配置中的查找名，恢复库真实资源由 UUID 选择；也可统一修改配置/脚本使名字对应。不要误把恢复 SQL 导入原库。导出是否包含迁移表由当前 Wrangler 格式决定，导入后应核对 `d1_migrations` 和待执行列表，不能盲目重放已包含的迁移。

随后检查 `/health/ready`，管理员恢复密码或用户用原密码重新登录，给每台设备签发新应用密码。**旧设备缓存与回滚后的版本/墓碑可能不一致**，需要人工对照备份并重新规划同步基线，不可直接全部恢复自动同步。保留旧库用于回退。线上数据库导入、Time Travel 和切库尚未在本环境实际执行，必须先在自己的测试账号演练。

可选 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 受套餐与保留窗口约束，不代替独立导出。恢复旧状态同样涉及凭证复活和设备缓存冲突。

## 升级与迁移失败

1. 发布前运行 `npm ci && npm run check`；阅读变更日志及协议基线，不直接跟随上游 main。
2. 暂停同步，在维护窗口备份 D1 和部署配置。
3. 新增按编号递增的迁移文件，**不编辑已执行的 `0001_initial.sql`**。优先采用向后兼容的加字段/加表迁移，再更新 Worker。
4. 本地 `npm run db:local` 验证，再 `npm run db:remote`。检查列表每项成功后才 `npm run deploy`。
5. 应用迁移失败：停止发布，保留上一版 Worker；检查失败原因和 D1 schema，确认哪些迁移已成功，修复后再应用。不要删除线上迁移记录“强制成功”，不要声称多文件迁移整体必然原子。
6. 若新 Worker 失败但 schema 向后兼容，可部署上一版代码/使用 Cloudflare 版本回退；若 schema 不兼容，在独立恢复库按上述流程恢复并切换。没有通用安全的自动 down migration。
7. 依赖升级分别验证类型、工作运行时、官方 adapter/engine 回归和实际浏览器；修改固定 Floccus 提交时同时更新研究和测试证据。

## 安全恢复密码

```bash
read -rsp 'ADMIN_TOKEN: ' ADMIN_TOKEN; echo; export ADMIN_TOKEN
read -rsp '新密码（至少14字符）: ' FLOCCUS_PASSWORD; echo
export FLOCCUS_PASSWORD
npm run client -- reset-password alice
unset ADMIN_TOKEN FLOCCUS_PASSWORD
```

该操作撤销所有旧会话和应用密码，连带释放锁并清除临时文件，不删除用户书签。新登录后为各设备重新签发应用密码。没有邮件、默认后门或可猜测的重置 token。
