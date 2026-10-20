# 协议、模型与一致性

## 协议边界

URL 根为 `/dav/`。**每个认证用户只有一个文件**，不存在以 URL 的 user_id 决定权限的接口。实际 user_id 只来自已验证的账户密码或应用密码。

| 资源 | 方法 | 行为 |
|---|---|---|
| `/dav/` | OPTIONS、PROPFIND | DAV 1 子集；深度 0/1，禁止无限递归 |
| `/dav/bookmarks.xbel` | GET、HEAD、PROPFIND | 原样返回 XML、真实 UTF-8 字节数、SHA256 ETag、Last-Modified；首次不存在 404 |
| 同上 | PUT | 原生客户端兼容分支；必须持锁，验证整棵树后原子替换 |
| `.xbel.lock` | GET、HEAD、PROPFIND、PUT、DELETE | 获取锁状态、原子抢锁/续租、仅持有者释放 |
| `.xbel.temp` | PUT、GET、HEAD、PROPFIND、DELETE | 仅当前租约/凭证可见，不影响正式文件 |
| `.xbel.temp` | MOVE | Destination 必须为同源正式文件；将临时文件原子提交 |
| 正式 `.xbel` | DELETE | 405；请通过快照表达删除节点，或显式删除整个账号 |

不支持 MKCOL、COPY、通用路径、子目录、客户端选择多个文件、HTTP DAV LOCK/UNLOCK。拒绝未知文件，不会创建随意名称的数据。

服务器对该协议不发跨源重定向，不伪造 Nextcloud/OCS API。生产 Basic 仅通过 HTTPS。HTTP 只在配置允许的 loopback 地址接受。

## 真实同步序列

```text
GET   bookmarks.xbel.lock                    404（或锁存在则等待）
PUT   bookmarks.xbel.lock                    201；D1 原子抢锁
GET   bookmarks.xbel                         404 或 200
PROPFIND bookmarks.xbel, Depth:0             207；已有文件时校验实际字节数
[Floccus 比较本地、上次缓存及远端；在客户端计算并应用差异]
PUT   bookmarks.xbel.temp                    201；仍不改变正式数据
PROPFIND bookmarks.xbel.temp, Depth:0        207
MOVE  bookmarks.xbel.temp                    204；Destination: https://同源/dav/bookmarks.xbel
PROPFIND bookmarks.xbel, Depth:0             207
DELETE bookmarks.xbel.lock                   204
```

树未改变时跳过上传和 MOVE。每次同步仍会读取全文件，不存在服务端增量游标。原生应用分支直接 PUT 正式文件；本项目实现该分支，但未对 Floccus 手机原生 HTTP 运行时做实机验证。

## XBEL 数据契约

- 必须是 Floccus XBEL XML 声明和单一 `<xbel>` 根。
- 保留实际 Floccus 生成的 `highestId` 注释，只能单调不减，节点 ID 为正的安全整数；0 是服务器合成根。
- `folder`、`bookmark` 嵌套关系确定 parent；同层出现顺序确定 position，不根据标题或时间重新排序。
- `title` 第一个结构子元素；`href` 保存 URL；支持中文、实体转义和官方格式化缩进。
- 单个 ID 不可重复、不可自引用、不可把书签当父级；JSON API 不接受自定义 parent_id。树结构天然不能引用不存在的父级。
- 根 ID 不等于浏览器本地 ID；Floccus mappings 负责此对应关系。
- 固定的官方公共 DTD 声明只是兼容头部，**不会请求该 URL**。拒绝其他 DTD、内部子集、实体声明、XML 样式指令、CDATA、未知结构元素。生产 Worker 不会抓取 URL 或执行书签。
- 每次上传保存原始 XML；节点关系存入 D1 便于约束、导出和保留删除状态。不会通过重新序列化改变官方文件的字节数。

## 数据模型

- `users`：用户名（ASCII、不区分大小写）、带独立盐的密码哈希。
- `credentials`：`auth_mode=token` 保存显式 session / device 的 HMAC 摘要，活跃上限50；`auth_mode=password` 是自动生成的短期同步身份，独立上限32，不保存用户口令或快速口令验证器。过期行由受控后台清理删除。
- `sync_state`：最新完整文档、SHA256 ETag、版本、highest_id。没有伪称提供历史快照检索功能。
- `nodes`：复合主键 `(user_id,node_id)`；节点类型、parent_id、position、created_at/updated_at、版本、deleted。
- `sync_locks`：每用户一行，凭证持有者、随机 generation、base_version、更新时间、过期时间。
- `staging`：绑定用户/凭证/generation/base_version 的临时上传。提交后暂留以支持响应丢失后的同内容 MOVE 重试，释放锁时移除。
- `transaction_guards`：D1 batch 内验证前置条件的临时 CHECK 行，成功后同 batch 删除，不是分布式进程锁。
- `audit_logs`：事件枚举、用户 ID、时间，不含正文和秘密，保留 30 天。
- `rate_limits`：HMAC 处理的限流键、固定窗口计数；每日清理旧窗口。

`nodes` 父子外键同时包含 user_id，延迟到事务结束检查，可在单次批量操作移动整棵树。根记录始终保留。索引覆盖认证 token、用户凭证、父目录顺序、版本、审计时间和限流窗口。

## D1 原子提交

不使用 SQL `BEGIN` 长事务，不把 D1 当本机 SQLite 文件打开。所有持久访问使用 `env.DB.prepare().bind()`；批事务使用官方 `env.DB.batch()`。

提交的一个 batch：
1. CHECK guard 验证凭证仍存在、租约所有者/generation/有效期和 base_version 与当前版本匹配。
2. 另一 guard 验证没有被删除 ID 复活、没有更改现有节点类型。
3. 不再出现的节点标记 deleted，版本推进；不存在物理删除节点后复用 ID。
4. 利用 `json_each` 单次 upsert 全部节点；未改变的节点不写新版本，原始创建时间保持。父级、排序、标题、URL 各自比较，非简单时间戳覆盖。
5. 保存原始快照、ETag、单调 highestId 和新版本；推进当前租约的 base_version；记安全审计事件。
6. 清理 guard。任意错误使 **整个 batch 回滚**。

HTTP 请求可在不同 Worker 实例并发，D1 事务提供数据库级保护；不依赖 JS isolate 内存锁、全局 Map 或 sticky session。不开启 D1 read replica/session 时默认主库读取，避免租约判断读取陈旧副本。

## 冲突、重试与删除

- **客户端冲突策略**：使用目标 Floccus 的 Merge/Default 策略。首次是并集式合并，有基线的后续同步区分节点新增/更新/移动/删除/重排。Default 的同字段冲突本地端优先；不是承诺“更晚时间戳胜出”。两个设备离线改同节点，按持锁同步顺序及各自基线执行该策略。
- **服务端并发策略**：一个用户同时只有一台设备提交。租约默认 15 分钟，每 2 分钟由官方适配器刷新。未持锁、其他设备写入或释放返回 423；版本或墓碑冲突返回 412。
- 不用 409 表达 MOVE 版本冲突：官方适配器会尝试删目标再重试，本项目不能让该兼容分支误删正式文件。
- 同租约同文档的 PUT/MOVE 重放不会重复增长版本。`.temp` 未 MOVE 时连接中断不会改变正式树；MOVE 已成功但响应丢失，下一次同步可重新读取已提交结果。
- 节点被删后保存墓碑，拒绝相同 ID 的重新出现。highest_id 不回退，新增不能碰撞旧 ID。
- **不能承诺防止“语义复活”**：协议没有设备游标/删除确认。失去客户端缓存后，旧设备可能把同一 URL 当全新 ID 创建；服务器无法区分“用户确实重新收藏”与“过期客户端重建”。不能靠虚构字段修复。请保持 Floccus 缓存，暂停失去基线的设备并人工核对。
- 回滚数据库、手工覆盖文档、共享应用密码、使用“强制覆盖”策略属于另有风险的恢复操作；不是正常一致性保证范围。
- 不自动清理墓碑或重用 ID；长期大量删除会增长存储，应监测容量。备份目前由用户/管理员发起，没有外部常驻服务。

### 共享账户密码与可选设备凭证

默认 Basic `USERNAME:PASSWORD`，用户名和密码由 Worker 变量在 `/init` 初始化进 D1；后续按 D1 当前的 scrypt 哈希验证。可选 `USERNAME:app_…` 保持兼容。两条路径最终都得到用户作用域和内部 credential_id，原锁/临时文件/CAS 保护不变。

官方 `.lock` 请求不发送独立设备 ID/租约 token，默认不携带 Cookie。账户密码模式因此用用户、当前密码哈希以及 Cloudflare IP/User-Agent 的 HMAC 生成短期上下文，覆盖不同浏览器/网络等常见场景，但**不能宣称可靠识别每台设备**。同一出口且相同 User-Agent 的两个配置可能共享身份；IP 切换会改变身份，旧锁未到期时可能需要等待。

锁仍在90秒内拒绝同身份重复 PUT，之后支持官方两分钟续租；不会强行抢其他上下文的锁。同出口、同浏览器下应避免重复配置并发同步任务。历史独立凭证及管理 API 保留兼容，备份页面不再提供生成或设备管理入口。

内部上下文24小时到期，剩余不足1小时续期；每用户最多32个活跃上下文，另行计数，不展示在备份页面。超过时429，不删除其他上下文抢位置。重置密码删除所有旧身份和租约；新请求必须使用新密码，旧内存验证缓存不能绕过重置。

## 管理 API

全为独立 `/api/` API，**不是声称 Floccus 能自定义调用它们**：

| 方法/路径 | 认证 | 请求/结果 |
|---|---|---|
| POST `/api/admin/users` | ADMIN_TOKEN Bearer | JSON username/password，201 id/username |
| POST `/api/register` | 无 | 同上；仅 ALLOW_REGISTRATION=true 开启 |
| POST `/api/login` | 密码 | JSON username/password；accessToken/expiresAt |
| GET `/api/me` | session Bearer | 当前用户基本信息 |
| POST `/api/logout` | session Bearer | 撤销当前 session |
| POST/GET `/api/devices` | session Bearer | 创建 `{label}` / 列出；仅创建时返回 applicationPassword |
| DELETE `/api/devices/ID` | session Bearer | 撤销自己的设备，跨用户 ID 不产生作用 |
| GET `/api/export` | session Bearer | JSON 最新状态和节点/墓碑，不含 credentials/users 密码哈希 |
| DELETE `/api/account` | session Bearer | JSON `{confirm:"DELETE"}`，全部个人数据级联清除 |
| POST `/api/admin/reset-password` | ADMIN_TOKEN Bearer | JSON username/password；撤销该用户所有 session/device 和锁 |

JSON 接口必须 `Content-Type: application/json`，最大 8 KiB，不使用 Cookie。错误为 `{error:机器可读代码}`；无效认证 401，权限 403，格式 400/415/422，体积 413，锁 423，冲突 412，限流 429 + Retry-After。错误不回显 SQL、原始认证头或密码。

## 备份页面与兼容初始化路由

- GET `/`：跳转 `/admin`；GET/HEAD `/admin`、`/admin/`、`/admin/app.js`、`/admin/app.css` 提供同源静态备份页与资源。
- GET `/api/setup/status`：返回 `initialized`、`bootstrapConfigured` 布尔值，不返回初始用户名、密码、用户列表或 Token。
- POST `/api/setup`：JSON `username`、`password` 必须匹配配置的初始凭证；只允许空库且未完成过初始化，成功 201、已初始化 409、未配置 503、凭证不匹配 401。
- `bootstrap_state` 单例记录永久保存完成标记，删除账号仅将关联 user_id 设为 NULL；初始化与用户/根节点/同步状态/审计在同一事务中完成。
- 备份页仅使用 setup/status、login、me、export、logout API。不会调用旧设备管理或建号 API，无 Cookie 登录旁路，无直接 D1 浏览器访问。
- `/api/devices` 等旧管理 API 暂时保留作兼容，不作为普通用户的配置流程。

## 数据库初始化与账号配置

- GET/POST `/init`：根据绑定的 D1 自动应用内嵌迁移、准备内部密钥，并将 Worker `USERNAME` / `PASSWORD` 应用到关联账号。首次创建账号，后续配置变化更新同一用户 ID；请求体或 URL 参数不能指定账号。
- 默认返回无敏感内容的 HTML 状态；`Accept: application/json` 返回 `ready`、`accountCreated`、`accountUpdated`。无账号配置且为空库时503，旧密钥丢失或冲突时停止而不替换。
- GET `/api/setup/status` 新增 `databaseInitialized` 布尔值；不返回内部配置。未初始化的普通API返回503 `database_not_initialized`。
- `app_settings` 持久保存内部密钥与清理时间；迁移标记由 `d1_migrations` 事务保护，已应用迁移不重放。原有设备/会话摘要继续使用同一Pepper。
- 过期数据的受控后台清理由请求触发，也兼容旧 Cron；普通部署不需要额外触发器。


### 环境变量关联账号

`environment_account` 单例持久关联 Worker 配置所管理的用户 ID，重命名不会换用户或丢失书签。已关联账号删除后保留空引用标记，不重建账号或自动选择其他用户。

变更账号时以当前用户名、密码哈希和关联 ID 作事务前置条件，原子更新账号、撤销全部凭证/锁/临时文件并记安全审计。用户名冲突或前置条件变化时事务回滚；同配置并发更新只生效一次，重复请求不会撤销新凭证。

旧库优先使用原初始化标记的用户 ID。缺少可靠关联时，要求先用现有账号的用户名和密码完成关联，避免任意选择或覆盖其他用户。只使用兼容的 `BOOTSTRAP_*` 变量时仍按一次性初始化处理，不用它们覆盖已有账号。

该接口显式应用当前部署的配置。回滚 Worker 后访问 `/init` 可能重新应用该部署的旧账号配置；更新时应确认使用当前正式部署，不能把历史预览部署用于账号维护。
