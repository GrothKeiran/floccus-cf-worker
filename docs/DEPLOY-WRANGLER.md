# 使用 Wrangler 部署

本文通过命令行部署 Worker，创建 D1 数据库并绑定，设置同步账号和密码。所需工具为 Node.js 22.14+（推荐 24）、npm、Git 和浏览器；命令使用 Bash / Git Bash / WSL。

## 1. 下载源码与安装依赖

```bash
git clone https://github.com/GrothKeiran/floccus-cf-worker.git
cd floccus-cf-worker
npm ci
cp wrangler.example.toml wrangler.toml
```

`wrangler.toml` 是本地部署配置，已被 Git 忽略。已有配置时请保留原文件。

## 2. 设置 Worker 名称和用户名

打开 `wrangler.toml`：

- `name`：设置要部署的 Worker 名称，例如 `floccus-cf-worker`。
- `[vars]` 下的 `USERNAME`：设置自己的用户名，例如 `owner`。
- 其他内容保留模板值，包括 `nodejs_compat`、兼容日期和 `DB` 绑定。

用户名为 3～64 个英文字母、数字、点、下划线或短横线，首位为字母或数字，保存时转为小写。若账号内已有同名 Worker，请换一个名称，避免覆盖其他服务。

## 3. 登录 Cloudflare

```bash
node scripts/run.mjs wrangler login
```

在弹出的浏览器页面完成授权。拥有多个 Cloudflare 账号时，确认使用的是本次部署的账号。

## 4. 创建 D1 数据库

```bash
npm run configure
```

该命令创建名为 `floccus-bookmarks` 的 D1 数据库，并将实际数据库 ID 写入 `wrangler.toml` 的 `DB` 绑定。

### 使用已有数据库

如果已经创建了本项目要使用的 D1，请从 Cloudflare 控制台复制它的 UUID，然后执行以下命令，替代上面的创建命令：

```bash
read -rp 'D1 数据库 UUID: ' D1_ID
npm run configure -- "$D1_ID"
```

脚本会更新数据库 ID。此处对应的数据库名称为 `floccus-bookmarks`；使用其他数据库名称时，还应将 `wrangler.toml` 中的 `database_name` 改为实际名称，并在维护命令中使用该名称。

如果数据库创建成功但脚本未能自动写入 ID，请使用创建结果中的 UUID 执行上述绑定命令，避免重复创建数据库。

## 5. 设置账号密码

```bash
node scripts/run.mjs wrangler secret put PASSWORD
```

在交互提示中输入自己的强密码，长度 14～256 字符。密码保存为 Worker Secret，请妥善保管。

到这里，账号配置为 `USERNAME`、`PASSWORD`，数据库绑定为 `DB`。内部密钥和默认限制由程序管理。

## 6. 部署 Worker

```bash
npm run deploy
```

成功后终端会输出 Worker 的 HTTPS 地址。后续步骤均使用该地址，而不是本地开发地址。

## 7. 初始化数据库

在浏览器打开：

```text
https://你的Worker域名/init
```

程序会创建表、索引及迁移记录，将账号和密码哈希保存到 D1，并生成同步所需的内部配置。显示“初始化完成”后，即可配置 Floccus。表结构通过此步骤自动准备，无需手动执行 SQL。

`/init` 会将 `USERNAME` / `PASSWORD` 应用到关联的原账号，保留书签与内部密钥。配置不变时重复访问不会撤销凭证。

## 8. 配置 Floccus

| 配置项 | 值 |
|---|---|
| 后端 | WebDAV → 自定义服务器 |
| URL | `https://你的Worker域名/dav/` |
| 用户名 | 第2步设置的 `USERNAME` |
| 认证密码 | 第5步设置的 `PASSWORD` |
| 文件名 | `bookmarks.xbel` |
| 文件类型 | XBEL |
| 加密口令 | 留空 |

选择浏览器原生书签栏作为本地目录，使用双向合并，保持安全保护开启。先同步第一台，再配置其他浏览器。详细操作见 [Floccus 使用教程](FLOCCUS.md)。

## 修改用户名或密码

1. 修改 `wrangler.toml` 中的 `USERNAME`；修改密码时执行 `node scripts/run.mjs wrangler secret put PASSWORD` 并输入新密码。
2. 执行 `npm run deploy`。
3. 打开当前部署的 `/init`，将配置应用到原账号。
4. 编辑各浏览器现有的 Floccus 同步配置，更新用户名和密码，保留服务器地址和书签文件名。

原账号的内部 ID、书签和同步状态保留；配置变化会撤销原会话、应用密码和同步锁。使用独立应用密码的浏览器需要重新签发凭证。

## 更新与维护

日常更新顺序为：备份 D1 → 更新源码与依赖 → `npm run deploy` → 访问 `/init`。已有数据的版本迁移注意事项见[升级说明](UPGRADE-0.5.md)，备份命令见[维护文档](DEPLOYMENT.md)。

过期会话、同步锁等数据由程序通过受控后台任务清理。数据库迁移文件和 `db:local` / `db:remote` 命令供开发维护使用，常规安装按本文完成即可。
