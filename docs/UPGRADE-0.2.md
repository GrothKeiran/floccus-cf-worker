# 历史文档：从 v0.1.0 升级到 v0.2.0 网页管理版本

> 当前 v0.3.0 已不需要手动迁移 SQL，请使用[最新升级步骤](UPGRADE-0.3.md)。下文只保留旧版历史操作，不能用于当前最简部署。

本次新增 `/admin` 网页和可选的一次性初始账号配置。**不重建账号、不更换已有密码、不撤销现有设备、不重置书签或同步缓存。**

## Wrangler 部署者

先备份数据库与现有私有配置，拉取新源码，不要用模板覆盖 `wrangler.toml`：

```bash
git pull --ff-only
npm ci
npm run db:remote
npm run deploy
```

迁移只会新增 `bootstrap_state` 表。打开自己的 `/admin`，使用现有账户密码登录，在网页中为新浏览器生成应用密码即可。

**已有用户不需要设置 `BOOTSTRAP_USERNAME` 或 `BOOTSTRAP_PASSWORD`。** 不知道原账户密码时使用管理员密码恢复流程；这会撤销旧凭证，必须清楚后果，不要为了使用网页就随便重置。

## Cloudflare 网页控制台部署者

1. 备份现有数据库与配置，暂停正在进行的同步。
2. 只将仓库 [`migrations/0002_bootstrap.sql`](../migrations/0002_bootstrap.sql) 的新增 SQL 复制到自己的 D1 Console 执行。
3. 新增表成功后，若原先通过配套 `schema.sql` 初始化过，执行下列语句记录迁移（该记录表从 v0.1.0 起已随发布包创建）：

```sql
INSERT INTO d1_migrations (name) VALUES ('0002_bootstrap.sql');
```

若提示该迁移已经记录，先核对是否之前已经成功升级，不要反复重跑；若自己的旧库不是按配套流程创建且没有迁移记录表，先按官方迁移方式补齐正确基线，不能给失败的建表提前标记成功。

4. 从同一版本 Release 下载新的 `worker.mjs`，替换代码并部署，保留 D1 绑定、Secrets、普通变量和定时任务。
5. 打开自己的 `/admin`，用已有账户密码登录。原有 Floccus 配置和设备密码继续使用。

**旧库绝对不要执行新版本的完整 `schema.sql`，它只用于新建空数据库。** 本次不需要修改旧的 `0001_initial.sql`。

## 全新部署者

按[控制台部署](DEPLOY-DASHBOARD.md)或 [Wrangler 部署](DEPLOY-WRANGLER.md)，应用全部迁移。设置初始用户名、初始密码，在 `/admin` 完成一次初始化后即可管理设备。
