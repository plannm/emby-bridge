# 备份格式说明

> ⚠️ 以下都是对有限样本逆向得到的兼容实现，**不保证与所有版本、所有来源的备份兼容**。请保留原始备份，并在目标 App 里验证后再替换配置。

以下格式来自播放器配置交换或整份备份。CapyPlayer 和 WWPlayer 手机端备份可能包含应用设置、历史记录及副表；其它格式也可能带文档级设置。全部加解密在 `src/core.js` 中实现，解析后的整份文档通过独立 `context` 保存，不寄存在第一台服务器中。

固定密钥/口令均来自各播放器既有的互通格式实现，仅用于文件格式的读写兼容，不是任何服务的访问凭据；工具不会用它们去连接服务器。

| 格式 | 外层 | 内层加密 |
| --- | --- | --- |
| AfuseKt | JSON 数组 | 无（明文） |
| Yamby / Tsukimi CommonConfig | `{from, version, export_time, configs[], ...}` | 每条 config 单独 AES-256-CBC，固定口令派生 key/IV，PKCS7 |
| LinPlayer | `{from, version, export_time, configs[], _key}` | 每条 config 单独 AES-256-CBC，`_key` 为 base64 的 32 字节密钥，IV 取密钥前 16 字节 |
| WWPlayer 电脑端 | `{magic, nonce, payload}` | V1 自逆字节变换：`out[i] = in[i] ^ rol8(KEY[i % len], i % 8) ^ nonce[i % len]`，`nonce` 为 UUID 字符串 |
| WWPlayer 手机端 | `{schemaVersion:2, exportedAtMs, credentialsIncluded:false, servers[], ...}` | 无；便携格式不包含密码 / Token |
| CapyPlayer | `{version, created_at, ..., encrypted_data}` | `base64(iv):base64(ct||tag)`，PBKDF2-SHA256 派生密钥 + AES-256-GCM（16 字节 IV，128 位 tag），内层为 `tables.media_server_resources` |
| Hills | `{version:2, data, settings, iconPacks, customIcons}` | AES-256-CBC + 固定 key/IV，内层为 `{data:[...]}` |
| AI Player | `{data}` | AES-256-CBC + 固定 key/IV，内层为 `{version:1, exportedAt, servers:[...]}` |

## 字段映射

统一模型字段：`id / name / serverName / type / url / username / password / userId / accessToken / icon / lines[] / primaryLineId / activeLineId / activeLine / remark / sortOrder`。服务器 `id` 是页面内稳定身份，原生服务器 ID 独立保存在 `raw[format]`，避免多个来源复用同一个原生 ID 时冲突。每条线路有稳定 `id` 和 `raw[format]`；原生 ID、代理、`source` 等按线路身份保留，不按数组下标复用。`activeLine` 为兼容索引，由唯一 `activeLineId` 同步生成。

| 格式 | 地址 | 凭据 | 线路 |
| --- | --- | --- | --- |
| AfuseKt | `nowAddress` / `originalAddress` | `account` / `password` | `lines[].address`（`isNow` 标记当前） |
| Yamby | `url` | `authorization.{user_name,password,user_id,access_token}` | `lines[].url` |
| LinPlayer | `url` | `username` + `linplayer.password` / `user_id` / `access_token` | `linplayer.lines[].url` |
| WWPlayer 电脑端 | `servers[].lines[].url`（顶层另有首台服务器的 `embyServerUrl`） | `username` / `password` / `userId` / `accessToken` | `servers[].lines[]`，`activeLineId` 指向当前线路 |
| WWPlayer 手机端 | `servers[].lines[].serverUrl`（`activeLineId` 指向当前线路） | 便携记录仅含 `userName` / `userId`，不含密码 / Token | `servers[].lines[]`（`lineId` / `serverUrl` / `name` / `source`） |
| CapyPlayer | `host` + `port` + `path` + `https` | `username` / `password` / `token` / `user_id` | `backup_routes`（JSON 字符串） |
| Hills | `serverUrl` | `username` / `password` / `authenticateJson`（`User.Id` + `AccessToken`） | `serverRoutingList[]` |
| AI Player | `preferredLineUrl` / `lines[].url` | `username` / `encryptedPassword` / `lastKnownUserId` / `encryptedToken` | `lines[]`，`isMain` 标记主线路 |

## 文档上下文与导出契约

```js
const parsed = await EmbyBridge.parse(text, format);
// parsed.context 独立保存原文档及解密内容；服务器仅记录来源关联。
const options = { mode: 'full', context: parsed.context, selectedOnly: true };
const check = EmbyBridge.inspectExport(parsed.servers, format, options);
// 界面先展示 errors / warnings，用户确认后生成：
if (check.ok) await EmbyBridge.build(parsed.servers, format, options);
```

`build()` 默认 `mode: 'servers'`，不会隐式带出应用设置、播放历史或整份副表。完整模式要求同格式、单一来源、全量服务器，拒绝子集、去重删减、混合来源和新增服务器；Hills v3 暂时只能迁移为 v2。服务器迁移也可传 `context` 以保留 CapyPlayer 等必要版本元数据，但不会因此恢复历史。

通用中间 JSON v2 保留服务器 / 线路的原生扩展和稳定身份，不包含整份文档上下文或 UI 选择状态，仍可读 v1。CSV 线路列使用 JSON，整体按引号状态解析，支持多行和双引号；旧线路语法有歧义时拒绝。导出 CSV 不修改凭据，公式风险仅提示，建议表格软件按文本导入。

URL 只在身份比较键中规范化协议和主机大小写；路径、查询、尾部斜杠、URL 内嵌账号密码保持原值。CapyPlayer 的 host / port / path 分拆无法表达查询参数、片段或内嵌凭据时，预检与 `build()` 都拒绝导出。还会拒绝不完整 scheme、反斜杠、原始空白 / 控制字符和无法无损表达的端口 0，避免 URL 解析器隐式修正地址；保留原始路径文本（包括根斜杠、dot segment、百分号编码），协议 / 主机及默认端口的原生规范化会预先提示。活动线路写入 Capy `isUse`、Hills `selectedServerRoutingId` 及各播放器对应引用；删除最后一条备用线路时明确输出空数组。

## 已知差异

- **AfuseKt** 明文结构没有 User ID / Access Token 字段，转到该格式会丢失这两项，导入目标播放器后需要重新登录。
- **Hills** 原始编码器写出的内层文档缺少最后一个 `}`，生成时按原样复现以兼容既有导入器；解析时两种写法都接受。
- **Hills 不同来源的备份**可能使用不同的 CBC IV 尾部（前 8 字节相同），因此用同一密钥解密后第一块 16 字节是损坏的。AES-CBC 只有第一块依赖 IV，后续块完好，解析器会重建固定的 JSON 前缀再解析，服务器及线路/凭据均可完整恢复。服务器内的 `serverVersion`、`deviceIdHash` 等扩展按原生字段保留；文档级 `mpvConf` 等仅在同源全量的完整 v2 备份模式中保留。
- **Hills v3**（`version: 3`）的 envelope 多了 `serversData`、`settings`、`iconPacks`、`enableImpeller` 等字段，其中 `settings` / `iconPacks` / `serversData` 是独立的加密 base64 段。`serversData` 解开后是 `{"version":1,"servers":[...]}`（字段为 `protocol` / `displayName` / `preferencesJson` 等，不含密码与 Token），与 `data` 段是同一批服务器的两种表示，实测没有额外服务器。因此解析统一读取 `data` 段，格式识别按 `version >= 2` 加 `iconPacks`/`serversData` 特征判断，并保留 `HillsBackup-*` 文件名兜底。**导出仍生成 v2 结构**，不重建 v3 的其它加密段。
- **WWPlayer V1** 是可逆混淆而非强加密（其官方文档亦如此说明），`.wwpcfg` 应视为凭据文件。
- **WWPlayer 手机端**使用明文 `schemaVersion: 2` 便携备份（`preferences` / `servers` / `playbackHistory` / `collections` / `discoveryHomes` / `nexusState` 等），与电脑端 `.wwpcfg` 完全不同。默认服务器迁移生成完整的安全骨架，不夹带历史；新骨架启用 TLS 证书校验。完整原生模式保留来源其它文档字段，也尊重来源显式关闭证书校验的选择，并在导出前警告。已核对的 Android 0.4.9 不支持此格式携带密码 / Token，详见下节。
- **CapyPlayer 新版**（`database_version: 22`，如 iPhone 官方导出）的 `media_server_resources` 行可能没有 `token` 字段（只有 `user_id`），且内层多了 `preference_keys` / `preference_prefixes` / `badge_packs` / `watch_stats_*` 等表。传入来源 `context` 后服务器迁移保留应用 / 数据库版本，但清空副表和偏好；完整原生模式保留整份内层及来源元信息。v22 原生行没有 token 列时不擅自新增列，相关损失会提示。
- 部分格式带代理、隐藏媒体库、轮播等服务器级开关。同格式尽量保留服务器扩展；WWPlayer 手机端仅输出已核对的可移植字段，未知服务器 / 线路扩展不随文件迁移。文档级设置只有显式完整模式才保留。未知 WWPlayer 手机端 schemaVersion、通用 JSON 或 AI Player 版本不会自动降级重标。

## WWPlayer Android 0.4.9 便携导入契约

本次核对的是官方 Android **0.4.9 / versionCode 593**（`com.wwplayer.mobile`），不是电脑端，也不是用户实际版本的运行验收。官方[发布元数据](https://updates.wwplayer.com/updates/v1/mobile/latest.json)返回的包 SHA-256 与下载文件一致：`b5b0ec7876e3c0b0fa0742ad4e07f2e8ff4e6c40ce395aab896a2c56818dde7d`。发布元数据会随版本更新，以上版本及摘要只标识本次核对的包。

- **密码 / Token 不可移植**：`PortableServerProfile` 序列化器没有 `password` / `accessToken` / credentials 映射。`credentialsIncluded: true` 被导入校验器无条件判为 `SensitiveData`；`requiresAuthentication: false` 也被拒绝。错误映射文案为“便携数据包含不允许导入的敏感字段”。
- **未知键不是迁移通道**：原生 JSON 配置启用 `ignoreUnknownKeys`。在 flag 为 false 时，额外密码 / Token 键被忽略而非恢复登录。因此不能把“加两个字段就一定导入失败”当作实际故障原因。
- **必需字段与默认值**：顶层 `exportedAtMs` 为必需字段；`PortableServerProfile` 的 `serverId` / `displayName` / `lines` / `activeLineId` 必需，线路的 `lineId` / `serverUrl` 必需。其它已知字段有序列化默认值，不应把完整默认模板中的每项都解释成原生必需字段。
- **本工具输出**：`credentialsIncluded: false`、`requiresAuthentication: true`；用户身份保留。手机服务器只保留 22 个已核对字段，线路只写 `lineId` / `serverUrl` / `name` / `source`，不夹带未知 credentials 或旧字段。
- **预检与修复**：显示名称不得为空；输出标识匹配 `[A-Za-z0-9._:-]{1,96}`，服务器标识在文件内唯一、线路标识在服务器内唯一，活动标识指向实际输出线路。无效 / 重复原生标识只在服务器迁移模式生成新标识；完整模式拒绝，以免旧附属数据的引用错位。
- **URL 保守策略**：拒绝 URL 内嵌账号、片段及疑似认证查询参数（包括百分号编码的键名），且检查完整 HTTP / HTTPS 写法；不会自动删除参数或把密码塞进地址。查询键检测是本工具额外的保守预检，不宣称与所有原生版本的完整敏感键列表相同。非敏感查询保持原值。

上述控制流和字段来自官方包的离线静态分析（`classes.dex` 的 `Lgfb.i(Lmfb;)Lqfb;`、`Lkfb`、`Lyhb`、`Lvhb`），**未安装或启动 App，也未登录 / 探测任何媒体服务器**。不把该结论扩展为 App 的所有内部云快照都不支持凭据迁移；其它路径或版本需另有证据。
