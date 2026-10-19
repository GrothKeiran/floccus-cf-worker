# Floccus Cloudflare Workers + D1

纯 **Cloudflare Workers + D1** 的浏览器书签同步后端，兼容官方 Floccus 的 **WebDAV / XBEL**。不需要 VPS、Docker、Nextcloud 或修改扩展。

## 最简配置：两个变量 + 一个 D1 绑定

| 名称 | 类型 | 填什么 |
|---|---|---|
| `USERNAME` | Worker 普通文本变量 | 自己的用户名，例如 `owner` |
| `PASSWORD` | Worker **Secret** | 自己的强账户密码，14～256 字符 |
| `DB` | **D1 数据库资源绑定** | 新建自己的 D1，然后绑定到 Worker，变量名必须为 `DB` |

**不需要手动建表、导入 SQL、配置 `ADMIN_TOKEN` / `TOKEN_PEPPER`，也不需要设置 Cron。**

部署后在浏览器访问：

```text
https://你的Worker域名/init
```

程序会自动完成：

1. 创建所有必需的表、索引和迁移记录。
2. 将 Worker 变量中的 `USERNAME` 和 `PASSWORD` 初始化进用户表；**密码保存 scrypt 哈希，不存明文**。
3. 自动生成并在 D1 持久保存内部安全密钥，重新部署不会丢失。
4. 保留已有账号、设备凭证和书签，重复访问不会清空数据、重置密码或更换密钥。

`/init` 只使用 Worker 已配置的变量，不接受 URL 或请求体指定另一个账号。已有账号不会被变量覆盖；修改变量不是重置密码功能。

## 两种部署方式

### 方式一：Wrangler 命令行部署

适合有 Node.js 的用户，也可以交给获得授权的 AI 编程助手执行：

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
node scripts/run.mjs wrangler login
npm run configure
# 在交互提示中输入自己的账户密码；用户名在 wrangler.toml 的 USERNAME 中设置
node scripts/run.mjs wrangler secret put PASSWORD
npm run deploy
```

然后打开自己的 `/init`。**不必执行 `db:remote`，不必手动应用迁移。** 完整步骤：[Wrangler 教程](docs/DEPLOY-WRANGLER.md)。

### 方式二：Cloudflare 网页控制台部署

1. 从 [Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest) 下载 **`worker.mjs`**。
2. 在 Cloudflare 创建一个 **Worker**，用发布文件的全部内容替换示例代码。
3. 创建一个 **D1 数据库**，给 Worker 添加 D1 资源绑定，变量名填 **`DB`**。
4. 在 Worker 变量处只添加：文本 **`USERNAME`**、Secret **`PASSWORD`**。
5. 发布后访问自己的 **`/init`**，自动建表并把变量中的账号密码写入 D1。

运行时需要 Node.js 兼容 API：如控制台提示 `node:crypto` 不可用，开启 `nodejs_compat` 并使用兼容日期 `2026-10-18` 或经确认的更新日期。它是平台运行时选项，不是需要额外填写的账号变量。

**不需要进入 D1 Console 执行 SQL，不需要下载 SQL 附件，不需要终端。** 完整步骤：[网页控制台教程](docs/DEPLOY-DASHBOARD.md)。

## 使用账号与配置 Floccus

初始化后，打开自己的 **`/admin`**，用刚才的 `USERNAME` 和 `PASSWORD` 登录。网页可为每台浏览器生成独立应用密码，查看和撤销设备、导出备份、退出登录。这样不必把同一个设备凭证复制给所有浏览器。

| Floccus 配置项 | 填什么 |
|---|---|
| 后端 | **WebDAV**，不是 Nextcloud Bookmarks |
| URL | 自己的 HTTPS Worker 根地址加 **`/dav/`** |
| 用户名 | 已初始化进 D1 的用户名 |
| 密码 | `/admin` 为该浏览器生成的 **`applicationPassword`**（`app_…`） |
| 文件名 | **`bookmarks.xbel`**，不要有前导 `/` |
| 文件类型 | XBEL |
| 另一个加密密码 / Passphrase | **留空**，不支持加密 XBEL |
| 本地目录 | 浏览器原生书签栏 / 收藏夹栏 / 书签工具栏 |
| 策略 | 双向合并，保留安全保护；先完成第一台，再连接下一台 |

账号和设备密码的说明：[账户教程](docs/ACCOUNTS.md)。首次合并、E043 和拉取/推送的区别：[Floccus 配置](docs/FLOCCUS.md)。

## 已有 v0.1 / v0.2 部署如何升级

**先保留原 `ADMIN_TOKEN`、`TOKEN_PEPPER`，更新 Worker 后访问 `/init`。** 程序自动补表，并把原内部密钥迁入 D1，保留已有设备密码。成功后才能移除旧版额外 Secrets。已有用户不会被新的 `USERNAME`、`PASSWORD` 覆盖。

不要清空数据库，不要把新初始密码当成恢复旧密码的方法。详细步骤：[升级到 v0.3.0](docs/UPGRADE-0.3.md)。

## 默认限制与安全边界

- 书签专用 WebDAV 协议子集，不是通用网盘，也不是 Nextcloud Bookmarks API；每个用户一份 `bookmarks.xbel`。
- 默认单用户快照 **512 KiB / 5,000 个书签与文件夹 / 64 层**，哪个先到哪个生效；只保存网址、标题和目录，不下载网页内容。
- 支持用户隔离、设备凭证、租约锁、临时上传、版本 CAS、原子提交、删除墓碑、导出和凭证撤销。
- 管理密码使用原生 scrypt（N=16384/r=8/p=5）；公网必须 HTTPS。服务端不做端到端加密，D1 管理员可以读取书签与内部配置。
- 内部密钥保存在 D1 的 `app_settings`，不会返回到网页或状态接口。**完整 D1 备份包含敏感内部配置，禁止公开上传。**
- 过期会话、锁、临时文件、限流和审计记录有请求触发的自动清理，不要求用户额外设置 Cron。无请求时无需运行；已有 Cron 可继续保留。
- Workers/D1 免费套餐有调用、CPU、读写和容量限制，不能承诺任意负载都免费。详情：[费用与维护](docs/DEPLOYMENT.md)。

## 本地开发

Node.js 22.14+（推荐 24），所有缓存、测试数据库和临时文件放在项目 `.cache/`。

```bash
npm ci
cp wrangler.example.toml wrangler.toml  # 已有配置不要覆盖
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写自己的 USERNAME 和真实强 PASSWORD
npm run dev
```

本地打开终端给出的 localhost 地址后加 `/init`，也会自动建表、建号。不需要先跑本地 SQL 迁移；`npm run dev` 只对本地开发临时允许 localhost HTTP，不改变生产 HTTPS 要求。

```bash
npm run typecheck
npm run test:init       # 空库、仅两个变量、初始化竞态、密钥持久化和旧部署兼容
npm run check           # 完整本地测试与部署 dry-run，不操作远端数据库
npm run build:dashboard # 输出 .cache/dashboard/worker.mjs 与许可/校验和
```

数据库结构来自 `migrations/`，由 `npm run schema:generate` 生成内嵌结构；类型检查会防止内嵌结构与迁移文件不同步。以后加迁移仍由 `/init` 按版本自动应用，不要求普通用户执行 SQL。

## 文档

- [控制台部署](docs/DEPLOY-DASHBOARD.md) / [Wrangler 部署](docs/DEPLOY-WRANGLER.md)
- [账户与设备](docs/ACCOUNTS.md) / [Floccus 配置](docs/FLOCCUS.md) / [升级到 v0.3.0](docs/UPGRADE-0.3.md)
- [费用与备份恢复](docs/DEPLOYMENT.md) / [安全](docs/SECURITY.md) / [验证范围](docs/VALIDATION.md)
- [协议研究](docs/RESEARCH.md) / [协议说明](docs/PROTOCOL.md) / [贡献说明](CONTRIBUTING.md)

本项目 MIT，非官方 Floccus 或 Cloudflare 产品。固定 Floccus 5.11.1 源码只用于测试，不打入生产包。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
