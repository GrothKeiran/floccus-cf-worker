# Cloudflare 网页控制台部署：只填账号密码，D1 不用导入表

从 v0.3.0 起，普通部署只需要两个 Worker 变量和一个 D1 绑定，数据库表结构和内部安全密钥都由程序准备。

## 1. 下载 Worker

在 [Releases](https://github.com/GrothKeiran/floccus-cf-worker/releases/latest) 下载 **`worker.mjs`**。这是已包含网页、依赖、表结构和迁移的完整模块。

- 不用下载 Source code 编译，也不能直接把 `src/index.ts` 粘贴到网页编辑器。
- 不需要 SQL 文件；新版本发布包不再要求用户手动导入表。
- 可选下载 `SHA256SUMS` 检查完整性，许可在 Worker 注释和 `THIRD_PARTY_LICENSES.txt` 中保留。

## 2. 创建 Worker

Cloudflare Dashboard → **Workers & Pages → Create application → Hello World**，选择自己的 Worker 名并创建。不要覆盖其他已有服务，也不要误建 Pages 站点。

在 **Edit code** 用 `worker.mjs` 的全部内容替换默认代码。它是 ES Module，保留 `export default`，不要改为旧式 fetch 事件。

如果编辑器提示 `node:crypto` 不可用，在 **Settings → Runtime** 开启 `nodejs_compat`，使用 `2026-10-18` 或经确认的更新兼容日期。这是代码使用原生安全密码哈希所需的运行时支持，不是额外的用户环境变量。

## 3. 创建 D1，并绑定 Worker

1. 在 **Storage & databases → D1 SQL database** 创建自己的数据库，名字可用 `floccus-bookmarks`。
2. 打开 Worker → **Bindings → Add binding → D1 database**。
3. **Variable name 填 `DB`（大写）**，数据库选择刚创建的那一个，保存。

到这里即可。**不用打开 D1 Console，不用手动建表，不用导入 SQL。** `DB` 是资源绑定，不是普通文本变量，也不是把数据库 UUID 写成字符串。

## 4. 变量处只添加自己的账号和密码

Worker → **Settings → Variables and Secrets**：

| 名称 | 类型 | 值 |
|---|---|---|
| `USERNAME` | Text | 自己的用户名，例如 `owner` |
| `PASSWORD` | **Secret** | 自己的强密码，14～256 字符 |

用户名为 3～64 个字母/数字/点/下划线/短横线，首位字母或数字，程序按小写保存。

**不需要再添加 `ADMIN_TOKEN`、`TOKEN_PEPPER`、`BOOTSTRAP_*`、MAX_* 或其他变量。** 内部管理密钥和凭证摘要密钥由程序随机生成，持久保存在 D1；默认安全设置已经内置。

账号密码不要写进代码，也不要把示例占位值当作实际密码。设置好后保存并 **Deploy**。

## 5. 浏览器访问 /init

在自己的 Worker 域名后加 `/init`，例如：

```text
https://自己的Worker域名/init
```

访问后程序会自动：

- 逐项创建或升级所有表、索引和迁移记录。
- 生成并保存内部密钥；重复访问不更换。
- 读取 Worker 中的 `USERNAME` 和 `PASSWORD`，将账号与密码哈希初始化进 D1。
- 建立账号的初始根节点和同步状态。

页面显示“初始化完成”后即可直接配置 Floccus。初次并发访问有事务保护，账号只创建一次；中断后可以重新访问继续完成，不用清空数据库。

`/init` 不接受 URL 或请求体提供其他用户名和密码。重复访问不会重置账号、密码、书签或设备，也不会清空数据库。已有账号时，新环境变量不会覆盖旧密码。

## 6. Floccus 直接填写刚才的账号密码

| 配置项 | 填写内容 |
|---|---|
| 后端 | WebDAV → 自定义服务器 |
| URL | 自己的 HTTPS Worker 域名 + `/dav/` |
| 用户名 | 刚才在 Worker 设置的 **`USERNAME`** |
| 认证密码 | 刚才在 Worker 设置的同一个 **`PASSWORD`** |
| 文件名 | `bookmarks.xbel` |
| 文件类型 | XBEL |
| 另一个加密口令 | **留空** |

**不需要进入 `/admin`，也不需要另生成密码。** 其他浏览器可填写同一组账号密码。先完成一台同步，再添加下一台。独立 `app_…` 密码仅为需要单独撤销/明确区分设备时的可选高级功能，见[账户教程](ACCOUNTS.md)。

## 7. 自动清理与升级

不必手动添加 Cron：程序会在有请求时触发受控的过期数据清理，无请求时不需要运行。清理不删除书签或永久墓碑。已有 Cron 也可以保留。

以后升级先备份 D1，替换新版 Worker，再访问 `/init` 自动应用新增迁移。不要清空数据库或手动重放旧 SQL。从 v0.1/v0.2 升级必须先保留旧密钥，见[旧版升级说明](UPGRADE-0.3.md)。

## 故障提示

| 提示 | 处理 |
|---|---|
| 缺少数据库绑定 | 给 Worker 添加 D1 资源绑定，名字必须为 `DB` |
| 缺少账号密码 | 检查 `USERNAME`、Secret `PASSWORD` 的名称、长度及是否保存部署 |
| 数据库未初始化 | 访问 `/init`，无需导入 SQL |
| legacy_pepper_required | 旧部署需先保留原 `TOKEN_PEPPER` 再访问 `/init`，不要随机替换 |
| 旧密钥与内部配置冲突 | 先停止改动，核对备份；不能用换密钥掩盖问题 |
| 修改环境密码后登不上 | 变量只用于首次建号，已有账号仍用原密码；不是重置开关 |

参考：[Cloudflare D1 绑定](https://developers.cloudflare.com/d1/get-started/)、[Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
