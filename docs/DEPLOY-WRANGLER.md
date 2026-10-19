# 方式一：Wrangler 命令行部署

这是已实际完成过 Worker + D1 部署的路线。可自行执行，也可由获得授权的 AI 编程助手协助；账号授权、资源归属和是否购买套餐应由部署者掌握。不会要求 VPS、Docker 或常驻服务。

以下命令使用 Bash / Git Bash / WSL。Windows 不想使用终端部署时，可选择[方式二](DEPLOY-DASHBOARD.md)。

## 1. 下载项目并安装依赖

要求 Node.js 22.14+（推荐 24）、npm、Git，以及自己的 Cloudflare 账号。

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
```

`wrangler.toml` 已被 Git 忽略，以免把账号、D1 ID 等部署信息公开。后续升级不能用模板覆盖已经配好的文件。数据库 ID 全零只供本地开发，不能据此部署到线上。

如果同一个 Cloudflare 账号已存在名为 `floccus-cf-worker` 的 Worker，请先把 `wrangler.toml` 的 `name` 改为新的名字，避免覆盖已有服务。

## 2. 登录 Cloudflare

```bash
node scripts/run.mjs wrangler login
node scripts/run.mjs wrangler whoami
```

在浏览器确认登录和授权，核对正确账号。多个账户时，根据 Wrangler 提示选择，或在本地 `wrangler.toml` 填自己的 `account_id`。不要把 OAuth token 发给其他人。

## 3. 创建或绑定 D1

### 新数据库

```bash
npm run configure
```

脚本创建名为 `floccus-bookmarks` 的 D1，自动把实际 UUID 写进 `wrangler.toml`。已配置真实 UUID 时，脚本会拒绝重复创建。

### 已有数据库

使用一个为本项目准备的数据库，先备份，不要借用有其他应用数据的库：

```bash
read -rp '已有 D1 数据库 UUID: ' D1_ID
npm run configure -- "$D1_ID"
```

本项目的关键绑定必须为：

```toml
[[d1_databases]]
binding = "DB"
database_name = "floccus-bookmarks"
database_id = "这里是你自己的实际 UUID"
migrations_dir = "migrations"
```

`binding = "DB"` 是代码读取的 `env.DB`；不是数据库显示名称，也不能照搬其他教程里的变量名。如果使用不同的数据库名字，需同步调整 `database_name` 和 `package.json` 的 `db:*` 命令。

## 4. 执行线上迁移

```bash
npm run db:remote
```

首次应成功应用 `0001_initial.sql`，再进行部署。迁移失败时先解决错误，不要删库、篡改迁移记录或重复创建数据库来掩盖问题。

从控制台路线迁移过来时，配套 `schema.sql` 已记录 `d1_migrations`；先查看待执行列表，只应用新增迁移，不重复手工执行初始 SQL：

```bash
node scripts/run.mjs wrangler d1 migrations list floccus-bookmarks --remote
```

## 5. 设置普通变量和两个 Secret

普通变量已经在模板 `[vars]` 中：

| 名称 | 建议值 | 说明 |
|---|---|---|
| `ALLOW_REGISTRATION` | `false` | 只允许管理员建号 |
| `ALLOW_INSECURE_LOCALHOST` | `true` 或生产改 `false` | 只对本机 localhost HTTP 生效，公网始终要求 HTTPS |
| `MAX_BODY_BYTES` | `524288` | XBEL 文件大小上限 |
| `MAX_NODES` | `5000` | 书签、文件夹合计上限 |

用密码管理器，或分别运行两次以下命令，生成两份不同的随机值：

```bash
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

将两份值安全保存，分别在以下交互提示中输入：

```bash
node scripts/run.mjs wrangler secret put ADMIN_TOKEN
node scripts/run.mjs wrangler secret put TOKEN_PEPPER
```

若 Worker 尚不存在，Wrangler 可能询问是否创建；确认是准备部署的新 Worker 后继续。`ADMIN_TOKEN` 供管理员建号/恢复密码，`TOKEN_PEPPER` 用于凭证 HMAC，两者不能相同。它们不是 Floccus 的登录密码。

本地 `.dev.vars` 不会自动成为生产 Secrets，也不应直接把示例占位值上传。不要在命令参数、代码或 Git 提交里写真实 Secret。

## 6. 部署 Worker

```bash
npm run deploy
```

记下 Wrangler 返回的真实 HTTPS 根地址。配置中已经开启 `nodejs_compat`、日期 `2026-10-18`、D1 `DB` 绑定，以及每日 UTC 03:17 的清理任务。

打开该地址的 `/health/ready`，应返回：

```json
{"status":"ready"}
```

它只证明必要 Secrets 和数据库初始表可用，不能替代真实 Floccus 同步。根路径 `/` 返回 404 是正常的，本项目没有首页。

## 7. 创建账户、配置扩展

继续阅读[账户与设备应用密码](ACCOUNTS.md)，之后按 [Floccus 配置](FLOCCUS.md)填写。每个浏览器签发不同应用密码；第一次先同步一台，再接入下一台。

## 参考与后续维护

- [Cloudflare D1 官方入门](https://developers.cloudflare.com/d1/get-started/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
- 本项目[备份、恢复、费用与升级](DEPLOYMENT.md)
