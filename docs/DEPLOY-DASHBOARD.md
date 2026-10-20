# 使用 Cloudflare 网页控制台部署

本文在 Cloudflare 网页中完成部署。需要准备一个 Cloudflare 账号，以及用于保存用户名和密码的密码管理器。

## 1. 下载 Worker 文件

打开项目 [Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest)，在附件列表中下载 **`worker.mjs`**。

| 附件 | 用途 |
|---|---|
| `worker.mjs` | 可部署的完整 Worker，包含依赖、管理页面及数据库结构 |
| `SHA256SUMS` | 文件完整性校验和 |
| `THIRD_PARTY_LICENSES.txt` | 第三方依赖许可 |

网页编辑器使用的是 `worker.mjs` 的完整内容。GitHub 自动生成的 Source code 压缩包供源码开发使用，`src/index.ts` 则需要构建后才能部署。

## 2. 创建 Worker

1. 登录 Cloudflare，进入 **Workers & Pages**。
2. 选择 **Create application → Hello World**，创建一个 Worker。
3. 设置 Worker 名称，例如 `floccus-cf-worker`，确认没有覆盖其他服务。
4. 进入 **Edit code**，用文本编辑器打开下载的 `worker.mjs`，将全部内容复制到 Worker 编辑器，替换默认代码。

该文件采用 ES Module 格式，请保留其 `export default` 结构。

## 3. 设置运行时

在 Worker 设置中配置：

| 项目 | 值 |
|---|---|
| 兼容日期 / Compatibility date | `2026-10-18` |
| 兼容标志 / Compatibility flags | `nodejs_compat` |

`nodejs_compat` 为程序提供原生安全密码哈希所需的 API。它属于运行时设置，和账号密码变量是不同的配置项。

## 4. 创建 D1 数据库

1. 在 Cloudflare 的 **Storage & databases → D1 SQL database** 页面创建数据库。
2. 名称可填写 `floccus-bookmarks`。
3. 记下所选数据库，下一步将其绑定到 Worker。

表结构会在第7步由程序初始化；本步骤只负责创建数据库资源。

## 5. 将 D1 绑定到 Worker

返回 Worker，进入 **Bindings → Add binding → D1 database**，填写：

| 配置项 | 值 |
|---|---|
| Variable name / 绑定名 | **`DB`**，大写 |
| D1 database / 数据库 | 第4步创建的数据库 |

保存绑定。`DB` 是资源绑定，不是普通文本变量；这里应选择数据库，而不是将 UUID 填进账号变量区。

## 6. 添加用户名和密码并部署

打开 Worker 的 **Settings → Variables and Secrets**：

| 名称 | 类型 | 值 |
|---|---|---|
| `USERNAME` | Text | 自己设置的用户名，例如 `owner` |
| `PASSWORD` | Secret | 自己设置的强密码，14～256 字符 |

用户名支持 3～64 个英文字母、数字、点、下划线或短横线，首位为字母或数字，保存时转为小写。请把密码保存到密码管理器中。

确认代码、运行时设置、D1 绑定与变量均已保存，然后 **Deploy**。程序会管理内部安全密钥和默认限制，账号变量按上表填写即可。

## 7. 初始化数据库

找到 Worker 的 HTTPS 地址，在浏览器打开：

```text
https://你的Worker域名/init
```

程序会完成：

1. 创建数据库表、索引和迁移记录。
2. 读取 `USERNAME` 和 `PASSWORD`，将账号及带随机盐的密码哈希保存到 D1。
3. 建立账号的根节点和初始同步状态。
4. 生成并保存内部安全配置。

页面显示“初始化完成”后，服务即可用于书签同步。这一步会自动处理表结构，无需打开 D1 Console 导入 SQL。

`/init` 将账号配置应用到关联的原账号，保留原账号 ID 和书签。配置不变时重复访问不会撤销凭证。

## 8. 配置 Floccus

在浏览器扩展中添加同步账号：

| 配置项 | 填写内容 |
|---|---|
| 后端 | WebDAV → 自定义服务器 |
| URL | `https://你的Worker域名/dav/` |
| 用户名 | 第6步设置的 `USERNAME` |
| 认证密码 | 第6步设置的 `PASSWORD` |
| 文件名 | `bookmarks.xbel` |
| 文件类型 | XBEL |
| 加密口令 | 留空 |

选择浏览器原生书签栏，使用双向合并并开启安全保护。先完成一台浏览器的同步，再添加下一台。详细说明见 [Floccus 使用教程](FLOCCUS.md)。

## 修改用户名或密码

1. 在 Worker 的 **Variables and Secrets** 修改 `USERNAME` 或 Secret `PASSWORD`。
2. 保存并部署，使 Worker 使用新配置。
3. 打开当前 Worker 的 `/init`，完成账号更新。
4. 编辑各浏览器现有的 Floccus 同步配置，填写新的用户名和密码，保留服务器地址和书签文件名。

此操作更新原账号，保留书签和同步状态；账号配置变化时会撤销原会话、应用密码和同步锁。使用历史凭证的浏览器应改为账号密码认证。

## 更新与备份

更新前先备份 D1，再用新发布的 `worker.mjs` 替换代码，保留原绑定和账号配置，部署后访问 `/init`。备份与恢复方法见[维护文档](DEPLOYMENT.md)，版本迁移注意事项见[升级说明](UPGRADE-0.5.md)。

## 常见问题

| 提示或现象 | 检查方法 |
|---|---|
| `node:crypto` 不可用 | 核对兼容标志 `nodejs_compat` 和兼容日期 |
| 缺少数据库绑定 | 核对 D1 绑定名是否为大写 `DB`，是否选择了数据库并保存 |
| 缺少账号密码 | 核对 `USERNAME`、Secret `PASSWORD` 的名称、格式、长度和部署状态 |
| 数据库未初始化 | 打开当前 Worker 的 `/init` |
| 更改变量后无法使用新账号密码 | 确认已保存并部署，再访问当前 Worker 的 `/init` |
| 用户名已被占用 | 使用其他用户名，保存部署后重新访问 `/init`；原账号未修改 |
| 环境账号尚未关联 | 先用原账号当前用户名和密码完成一次 `/init`，再更改配置；详见[升级说明](UPGRADE-0.5.md) |
| 初始化提示旧密钥丢失或冲突 | 保留原数据库与备份，按[升级说明](UPGRADE-0.3.md)核对内部密钥，避免随机替换 |
