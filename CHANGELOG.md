# 变更记录

## 0.1.0 — 2026-10-18

- 首次交付纯 Workers + D1 的 Floccus WebDAV/XBEL 协议子集。
- 安全多用户建号/登录、管理会话、独立设备凭证、撤销/恢复/导出/删除。
- D1 租约、staging、版本 CAS、原子节点更新、永久墓碑与历史配额。
- 固定 Floccus 5.11.1 的真实适配器、Merge/Default 双客户端同步集成测试。
- 完整本地/部署/升级/备份/费用/安全/限制文档。
- 已通过 Wrangler 部署 Worker + D1；真实浏览器全场景验收仍未完成，不支持 Nextcloud API、HTML 或加密文件。

### 2026-10-19 公开发布整理

- 提供 Wrangler 自动部署与 Cloudflare Dashboard 手动部署两条完整路线。
- 增加可复现的控制台单文件 Worker/初始 SQL/校验和发布包。
- 公开配置使用 `wrangler.example.toml`，真实生产配置、凭证、缓存和备份不进仓库。
- 补充 Secrets、D1 绑定 `DB`、兼容性标志、账户与每设备应用密码、Floccus 防护错误和容量限制说明。
