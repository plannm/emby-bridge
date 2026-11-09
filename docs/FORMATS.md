# 备份格式说明

> ⚠️ 以下都是对有限样本逆向得到的兼容实现，**不保证与所有版本、所有来源的备份兼容**。请保留原始备份，并在目标 App 里验证后再替换配置。

以下格式来自各播放器之间交换服务器配置的备份文件（只包含连接器信息，不含应用设置或历史记录）。全部加解密在 `src/core.js` 中实现。

固定密钥/口令均来自各播放器既有的互通格式实现，仅用于文件格式的读写兼容，不是任何服务的访问凭据；工具不会用它们去连接服务器。

| 格式 | 外层 | 内层加密 |
| --- | --- | --- |
| AfuseKt | JSON 数组 | 无（明文） |
| Yamby / Tsukimi CommonConfig | `{from, version, export_time, configs[], ...}` | 每条 config 单独 AES-256-CBC，固定口令派生 key/IV，PKCS7 |
| LinPlayer | `{from, version, export_time, configs[], _key}` | 每条 config 单独 AES-256-CBC，`_key` 为 base64 的 32 字节密钥，IV 取密钥前 16 字节 |
| WWPlayer | `{magic, nonce, payload}` | V1 自逆字节变换：`out[i] = in[i] ^ rol8(KEY[i % len], i % 8) ^ nonce[i % len]`，`nonce` 为 UUID 字符串 |
| CapyPlayer | `{version, created_at, ..., encrypted_data}` | `base64(iv):base64(ct||tag)`，PBKDF2-SHA256 派生密钥 + AES-256-GCM（16 字节 IV，128 位 tag），内层为 `tables.media_server_resources` |
| Hills | `{version:2, data, settings, iconPacks, customIcons}` | AES-256-CBC + 固定 key/IV，内层为 `{data:[...]}` |
| AI Player | `{data}` | AES-256-CBC + 固定 key/IV，内层为 `{version:1, exportedAt, servers:[...]}` |

## 字段映射

统一模型字段：`name / serverName / type / url / username / password / userId / accessToken / icon / lines[] / activeLine / remark / sortOrder`。

| 格式 | 地址 | 凭据 | 线路 |
| --- | --- | --- | --- |
| AfuseKt | `nowAddress` / `originalAddress` | `account` / `password` | `lines[].address`（`isNow` 标记当前） |
| Yamby | `url` | `authorization.{user_name,password,user_id,access_token}` | `lines[].url` |
| LinPlayer | `url` | `username` + `linplayer.password` / `user_id` / `access_token` | `linplayer.lines[].url` |
| WWPlayer | `servers[].lines[].url`（顶层另有首台服务器的 `embyServerUrl`） | `username` / `password` / `userId` / `accessToken` | `servers[].lines[]`，`activeLineId` 指向当前线路 |
| CapyPlayer | `host` + `port` + `path` + `https` | `username` / `password` / `token` / `user_id` | `backup_routes`（JSON 字符串） |
| Hills | `serverUrl` | `username` / `password` / `authenticateJson`（`User.Id` + `AccessToken`） | `serverRoutingList[]` |
| AI Player | `preferredLineUrl` / `lines[].url` | `username` / `encryptedPassword` / `lastKnownUserId` / `encryptedToken` | `lines[]`，`isMain` 标记主线路 |

## 已知差异

- **AfuseKt** 明文结构没有 User ID / Access Token 字段，转到该格式会丢失这两项，导入目标播放器后需要重新登录。
- **Hills** 原始编码器写出的内层文档缺少最后一个 `}`，生成时按原样复现以兼容既有导入器；解析时两种写法都接受。
- **Hills 不同来源的备份**可能使用不同的 CBC IV 尾部（前 8 字节相同），因此用同一密钥解密后第一块 16 字节是损坏的。AES-CBC 只有第一块依赖 IV，后续块完好，解析器会重建固定的 JSON 前缀再解析，服务器及线路/凭据均可完整恢复。官方文件多出的 `mpvConf`、`serverVersion`、`deviceIdHash` 等字段在同格式往返时也会保留。
- **Hills v3**（`version: 3`）的 envelope 多了 `serversData`、`settings`、`iconPacks`、`enableImpeller` 等字段，其中 `settings` / `iconPacks` / `serversData` 是独立的加密 base64 段。`serversData` 解开后是 `{"version":1,"servers":[...]}`（字段为 `protocol` / `displayName` / `preferencesJson` 等，不含密码与 Token），与 `data` 段是同一批服务器的两种表示，实测没有额外服务器。因此解析统一读取 `data` 段，格式识别按 `version >= 2` 加 `iconPacks`/`serversData` 特征判断，并保留 `HillsBackup-*` 文件名兜底。**导出仍生成 v2 结构**，不重建 v3 的其它加密段。
- **WWPlayer V1** 是可逆混淆而非强加密（其官方文档亦如此说明），`.wwpcfg` 应视为凭据文件。
- **CapyPlayer 新版**（`database_version: 22`，如 iPhone 官方导出）的 `media_server_resources` 行里没有 `token` 字段（只有 `user_id`），且内层多了 `preference_keys` / `preference_prefixes` / `badge_packs` / `watch_stats_*` 等表。同格式往返会把整个内层文档和 `app_version` / `database_version` / `device_name` 一起保留；跨格式转换则只保留服务器信息。
- 部分格式在原始对象里带有播放器特有的开关（代理、隐藏媒体库、轮播等）。同格式往返时会保留这些字段；跨格式转换只迁移上表列出的通用字段。
