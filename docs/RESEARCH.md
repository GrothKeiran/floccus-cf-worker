# 协议调研与选型

调研日期：2026-10-18。以实际拉取源码为依据，**下面是固定基线，不代表永久最新版**。

| 项目 | 基线 |
|---|---|
| Floccus | package version 5.11.1，`c8ec55ee5e731206c6f2b34c48e8b4def47d0d5a` |
| Nextcloud Bookmarks | `4616190ef747bd7554356767e823b94844c395f6` |

官方资料：[Floccus 源码](https://github.com/floccusaddon/floccus)、[配置指南](https://floccus.org/guides/)、[Nextcloud Bookmarks](https://github.com/nextcloud/bookmarks)。指南不是协议规格，以下路由均从真实调用方/控制器确认。

链接前缀：
- [固定 Floccus 源码树](https://github.com/floccusaddon/floccus/tree/c8ec55ee5e731206c6f2b34c48e8b4def47d0d5a)
- [固定 Bookmarks 源码树](https://github.com/nextcloud/bookmarks/tree/4616190ef747bd7554356767e823b94844c395f6)

## 1. 适配器体系，没有通用 HTTP API 配置

- `src/lib/AdapterFactory.ts:1–25`：注册表以 `type` 查找工厂，不提供填任意 REST 协议的能力。
- `src/lib/Account.ts:31–33`：`nextcloud-folders`/`nextcloud-bookmarks` 指向 `NextcloudBookmarks`，`webdav` 指向 `WebDav`。
- `src/lib/interfaces/Adapter.ts`、`interfaces/Resource.ts`：节点操作、能力协商、锁生命周期是扩展内部接口，而不是一个可在 UI 自定义的远端 JSON 格式。
- 自定义适配器可在扩展源码新增并注册，但需要构建/维护自定义扩展，承担浏览器签名、安装和上游升级成本。不能让官方扩展通过 URL 自动加载本项目的 TypeScript 类。

## 2. Nextcloud Bookmarks 实际流程

调用方 `src/lib/adapters/NextcloudBookmarks.ts`，路径前缀为 `index.php/apps/bookmarks/public/rest/v2/`：

| 路由 | 调用方位置 | 语义 |
|---|---|---|
| `GET bookmark?page=N&limit=300` | 273–315 | 平铺列表，`data[]` 的每项有 `id,title,url,target,tags,folders[]`；一个书签可属于多个文件夹 |
| `GET folder?root=ID&layers=N` | 350–359 | 获取文件夹层级 |
| `GET folder/ID/children?layers=N` | 446 起 | 混合顺序的子树；客户端把书签复合 ID 组合为 `upstreamId;parentId` |
| `GET folder/ID/hash?hashFn=…` | 421–443 | 稀疏读取；协商哈希算法、可选 `fields[]`，失败时回退重新读取 |
| `POST folder` | 369–386、529 起 | JSON `{title,parent_folder}`，响应 `item.id` |
| `PUT/DELETE folder/ID` | 658、713 | 改名/移动、删文件夹 |
| `PATCH folder/ID/childorder` | 698 | JSON 顺序操作，元素按 type/id 区分 |
| `POST folder/ID/import` | 588 | HTML multipart 批量导入能力 |
| `GET/POST/PUT bookmark[/ID]` | 734、780、823、895 | 查询去重、新增/更新、维护多文件夹关联 |
| `DELETE folder/PARENT/bookmarks/ID` | 956 | 删除某个文件夹关联，不可误当全局删除 |
| `POST/DELETE lock` | 1163–1207 | 同步锁，处理 200/405/423 等状态 |
| `POST bookmark/click` | 1345 | 可选点击数同步 |

另有 `GET ocs/v2.php/cloud/capabilities?format=json`（1002 起），认证为 Basic，响应票据可使后续请求用 Bearer（约 1047、1157、1216、1308）。响应还要求 `status:'success'`、适当 `data`/`item`，不是随便返回 HTTP 200。

**被调用服务的证据**（Bookmarks 当前基线已用 PHP 路由 Attribute，不再假设有 `appinfo/routes.php`）：
- `lib/Controller/BookmarkController.php:189,217,376,422,472,855,884`：读列表/单项、新建、编辑、删除、锁。
- `lib/Controller/FoldersController.php:148,258,332,402,439,480,512,544,575`：建文件夹、去关联、删除、移动、哈希、children、childorder、树。
- 同文件 `toInternalFolderId/toExternalFolderId`：外部根 ID **-1** 与真实 DB 根分离。
- `lib/Service/LockManager.php` 和 `lib/Db/TreeMapper.php`：锁及混合父子顺序的后端职责。

Nextcloud URL 去重/多父关联、OCS 能力、哈希算法字节级一致性、认证票据和 import 是复刻的维护负担。只实现 bookmark CRUD 会遗漏同步核心路径，不能称为兼容。

## 3. 已有 WebDAV/XBEL 协议

固定版本 [WebDav.ts](https://github.com/floccusaddon/floccus/blob/c8ec55ee5e731206c6f2b34c48e8b4def47d0d5a/src/lib/adapters/WebDav.ts)：

| 源码位置 | 确认的行为 |
|---|---|
| 45–57、77–88 | `type:webdav`，相对 `bookmark_file`，派生 `.lock` / `.temp` |
| 111–168 | GET `.lock` 看 `Last-Modified`，15 分钟超时；PUT 抢锁，每 2 分钟刷新；423/409 为争用 |
| 172–202 | DELETE `.lock`，200/204/404 视为释放成功 |
| 205–294 | GET XBEL、浏览器 PROPFIND 字节检查、读取 `highestId`、官方 XBEL 反序列化 |
| 305–391 | 同步生命周期；树哈希未变不上传；变化才序列化 |
| 419–444 | 浏览器：PUT `.temp` → 检查临时长度 → MOVE → 检查正式长度；原生分支为直接 PUT |
| 500 起、625–657 | Basic，MOVE `Destination`、`Overwrite:T`；非 2xx 抛错 |
| 734–774 | 浏览器 PROPFIND，`Depth:0`，从 XML `getcontentlength` 解析字节数 |
| 855–877 | 标准 XBEL 头、静态 DTD 声明、特殊 `highestId` 注释 |

`src/lib/serializers/Xbel.ts:18–75`：数字节点 ID，根 **0**；`folder`/`bookmark` 嵌套表达父子关系；节点在 XML 中出现的顺序就是混合排序；`title`、`href` 是原始数据，不能自创 parent_id 或 position 请求字段。

`src/lib/adapters/Caching.ts:143–310`：新增 ID 从全局 `highestId` 递增，节点增删改/移动/排序先作用于客户端缓存，提交才发送整棵树。远端文件不是逐节点 CRUD 接口。

## 4. 双向合并和根目录由谁负责

- `src/lib/Account.ts:355–413`：无缓存使用 Merge，有缓存使用 Default；客户端保存 mappings 和基线，不能每次清空来假装同步成功。
- `src/lib/strategies/Default.ts:621`、`prepareSync:912`：协商能力、扫描差异、分别规划 CREATE/UPDATE/MOVE/REMOVE/REORDER，冲突本地优先。不是服务器比较时间戳覆盖。
- `src/lib/strategies/Merge.ts`：首次合并不从不存在的基线推导删除。
- `src/lib/browser/BrowserTree.ts:23,43–88`：Firefox `toolbar_____ / unfiled_____ / menu________ / mobile______` 和 Chromium `folderType:'bookmarks-bar'/'other'` 映射由浏览器层负责。

本项目允许用户在每个浏览器选择**原生书签栏为 localRoot**，其内容与 XBEL 根对应，而不是在服务器冒充浏览器根 ID。

## 5. 路线结论

| 路线 | 官方扩展无需修改 | 风险/维护量 | 结论 |
|---|---|---|---|
| A1：复刻 Nextcloud Bookmarks | 理论可行 | 多父关联、能力/票据/哈希/导入，范围较大 | 本版不实现，也不宣称支持 |
| **A2：实现已有 WebDAV/XBEL** | **是** | 全文件传输、锁无设备 token，需每设备独立应用密码 | **本项目采用** |
| B：新增自定义后端适配器 | 否 | 需 fork 注册、UI、扩展构建、签名、安装、升级 | 非必要，不提供伪装成官方的补丁 |

没有 Workers 运行时阻碍 A2：只需 Fetch API、Web Crypto、D1 prepare/batch。无需完整 WebDAV 文件系统，也无需额外的 R2/KV/DO。端到端兼容性通过真实源码测试，而非手写 JSON 模拟响应完成。
