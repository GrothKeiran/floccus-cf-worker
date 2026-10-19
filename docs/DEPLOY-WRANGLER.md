# Wrangler 部署：两个变量 + D1，访问 /init 自动建表

要求 Node.js 22.14+（推荐 24）、npm、Git。以下使用 Bash / Git Bash / WSL；不想开终端可直接用[控制台部署](DEPLOY-DASHBOARD.md)。

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
node scripts/run.mjs wrangler login
npm run configure
node scripts/run.mjs wrangler secret put PASSWORD
npm run deploy
```

- 用户名在本地 `wrangler.toml` 的 `[vars] USERNAME` 中设置。
- 交互提示输入自己的强账户密码（14～256字符）。
- `npm run configure` 创建 D1，并把真实 UUID 写进本地配置；`DB` 是必须保留的绑定名。
- **不需要 `npm run db:remote`，不需要手工导入 SQL，也不需要另外设置管理 Token 或 Pepper。**
- `wrangler.toml` 已被 Git 忽略，不公开真实资源 ID；已有文件不要用模板覆盖。

已有 D1 时不要重复创建：

```bash
read -rp '自己的 D1 UUID: ' D1_ID
npm run configure -- "$D1_ID"
```

如果账号里已有同名 Worker，先修改配置中的 `name`，避免覆盖无关服务。多个 Cloudflare 账户时核对正确账号。

## 部署后访问 /init

打开 Wrangler 返回的 HTTPS 域名后加 **`/init`**。程序自动应用所有表结构、生成并持久保存内部密钥，并将环境 `USERNAME`、`PASSWORD` 初始化进用户表。已有用户不覆盖，重复访问不清空数据或更换密钥。

然后打开 **`/admin`**，用自己的账户密码登录，为每个浏览器生成独立应用密码。详细见[账户教程](ACCOUNTS.md)和 [Floccus 配置](FLOCCUS.md)。

## 后续升级

先备份 D1，再拉取源码、安装依赖、部署新版，最后访问 `/init` 自动应用新增迁移。结构来自 `migrations/`，运行时已经内嵌，不需要用户执行 SQL。

旧版 v0.1/v0.2 用户先保留原 Secrets，按[升级说明](UPGRADE-0.3.md)迁入 D1，再移除额外变量。不要直接丢掉原 Pepper 导致旧设备失效。

Cron 不再是部署前提，程序有请求触发的自动清理；高级用户仍可自选 Cron。默认容量、安全设置已经内置，不需要另填 MAX_* 或注册开关。

## 可选高级维护

`db:local`、`db:remote` 和管理 API/CLI 仍保留给开发与维护人员，不是普通部署步骤。自行变更迁移后运行 `npm run schema:generate`，确保内嵌结构同步；`typecheck` 会检查是否过期。
