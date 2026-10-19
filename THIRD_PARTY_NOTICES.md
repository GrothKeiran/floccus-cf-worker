# 第三方声明

- 本仓库原创 Workers/SQL/测试驱动/文档采用 MIT，非官方 Floccus 或 Cloudflare 产品，不声明商标授权或商业背书。
- 兼容性测试按固定 SHA 下载 Floccus 源码（MPL-2.0）。源码及其 LICENSE.txt 保存在项目忽略目录 `.cache/upstream/floccus/`；不修改其适配器、树模型、序列化器或合并算法。
- 测试构建仅替换浏览器宿主 permissions/storage、日志、未使用的 native HTTP/HTML/Nextcloud 分支，具体见 prepare-upstream.mjs。生成 bundle 只在本地 `.cache/`，不包含于生产 Worker。如分发此 bundle 或上游源码，须保留上游 MPL 许可与源码提供义务，不得声称它转为 MIT。
- Nextcloud Bookmarks 仅用于源码协议调研，没有复制其 AGPL PHP 代码到本项目。
- fast-xml-parser 及开发工具各遵循自己的 LICENSE；确切版本见 package-lock.json。生产 bundle 包含 XML 解析器依赖及其许可证约束。

控制台发布包会从实际打包模块收集依赖许可证，将本项目 MIT 与第三方完整许可附在 `worker.mjs` 末尾，同时生成 `THIRD_PARTY_LICENSES.txt`。复制控制台代码时不要删去许可注释。
