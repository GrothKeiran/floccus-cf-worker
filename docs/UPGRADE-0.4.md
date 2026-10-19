# 升级到 v0.4.0：Floccus 直接使用 Worker 的 PASSWORD

1. 先备份原 D1。备份包含书签、密码哈希和内部密钥，禁止公开上传。
2. 更新原 Worker（控制台替换新版 `worker.mjs`，或更新源码后 `npm run deploy`），保留原 `DB` 绑定和 `USERNAME` / Secret `PASSWORD`。
3. 访问自己的 **`/init`**，程序自动应用 `0004_password_dav.sql`；**不用手工执行 SQL**。这是对 credentials 新增字段和索引，不重建账号、不清空书签、不更换内部密钥。
4. Floccus 可直接填写原用户名和账户密码。新空库中，它们就是 Worker 配置的 `USERNAME` / `PASSWORD`。旧 `app_…` 密码仍有效，已有扩展配置可不改。

v0.1/v0.2 用户须先保留旧内部 Secrets 直到 `/init` 成功迁入 D1，详情见[旧密钥升级步骤](UPGRADE-0.3.md)。

已有账号不被环境变量覆盖。如果曾单独重置过 D1 账户密码，应使用重置后的密码，不是再改变量强行覆盖；删除账号后也不会自动重建。多浏览器可共用账户密码，独立应用密码改为按需高级选项；并发上下文的限制见[协议说明](PROTOCOL.md#共享账户密码与可选设备凭证)。
