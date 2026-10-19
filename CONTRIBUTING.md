# 参与开发

1. 使用 Node.js 22.14+，推荐 24。先复制 `wrangler.example.toml` 为本地 `wrangler.toml`，再 `npm ci` 安装锁定依赖。
2. `npm run check` 是提交前必要检查：类型、workerd/D1、真实上游协议和构建都必须成功。
3. 缓存、临时文件、测试数据库和日志必须全部位于项目目录，使用 scripts/run.mjs 包装新增工具。不能让测试使用/修改线上 D1。
4. 不编辑已经执行的迁移；新增递增 SQL 文件，验证失败时事务回滚、外键和跨用户隔离。
5. 修改同步行为时先查看固定上游源码，更新真实 adapter/engine 测试，不能只写 HTTP 200 断言或虚构 REST 配置字段。
6. 修改 Floccus 基线须显式更新 scripts/prepare-upstream.mjs 的提交、版本断言和 RESEARCH/VALIDATION；不要在忽略目录直接改上游后还声称是官方未修改源码。
7. 不提交真实 `wrangler.toml`、`.dev.vars`、`.cache/`、`backups/`、账号数据或认证头；安全问题报告不要带真实密码/token。
8. 本项目没有实施线上安全审计，报告测试范围与限制要精确，不根据 dry-run 宣称部署成功。

控制台部署包由 `npm run build:dashboard` 生成到 `.cache/dashboard/`。修改源码后应重新生成发布附件，不能把 TypeScript 源码直接粘贴到控制台冒充可执行包。

修改 migrations 后必须运行 `npm run schema:generate` 并提交生成的 src/storage/schema.ts；typecheck 会检查一致性。普通部署通过 /init 自动应用内嵌迁移，不要求用户导入 SQL。保持现有迁移编号与内容不变，只新增迁移。
