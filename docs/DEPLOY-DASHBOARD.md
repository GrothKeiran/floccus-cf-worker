# 方式二：Cloudflare 网页控制台手动部署

此路线的**创建 Worker、初始化 D1、绑定数据库、配置变量和发布代码**均可在 Cloudflare 网页完成，不需要用 Wrangler 部署。后续建号和签发凭证仍需调用管理 API，本项目没有可视化管理后台；[账户教程](ACCOUNTS.md)提供无需 Node.js 的 PowerShell 方式。

> 此文依据官方控制台流程和本项目源码整理；预打包 Worker 与方式一同源。没有声称已在第二个全新账号逐项点击验证此路线。Cloudflare 菜单可能随界面版本显示为中文或英文，识别相应的 Bindings、Variables and Secrets、Runtime 即可。

## 1. 下载配套发布文件

打开 [GitHub Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest)，从同一个版本下载：

| 文件 | 用途 |
|---|---|
| `worker.mjs` | 已包含依赖的单文件 ES Module Worker，粘贴到编辑器 |
| `schema.sql` | 给**新建空数据库**初始化表、索引和 Wrangler 迁移记录 |
| `THIRD_PARTY_LICENSES.txt` | 本项目及打包依赖的完整许可（Worker 内也保留注释） |
| `SHA256SUMS` | 可选：对照下载文件 SHA-256，检查下载完整性 |

不要使用 GitHub 自动生成的 Source code 压缩包代替 `worker.mjs`，不要只粘贴 `src/index.ts`，也不要混用不同版本的代码和初始 SQL。编译产物仍保留 Cloudflare 原生 `node:crypto` 导入，这是正常的，不是漏装依赖。

维护者可用 `npm ci && npm run build:dashboard` 生成相同类型的发布附件，输出在 `.cache/dashboard/`。

## 2. 创建 D1 数据库并初始化

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，选对自己的账号。
2. 进入 **Storage & databases → D1 SQL database**，点击 **Create database**。
3. 数据库名建议填 `floccus-bookmarks`，位置可根据设备所在地选择；创建数据库本身不要求开启 Workers Paid。
4. 打开刚创建的数据库，进入 **Console / 控制台**。
5. 用文本编辑器打开下载的 `schema.sql`，复制全部 SQL 到控制台，执行。若界面限制一次执行的语句量，可按分号依次执行；一旦报错就停止，先检查原因。
6. 所有建表和索引语句都成功后，文件末尾会记录 `0001_initial.sql` 已应用，方便以后切换到 Wrangler 管理。

**只对新空库执行一次。** 已有本项目数据时不要重跑初始 SQL、不要删除业务表、也不要清空后重试。不要将本项目初始化 SQL 执行到其他应用的数据库。

`schema.sql` 包含业务表以及 `d1_migrations`。末尾的迁移标记必须在前面所有 SQL 成功后执行，不能在初始化失败时提前标记完成。未来新增迁移请按版本更新说明处理，升级时不重放整份初始文件。

## 3. 创建 Worker

1. 进入 **Workers & Pages → Create application**。
2. 选择 **Start with Hello World! / Hello World 示例**，而不是 Pages 静态站点。
3. 填入一个未被自己账号使用的 Worker 名称，例如 `floccus-cf-worker`，点击 **Deploy** 创建。
4. 保存系统给出的 HTTPS 地址，后续 WebDAV 地址就是这个域名加 `/dav/`。

Hello World 只是用来先创建资源，下一步才换成本项目代码。不要覆盖自己其他已有 Worker。

## 4. 配置运行时兼容性

在 Worker 的 **Settings → Runtime / 运行时** 设置：

| 设置 | 值 |
|---|---|
| Compatibility date / 兼容日期 | `2026-10-18`，或经过维护者确认的更新日期 |
| Compatibility flags / 兼容性标志 | **`nodejs_compat`** |

保存设置。本项目使用原生 scrypt，需要 Node.js 兼容 API；不要因为导入错误而删除密码哈希代码或降低安全参数。先配置兼容性，再粘贴发布代码。

## 5. 给 Worker 绑定 D1——变量名必须是 DB

1. 打开 Worker 的 **Bindings / 绑定** 页签。
2. 点击 **Add binding → D1 database**。
3. **Variable name / 变量名填 `DB`（大写）**。
4. 数据库下拉框选择第 2 步创建的 `floccus-bookmarks`。
5. 点击 **Add binding / Save**；如果界面要求 Deploy，则完成发布。

这里是**资源绑定**，不要在普通环境变量里创建一个名叫 `DB` 的文本，也不要把数据库 UUID 当成字符串填给代码。控制台会自动关联实际 D1，Worker 才能调用 `env.DB.prepare(...)`。

数据库显示名可以不同，但代码读取的绑定名不能改成 `floccus_bookmarks` 或其他值，除非同时修改源码。

## 6. 配置两个 Secret 和四个文本变量

进入 **Settings → Variables and Secrets / 变量和机密**。全部配置在同一个生产 Worker 环境中，不要只加到预览环境。

### 两个 Secret

点击新增，类型选择 **Secret / 加密值**：

| 名称 | 值 |
|---|---|
| `ADMIN_TOKEN` | 第一份独立强随机字符串，推荐 32 随机字节编码为 64 个十六进制字符 |
| `TOKEN_PEPPER` | 第二份独立强随机字符串，同样推荐 64 个十六进制字符，不能与上面相同 |

每个值至少 32 字符，不要用简单口令或文档示例。建议用密码管理器生成并保管。也可在 Windows PowerShell 中运行以下代码，每次运行生成一份新值，分别运行两次：

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
[BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
```

Secret 在保存后不能直接重新查看，先放入自己的密码管理器。不要把 Secret 上传到 GitHub、截图分享，或粘贴到 Floccus。未来改动 `TOKEN_PEPPER` 会使已有凭证失效，不要随意更换。

### 四个普通文本变量

| 名称 | 类型 | 值 |
|---|---|---|
| `ALLOW_REGISTRATION` | Text | `false` |
| `ALLOW_INSECURE_LOCALHOST` | Text | `false` |
| `MAX_BODY_BYTES` | Text | `524288` |
| `MAX_NODES` | Text | `5000` |

填写时只输入表中的值，不额外带引号。`false` 关闭公开注册，不影响管理员创建账户。文件大小和节点数是应用限制，不是 Cloudflare 数据库存储容量。

**Dashboard 不读取仓库的 TOML。** 不会因为 GitHub 模板写了这些变量就自动生效，必须在页面实际填写并保存。

## 7. 粘贴 Worker 代码并发布

1. 打开 Worker 的 **Edit code / 编辑代码**。
2. 用文本编辑器打开下载的 `worker.mjs`，复制**全部内容**。
3. 在控制台编辑器中替换默认入口 `worker.js` 的示例代码；入口文件可保留 `worker.js` 名称，不需要建立多个源码文件。
4. 点击 **Deploy / 部署**。仅点 Save 或本地预览不代表正式地址已经更新。

这是模块语法（`export default`），不是旧式 `addEventListener('fetch', ...)`。如果出现 `node:crypto` 不可用，回到第 4 步检查兼容性；如果提示模块找不到，检查是否误用了未打包的 TypeScript 源文件。

页面编辑时不要误删第 5、6 步的数据库绑定与变量。

## 8. 添加每日清理任务

进入 Worker 的 **Settings → Trigger Events / 触发事件 → Cron Triggers**，新增：

```text
17 3 * * *
```

时区为 UTC：每天 **UTC 03:17 / 北京时间 11:17**。它清理过期会话、过期锁、旧临时文件、超过一天的限流记录和超过 30 天的审计记录；不会自动删除用户书签或永久删除墓碑。

Wrangler 路线会从配置自动创建这个触发器；手动路线必须自己添加，不能只粘贴 Worker 代码就省略。

## 9. 查看就绪状态，然后创建账户

访问**自己的 Worker 域名**的 `/health/ready`，应返回：

```json
{"status":"ready"}
```

- `503 secrets_not_configured`：检查两个 Secret 的名称、长度和正式部署。
- `500 internal_error`：检查 `DB` 是 D1 资源绑定，以及是否对正确数据库完整执行了 SQL。
- 根路径 `/` 返回 404：正常，本项目没有首页或注册网页。
- `ready` 不会自动创建用户，也不证明已完成真实书签同步。

下一步按[账户与设备应用密码](ACCOUNTS.md)建号，再按照 [Floccus 配置](FLOCCUS.md)连接。WebDAV URL 是自己的根地址后加 `/dav/`，不是 `/health/ready`。

## 10. 以后更新

先导出和备份数据库，再阅读新版本变更记录。仅替换新的 `worker.mjs` 不会执行数据库迁移；如果有新增迁移，应按说明先应用新增 SQL。不要重跑整份 `schema.sql`。D1 绑定、Secret 和普通变量需要保留。

要切换为 Wrangler 管理时，下载源码，复制配置模板，把自己的 Worker 名和 D1 UUID 填入本地配置，先 `d1 migrations list` 核对记录，再部署。不要同时让网页编辑和 Git 构建互相覆盖而不记录版本。

## 官方参考

- [D1：控制台创建数据库、执行 SQL 与绑定 Worker](https://developers.cloudflare.com/d1/get-started/)
- [Workers：Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers：兼容性标志](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Workers：Node.js crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [D1：迁移记录](https://developers.cloudflare.com/d1/reference/migrations/)
