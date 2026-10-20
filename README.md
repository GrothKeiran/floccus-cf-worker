# Floccus Cloudflare Workers + D1

使用 **Cloudflare Workers + D1** 自托管浏览器书签同步服务，通过官方 **Floccus** 扩展，在 Chrome、Edge、Firefox 等浏览器之间同步原生书签栏。

服务端运行在 Cloudflare 上，采用 Floccus 支持的 WebDAV / XBEL 协议。浏览器负责比较和合并书签，Worker 处理认证与同步请求，D1 保存账号、书签和同步状态。

```text
Chrome / Edge / Firefox
        │
    Floccus 扩展
        │ HTTPS / WebDAV
 Cloudflare Worker
        │
  Cloudflare D1
```

## 功能与适用范围

- 同步书签标题、网址、文件夹层级及排列顺序。
- 支持多浏览器双向合并，以及书签新增、编辑、移动和删除。
- 使用数据库事务、同步锁和版本检查处理并发提交。
- 账号数据相互隔离，支持备份导出与环境变量更新账号。
- 数据库表结构由程序初始化，使用 Cloudflare 账号即可部署，无需维护服务器。

本项目是**书签同步后端**，不是通用 WebDAV 网盘。Floccus 中请选择 **WebDAV** 后端和 **XBEL** 文件格式；服务端不提供 Nextcloud Bookmarks API，也不接收加密书签文件。

## 部署前准备

1. 一个 Cloudflare 账号。
2. 选择下面任意一种部署方式。
3. 在需要同步的浏览器中安装官方 [Floccus 扩展](https://floccus.org/)。
4. 导出浏览器现有书签，保存一份备份。

### 配置清单

| 名称 | 配置位置与类型 | 内容 |
|---|---|---|
| `USERNAME` | Worker 文本变量 | 自己设置的用户名，例如 `owner` |
| `PASSWORD` | Worker Secret | 自己设置的密码，14～256 字符 |
| `DB` | Worker 的 D1 数据库绑定 | 选择用于保存书签的 D1 数据库，绑定名为 `DB` |

用户名支持 3～64 个英文字母、数字、点、下划线或短横线，首位为字母或数字，保存时统一转为小写。密码请使用随机强密码，并保存在密码管理器中。

`DB` 是**数据库资源绑定**，应在 Worker 的绑定设置中添加；`USERNAME` 和 `PASSWORD` 则在变量设置中添加。

## 方式一：Wrangler 命令行部署

适合使用本地终端部署和维护的用户。准备 Node.js 22.14+（推荐 24）、npm 和 Git；以下命令使用 Bash / Git Bash / WSL。

### 1. 下载项目

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
```

### 2. 设置 Worker 名称和用户名

打开 `wrangler.toml`，按需修改：

```toml
name = "floccus-cf-worker"

[vars]
USERNAME = "owner"
```

保留文件中的其他配置。若你的 Cloudflare 账号中已有同名 Worker，请换一个名称，避免覆盖其他服务。`wrangler.toml` 存放本地部署配置，已被 Git 忽略。

### 3. 登录 Cloudflare 并创建数据库

```bash
node scripts/run.mjs wrangler login
npm run configure
```

登录时在浏览器完成 Cloudflare 授权。`configure` 会创建名为 `floccus-bookmarks` 的 D1 数据库，并将数据库 ID 写入 `wrangler.toml` 的 `DB` 绑定。

### 4. 设置密码并部署

```bash
node scripts/run.mjs wrangler secret put PASSWORD
npm run deploy
```

第一条命令会提示输入密码；密码保存在 Worker Secret 中。部署完成后，记下终端输出的 Worker HTTPS 地址。

### 5. 初始化数据库

在浏览器打开 Worker 地址后加 `/init`：

```text
https://你的Worker域名/init
```

页面显示“初始化完成”后，继续下面的 **Floccus 配置**。

更多说明，包括使用已有 D1 数据库：[Wrangler 部署教程](docs/DEPLOY-WRANGLER.md)。

## 方式二：Cloudflare 网页控制台部署

此方式在 Cloudflare 网页中完成，无需安装本地开发环境。

### 1. 下载部署文件

打开项目 [Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest)，在附件中下载 **`worker.mjs`**。这是已打包的 Worker 文件，包含程序依赖、管理页面和数据库结构。

### 2. 创建并配置 Worker

在 Cloudflare 的 **Workers & Pages** 中创建 Worker，进入代码编辑器，将默认代码替换为 `worker.mjs` 的完整内容。

在 Worker 运行时设置中配置：

| 项目 | 值 |
|---|---|
| 兼容日期 / Compatibility date | `2026-10-18` |
| 兼容标志 / Compatibility flags | `nodejs_compat` |

### 3. 创建 D1 并绑定

1. 在 Cloudflare 的 **D1** 页面创建数据库，名称可用 `floccus-bookmarks`。
2. 返回 Worker，打开 **Bindings → Add binding → D1 database**。
3. 绑定名 / Variable name 填 **`DB`**。
4. 数据库选择刚创建的那一个，保存。

### 4. 添加账号密码

打开 Worker 的 **Settings → Variables and Secrets**：

| 名称 | 类型 | 值 |
|---|---|---|
| `USERNAME` | Text | 自己的用户名，例如 `owner` |
| `PASSWORD` | Secret | 自己设置的强密码 |

保存配置并部署 Worker。

### 5. 初始化数据库

在浏览器打开：

```text
https://你的Worker域名/init
```

程序会创建表结构，将配置的账号和密码哈希保存到 D1，并准备同步所需的数据。页面显示“初始化完成”后，继续 **Floccus 配置**。数据库初始化由该步骤完成，无需进入 D1 控制台执行 SQL。

详细步骤与常见问题：[网页控制台部署教程](docs/DEPLOY-DASHBOARD.md)。

## Floccus 配置

打开 Floccus，添加同步账号，选择 **WebDAV → 自定义服务器**，然后填写：

| 配置项 | 填写内容 |
|---|---|
| WebDAV URL | `https://你的Worker域名/dav/` |
| 用户名 | 部署时设置的 `USERNAME` |
| 密码 / 认证密码 | 部署时设置的 `PASSWORD` |
| 书签文件名 | `bookmarks.xbel` |
| 文件类型 | XBEL |
| 加密口令 / Passphrase | 留空 |
| 同步策略 | 双向合并，保持安全保护开启 |

**本地同步目录**请选择浏览器原生书签栏：

- Chrome：书签栏。
- Edge：收藏夹栏。
- Firefox：书签工具栏。

先完成第一台浏览器的同步，再配置下一台。其他浏览器填写相同的服务器地址、账号、密码和文件名，并选择对应的原生书签栏。

首次同步时，Floccus 可能提示大量新增或删除的安全保护。请先核对目录、备份和合并方向，再决定继续；具体操作见 [Floccus 配置与故障处理](docs/FLOCCUS.md)。

## 备份与日常维护

| 地址 | 用途 |
|---|---|
| `/init` | 初始化数据库、应用结构迁移，以及同步 Worker 中的账号配置 |
| `/dav/` | 在 Floccus 中填写的同步服务地址 |
| `/admin` | 可选备份工具：登录后下载当前账号的 JSON 备份 |
| `/health/ready` | 查看服务是否准备就绪 |

- `/init` 将 Worker 的账号配置应用到关联的原账号，保留账号内部 ID、书签及同步状态。配置不变时重复访问不会撤销凭证。
- 更新服务前先备份 D1，再更新 Worker 代码，最后访问 `/init` 应用数据库结构变更。
- 需要额外备份时，可打开 `/admin` 登录并下载 JSON；备份内容与使用方式见[账号与备份](docs/ACCOUNTS.md)。
- 账户密码模式不提供可靠的唯一设备标识；同一网络出口、相同浏览器下应避免重复配置并发同步任务，详见[协议说明](docs/PROTOCOL.md#共享账户密码与可选设备凭证)。

### 修改用户名或密码

1. 在 Worker 中修改 `USERNAME` 或 Secret `PASSWORD`，保存并部署。
2. 打开当前 Worker 的 `/init`，将配置应用到原账号。
3. 编辑各浏览器现有的 Floccus 同步配置，填写新的用户名和密码，保留服务器地址和书签文件名。

账号配置发生变化时，原登录会话、同步凭证和同步锁会被撤销，书签保留。使用旧凭证的配置应改为账号密码认证。用户名与其他账号冲突时操作会停止，原账号不受影响。

## 容量、费用与安全

- 默认每个账号的书签文件上限为 **512 KiB**，最多 **5,000 个书签与文件夹**，目录深度最多 **64 层**。
- 保存的数据包括书签网址、标题、目录和同步状态，不下载网页正文、图片或附件。D1 总容量与可用空间受所选 Cloudflare 套餐及数据库使用量约束。
- 一次 Floccus 同步会发送多条 Worker 请求，并产生 D1 读写。Workers 与 D1 均有请求、CPU、读写和存储限制，实际费用应结合 Cloudflare 控制台用量判断。
- 账号密码使用带独立随机盐的 scrypt 哈希保存，生产环境使用 HTTPS。
- 书签在服务端以可读形式保存，Cloudflare/D1 管理员可以读取；本项目不提供端到端加密。
- D1 完整备份包含书签、密码哈希和内部密钥，请妥善保管，不要上传公开仓库。

详细说明：[费用、备份与恢复](docs/DEPLOYMENT.md) · [安全配置](docs/SECURITY.md)。

## 本地开发

```bash
npm ci
cp wrangler.example.toml wrangler.toml
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写本地开发使用的 USERNAME 和 PASSWORD
npm run dev
```

启动后访问本地地址的 `/init`，再配置本地测试客户端。已有配置文件请保留，避免被模板覆盖。缓存、临时文件和测试数据库均放在项目 `.cache/` 中。

```bash
npm run typecheck       # 类型和内嵌数据库结构检查
npm run test:init       # 数据库初始化测试
npm run test:environment # 环境变量更新账号测试
npm run test:password   # 账户密码认证测试
npm run test:backup     # 备份页面与导出测试
npm run check           # 完整测试与部署 dry-run
npm run build:dashboard # 生成控制台部署文件
```

## 更多文档

- 部署：[Wrangler](docs/DEPLOY-WRANGLER.md) · [Cloudflare 控制台](docs/DEPLOY-DASHBOARD.md)
- 使用：[Floccus 配置](docs/FLOCCUS.md) · [账号与备份](docs/ACCOUNTS.md)
- 维护：[费用与备份恢复](docs/DEPLOYMENT.md) · [版本升级](docs/UPGRADE-0.5.md)
- 技术：[协议研究](docs/RESEARCH.md) · [协议说明](docs/PROTOCOL.md) · [安全配置](docs/SECURITY.md)
- 开发：[贡献指南](CONTRIBUTING.md) · [测试与验证记录](docs/VALIDATION.md) · [变更记录](CHANGELOG.md)

## 许可与声明

采用 [MIT License](LICENSE)。本项目为独立开源项目，非 Floccus 或 Cloudflare 官方产品。

兼容性测试基于固定的 Floccus 5.11.1 源码，验证范围见测试记录。生产部署包不包含 Floccus 源码；第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
