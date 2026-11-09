# Emby Bridge · 播放器配置互转

把 Windows 版 Rodel Player「设置 → 备份与恢复 → 其它应用」的导入/导出能力，单独做成一个**纯前端、零后端、跨平台**的小工具。在 Mac、iPhone、安卓、平板或任意浏览器里，把一种播放器的配置备份转换成另一种，不用再对着几十台 Emby 服务器手工重录账号。

> ⚠️ **实验性工具，不保证可用。** 各播放器备份格式是根据手头有限的样本逆向出来的兼容实现，不是官方规范；客户端版本更新、备份来源不同（官方导出 vs Rodel 导出）都可能让解析或导入失败。目前已发现并修过若干问题，**仍可能有未覆盖的 bug**。请务必保留原始备份，导出后先在目标 App 里逐台核对，确认可用再替换旧配置，别把生成的备份当唯一副本。详见下方「已知限制」。

👉 在线使用：**https://plannm.github.io/emby-bridge/** ｜ 或打开根目录的 **`index.html`**（单文件，双击即可，完全离线）。

---

## 它能做什么

1. **导入**：拖入 Rodel 导出的任意一种播放器备份；自动识别格式并解密，列出所有服务器。
2. **编辑**：修改名称、地址、账号、密码、User ID、Token、图标、备用线路；支持批量粘贴、CSV、去重、搜索、勾选导出范围。
3. **导出**：一键生成目标播放器可导入的备份文件，文件名/扩展名与 Rodel 导出的保持一致。

| 播放器 | 文件 | 支持 |
| --- | --- | --- |
| Hills | `.json` | 读 / 写 |
| AfuseKt | `.json` | 读 / 写（明文，不含 User ID / Token） |
| Yamby / Tsukimi CommonConfig | `.json` | 读 / 写 |
| CapyPlayer | `.json` | 读 / 写 |
| LinPlayer | `.lpbak` | 读 / 写 |
| WWPlayer | `.wwpcfg` | 读 / 写 |
| AI Player | `.json` | 读 / 写 |
| 通用中间格式 / CSV | `.json` / `.csv` | 读 / 写（明文，便于长期保存与批量编辑） |

在有限的真实备份样本上做过 7×7「解析 → 生成 → 再解析」验证：49 组中 43 组字段完全一致，剩下 6 组是导出到 AfuseKt 时丢失 User ID / Token（该格式本身没有这两个字段）。**这只代表这几个样本能跑通，不代表所有版本、所有来源的备份都兼容。**

---

## 已知限制（务必先读）

- **不保证可用**：格式来自逆向兼容，不是各播放器的官方规范；客户端升级、备份来源不同都可能失效。目前已发现并修过若干问题，仍可能有未覆盖的 bug。
- **AfuseKt** 明文结构没有 User ID / Access Token 字段，转到该格式必然丢失，导入后需重新登录。
- **CapyPlayer 新版**（`database_version: 22`，例如 iPhone 官方导出）备份本身不保存 Access Token；同格式往返会保留偏好、观看统计、徽章包等其它表以及 `app_version` / `database_version`，但转成别的格式再转回来就只剩服务器信息。旧版（`database_version: 5`，Rodel 导出）才有 `token` 字段。
- **Hills 官方导出**与 Rodel 导出的 CBC IV 尾部不同，解密后第一块会损坏；现已用「重建 JSON 头」容错解析，但不保证其它版本也兼容。
- **Hills v3**（`version: 3`，带 `serversData` / `settings` / `iconPacks` 等加密段）现在可以导入，读取的是其中的 `data` 段（与 v2 结构相同，`serversData` 内没有额外服务器）；但**导出回 Hills 仍生成 v2 结构**，新版 App 是否接受、v3 的其它设置能否保留均未实测。建议把 v3 转成其它格式使用，或继续用 Rodel Player 做 Hills 方向的导出。
- **WWPlayer V1** 是可逆混淆而非强加密，官方也提示 `.wwpcfg` 应视为凭据文件。
- 跨格式转换只迁移名称 / 地址 / 账号 / 密码 / Token / 线路等通用字段，播放器特有的开关与设置不保证保留。
- 导出文件请先在目标播放器里验证能导入、能连上，再替换旧配置；**不要覆盖或删除原始备份**。

---

## 隐私与安全（重要）

- **绝不联网**：页面通过 CSP 把 `connect-src` 设为 `none`，禁掉 fetch / XHR / WebSocket / Beacon；没有外部脚本、字体、图片、统计代码。所有加解密用浏览器内置的 Web Crypto 在本地完成。
- **绝不登录服务器**：工具只读写备份文件，不会向任何 Emby / Jellyfin 地址发起请求，也不会拿账号密码去试登录，因此不会触发服务器的风控或封号。
- **不落盘**：不写 `localStorage`、Cookie、IndexedDB；刷新页面即清空。
- **备份即凭据**：导出文件里包含账号、密码与访问令牌（或等价的可逆数据）。请当作密码文件保管，**不要提交到公开仓库、不要传网盘分享链接、不要发给别人**。仓库的 `.gitignore` 已排除常见备份文件名。

> 本工具仅用于迁移你本人有权使用的播放器配置，与 Rodel Player 及各播放器官方无关联。

---

## 部署到域名 / GitHub Pages

`index.html` 是**自包含单文件**，不需要构建、不需要服务器、不需要 API Key：

1. 把本仓库推到 GitHub（**只推代码，别推真实备份**）。
2. 仓库 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`。
3. 几分钟后即可用 `https://<用户名>.github.io/<仓库名>/` 访问。
4. 自定义域名：在 DNS 加 CNAME 指向 `<用户名>.github.io`，在 Pages 的 Custom domain 填域名并开启 HTTPS；仓库里放一个内容为域名的 `CNAME` 文件即可。

也可以把 `index.html` 放到任意静态托管（Cloudflare Pages、Vercel、Nginx、对象存储静态网站）。建议 HTTPS —— Web Crypto 在 HTTPS、localhost 以及主流浏览器的 `file://` 下都可用。

---

## 本项目结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 构建产物，单文件，可直接双击或部署 |
| `src/core.js` | 格式识别、解析、生成、加解码（纯逻辑，浏览器/Node 通用） |
| `src/app.js` | 页面交互 |
| `src/style.css` | 深色响应式样式 |
| `src/template.html` | 页面骨架 |
| `build.mjs` | 把 src 内联成 `index.html` |
| `tests/selftest.mjs` | 用虚构数据跑全格式往返测试 |
| `docs/FORMATS.md` | 各备份格式的技术说明 |

本地开发：

```bash
node build.mjs              # 重新生成 index.html
node tests/selftest.mjs     # 自检（不需要网络、不需要安装依赖）
```

---

## 使用流程示例

1. Windows 上：Rodel Player → 设置 → 备份与恢复 → 其它应用 → 任选一个应用点「导出配置」。
2. 把文件传到 Mac / 手机，打开本网页，拖进「导入备份」。
3. 检查列表，必要时批量粘贴补齐几十台服务器、去重。
4. 点目标播放器的导出卡片 → 得到 `.json` / `.lpbak` / `.wwpcfg` → 在目标 App 里「导入配置」。

建议同时导出一份「通用中间格式」自己留档：它是明文 JSON，以后在任何设备上打开本网页导入它，就能再转成任意播放器格式。
