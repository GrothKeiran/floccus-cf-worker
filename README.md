# Floccus Cloudflare Workers + D1

使用 **Cloudflare Workers + D1** 自托管浏览器书签同步。官方 [Floccus](https://floccus.org/) 扩展选择 **WebDAV / XBEL** 即可连接，不需要 VPS、Docker、Nextcloud，也不需要修改扩展。

> 这是**书签专用 WebDAV 协议子集**，不是通用网盘，也不是 Nextcloud Bookmarks API。每个用户同步一份 `bookmarks.xbel`；初次合并、差异计算与浏览器 ID 映射由 Floccus 完成，服务端负责身份隔离、文件校验、锁和原子提交。

## 选择一种部署方式

| 方式 | 适合谁 | 操作入口 |
|---|---|---|
| **方式一：Wrangler 命令行部署（推荐）** | 有 Node.js，或者让 AI 编程助手在授权后协助部署 | [完整命令行教程](docs/DEPLOY-WRANGLER.md) |
| **方式二：Cloudflare 控制台手动部署** | 希望自己在网页创建 Worker、D1、填写变量和数据库绑定 | [完整网页控制台教程](docs/DEPLOY-DASHBOARD.md) |

两种方式部署的是同一份代码和数据库结构，不会要求购买付费套餐。**不能保证所有书签规模和使用频率都能在免费限制内运行**，详见[额度与维护](docs/DEPLOYMENT.md)。

### 方式一：Wrangler 快速开始

要求 Node.js **22.14+（推荐 24）**、npm、Git。以下命令使用 Bash / Git Bash / WSL：

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
node scripts/run.mjs wrangler login
# 创建 floccus-bookmarks，并把真实 UUID 写入本地 wrangler.toml
npm run configure
npm run db:remote
# 分别在交互提示中输入两个独立的强随机 Secret
node scripts/run.mjs wrangler secret put ADMIN_TOKEN
node scripts/run.mjs wrangler secret put TOKEN_PEPPER
npm run deploy
```

**不要照抄他人的账户 ID、D1 UUID 或密码。** `wrangler.toml` 是本地私有配置，已被 Git 忽略；仓库只发布 `wrangler.example.toml`。已有数据库、Worker 重名、Secret 生成和建号步骤见[方式一完整教程](docs/DEPLOY-WRANGLER.md)。

### 方式二：网页控制台快速开始

1. 从 [Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest) 下载配套的 **`worker.mjs`、`schema.sql`**。
2. 在 Cloudflare 创建一个新的 D1 数据库，在 **Console** 执行 `schema.sql`。
3. 创建一个 **Hello World Worker**；兼容日期设为 `2026-10-18` 或更新，并启用 **`nodejs_compat`**。
4. 给 Worker 添加 **D1 database 绑定**：变量名必须为 **`DB`**，选择刚创建的数据库。
5. 添加两个基础 Secret 和普通变量；首次建号再设置 `BOOTSTRAP_USERNAME` 和 Secret 类型的 `BOOTSTRAP_PASSWORD`。
6. 在代码编辑器中用 `worker.mjs` 的全部内容替换示例代码，保存并部署。
7. 访问自己的 `/admin`，输入刚配置的初始账号密码，点击“初始化并登录”，然后在网页中为每个浏览器生成应用密码。**无需终端或手工插入 D1 账号记录。**

完整逐步说明、变量类型、定时清理和注意事项见[方式二完整教程](docs/DEPLOY-DASHBOARD.md)。预打包文件已经包含依赖，**不能直接把 `src/index.ts` 粘贴到控制台，也不需要自己在控制台安装 npm 包**。

## 绑定与环境变量配置

| 名称 | 类型 | 值 / 作用 |
|---|---|---|
| `DB` | **D1 数据库绑定** | 选择自己的 D1 数据库；不是普通文本变量 |
| `ADMIN_TOKEN` | **Secret** | 独立强随机字符串，至少 32 字符；管理员建号、恢复密码 |
| `TOKEN_PEPPER` | **Secret** | 另一份独立强随机字符串，至少 32 字符；凭证摘要密钥 |
| `BOOTSTRAP_USERNAME` | 文本，首次建号可选 | 初始用户名，例如 `owner`；仅用于新空库初始化 |
| `BOOTSTRAP_PASSWORD` | **Secret**，与上项配套 | 自己设置的强账户密码，14～256 字符；不是 Floccus 设备密码 |
| `ALLOW_REGISTRATION` | 文本 | `false`，默认关闭公开注册 |
| `ALLOW_INSECURE_LOCALHOST` | 文本 | 控制台生产部署填 `false`；本地 HTTP 开发才设 `true` |
| `MAX_BODY_BYTES` | 文本 | `524288`，每份 XBEL 最大 512 KiB |
| `MAX_NODES` | 文本 | `5000`，书签和文件夹数量合计上限 |

`ADMIN_TOKEN` 和 `TOKEN_PEPPER` 推荐各自生成 **32 个随机字节、编码为 64 个十六进制字符**，不能使用示例占位值。`BOOTSTRAP_PASSWORD` 是自己的强账户口令。不要把上述 Secret 填进 Floccus、写进源码或发布到 GitHub。

## 创建账户，再配置 Floccus

**从 v0.2.0 起内置 `/admin` 网页管理页面。** 新空库先在 Cloudflare 设置 `BOOTSTRAP_USERNAME` 和 `BOOTSTRAP_PASSWORD`，再到网页输入同一组账号密码，“初始化并登录”会自动建号。登录后可生成/撤销每设备应用密码、查看设备列表、导出备份和退出。详情见[账户管理教程](docs/ACCOUNTS.md)，CLI / PowerShell 仍可选用。

初始化只允许新空数据库且仅一次，已有用户不受环境变量覆盖；初始化账号删除后也不会自动重建。成功后可移除这两个初始变量，账号继续使用 D1 中的密码哈希登录。**修改初始变量不是重置密码功能。**

已有 v0.1.0 部署者先应用 `0002_bootstrap.sql` 再更新 Worker，保留原账号和设备密码，不要重跑整份初始化 SQL。[升级步骤](docs/UPGRADE-0.2.md)

| Floccus 配置项 | 填写内容 |
|---|---|
| 后端 | **WebDAV**，不是 Nextcloud Bookmarks |
| WebDAV URL | 自己的 Worker HTTPS 根地址后追加 **`/dav/`** |
| 用户名 | 自己创建的用户名，例如 `owner` |
| 密码 | 该设备的 **`applicationPassword`**（`app_…`），不是账号密码或管理员 Secret |
| 书签文件名 | **`bookmarks.xbel`**，不要有前导 `/` |
| 文件类型 | **XBEL** |
| 加密密码 / Passphrase | **留空**，本服务不支持加密后的书签文件 |
| 本地同步目录 | 浏览器原生书签栏 / 收藏夹栏 / 书签工具栏 |
| 同步策略 | 双向合并，保留安全保护；首次先让一台完成，再配置其他设备 |

**每个设备使用不同的应用密码**，不要把同一个设备凭证复制给多个同时同步的配置。E043（大比例新增保护）、首次合并、拉取与推送的区别见 [Floccus 配置与排错](docs/FLOCCUS.md)。

## 容量与安全边界

- 当前应用默认上限：每个用户 **512 KiB / 5,000 个书签和文件夹 / 64 层**，先达到哪个就受哪个限制。
- 存储的是网址、标题和目录，不保存网页正文、图片或视频。它不是可存普通文件的 WebDAV 网盘。
- D1 免费单库上限 **500 MB**、账户总计 **5 GB**；这些容量不等于单份 XBEL 上传限制。[官方限制](https://developers.cloudflare.com/d1/platform/limits/)
- Workers Free 有每日请求额度和单次 CPU 限制；D1 另有每日读写额度。没有变化的定时同步仍有检查请求、锁和限流读写。[费用说明](docs/DEPLOYMENT.md)
- 管理密码使用原生 scrypt（N=16384/r=8/p=5）；HTTPS、设备应用密码、用户隔离、限流和审计默认启用。
- 支持版本 CAS、临时上传、锁、原子快照提交、删除墓碑、凭证撤销、导出和账户删除。
- 不支持 HTML、加密 XBEL、通用 WebDAV、多文件路径或 Nextcloud API。`javascript:`、`data:`、浏览器内部 URL 等不在允许范围。
- 用户书签不做端到端加密：能管理 Cloudflare/D1 的管理员能访问服务端内容；HTTPS 只保护传输。

## 本地开发与检查

```bash
npm ci
cp wrangler.example.toml wrangler.toml  # 已有配置时不要覆盖
npm run typecheck
npm run test:bootstrap  # 仅网页初始化/设备凭证相关的针对性测试
npm run check
```

`npm run check` 包含本地 workerd/D1、固定上游适配器与同步引擎回归、部署 dry-run；**不创建远端资源**。测试首次需要拉取固定版本 Floccus 5.11.1，之后可复用项目内缓存。真实部署范围与历史测试限制见[验证记录](docs/VALIDATION.md)。

本地启动前生成专用 Secrets（不覆盖已有文件）：

```bash
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
writeFileSync('.dev.vars', `ADMIN_TOKEN=${randomBytes(32).toString('hex')}\nTOKEN_PEPPER=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
JS
npm run db:local
npm run dev
```

本地 `wrangler.toml` 需允许 localhost HTTP（示例已开启）。测试数据库、日志、npm 缓存和临时文件均放在 `.cache/`，不会操作线上数据库。

控制台发布包可复现生成：

```bash
npm run build:dashboard
# .cache/dashboard/worker.mjs、schema.sql、SHA256SUMS
```

## 项目结构与更多文档

```text
src/                       网页管理、一次性建号、认证、WebDAV、XBEL 与 D1 事务
migrations/                数据库迁移
scripts/                   CLI、项目内缓存与发布包构建
tests/                     服务、协议和真实上游同步引擎测试
wrangler.example.toml      可公开的部署配置模板
.github/workflows/         检查与版本发布
```

- [Wrangler 部署](docs/DEPLOY-WRANGLER.md) / [控制台部署](docs/DEPLOY-DASHBOARD.md)
- [账户和设备凭证](docs/ACCOUNTS.md) / [Floccus 配置](docs/FLOCCUS.md) / [升级到 v0.2.0](docs/UPGRADE-0.2.md)
- [额度、备份、恢复和升级](docs/DEPLOYMENT.md)
- [协议调研](docs/RESEARCH.md) / [协议与数据模型](docs/PROTOCOL.md)
- [安全与故障排查](docs/SECURITY.md) / [验证记录](docs/VALIDATION.md)
- [参与开发](CONTRIBUTING.md) / [变更记录](CHANGELOG.md)

许可证：本项目 MIT。固定版本 Floccus 源码仅用于测试，不打入生产 Worker；第三方许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
