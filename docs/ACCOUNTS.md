# 创建同步账户与每设备应用密码

两种部署方式都需要完成本步骤。**没有默认账号、默认密码或注册网页**，`ready` 成功也不会自动建号。

## 三种密码不要混淆

| 名称 | 用途 | 是否填进 Floccus |
|---|---|---|
| `ADMIN_TOKEN` | 管理员创建用户、恢复密码 | **不填** |
| 用户账户密码 | 登录管理 API，至少 14 字符，最多 256 字符 | **不填** |
| `applicationPassword`（`app_…`） | 某个浏览器的 WebDAV 认证 | **填这个** |

`TOKEN_PEPPER` 则是服务端 Secret，不是任何人的登录口令。每个设备创建独立应用密码，便于独立撤销，并让锁正确区分设备。以下 `owner` 只是示例用户名，并非仓库预设用户。

## 方法 A：项目 CLI（推荐给 Wrangler 用户）

在已经安装依赖的仓库根目录，用 Bash / Git Bash / WSL 执行：

```bash
read -rp 'Worker HTTPS 根地址（不要带 /dav/）: ' SYNC_URL
export SYNC_URL
read -rsp '你设置的线上 ADMIN_TOKEN: ' ADMIN_TOKEN; echo
export ADMIN_TOKEN
read -rsp '为 owner 设置账户密码（至少14字符）: ' FLOCCUS_PASSWORD; echo
export FLOCCUS_PASSWORD
npm run client -- create-user owner
npm run client -- login owner
unset ADMIN_TOKEN FLOCCUS_PASSWORD
npm run client -- device 'Chrome-电脑A'
```

最后返回的 `applicationPassword` 只在签发时显示，安全保存后填进该浏览器的 Floccus。用户名填 `owner`。

为另一台设备再签发一次，不能复制第一台密码：

```bash
npm run client -- device 'Firefox-电脑B'
```

CLI 登录会话保存在项目 `.cache/client/session.json`，默认 24 小时到期，权限 0600。以后出现会话到期时重新登录再签发，不需要再次建号：

```bash
read -rsp 'owner 的账户密码: ' FLOCCUS_PASSWORD; echo
export FLOCCUS_PASSWORD
npm run client -- login owner
unset FLOCCUS_PASSWORD
npm run client -- device 'Edge-电脑C'
```

每次开启新终端还需重新设置 `SYNC_URL`。CLI 默认根地址是本地开发服务，线上使用时不能忘记这个环境变量。

## 方法 B：Windows PowerShell（不需要 Node.js、npm 或 Wrangler）

适合在 Cloudflare 控制台手动完成部署的用户。以下代码只向你输入的服务器地址发请求，请确认是**自己部署的 HTTPS 域名**，不要将管理员 Secret 发送给陌生服务器。

打开 PowerShell 5.1+ / PowerShell 7，先定义以下辅助函数和根地址：

```powershell
$base = (Read-Host '自己的 Worker HTTPS 根地址，不带 /dav/').TrimEnd('/')
if (([uri]$base).Scheme -ne 'https') { throw '线上必须使用 HTTPS' }
function Invoke-BookmarkApi {
    param([string]$Path, [hashtable]$Body, [string]$Token)
    $headers = @{}
    if ($Token) { $headers['Authorization'] = 'Bearer ' + $Token }
    $json = $Body | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri ($base + $Path) -Method Post `
        -ContentType 'application/json; charset=utf-8' -Headers $headers `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}
```

### 首次创建用户

```powershell
$username = Read-Host '新用户名，例如 owner（小写字母、数字等，3到64字符）'
$adminSecure = Read-Host '你设置的 ADMIN_TOKEN' -AsSecureString
$passwordSecure = Read-Host '新账户密码，至少14字符' -AsSecureString
$admin = [System.Net.NetworkCredential]::new('', $adminSecure).Password
$password = [System.Net.NetworkCredential]::new('', $passwordSecure).Password
try {
    $created = Invoke-BookmarkApi '/api/admin/users' `
        @{ username = $username; password = $password } $admin
    '已创建用户：' + $created.username
} finally {
    Remove-Variable admin, password, adminSecure, passwordSecure -ErrorAction SilentlyContinue
}
```

只执行一次。若提示用户名已存在，不要尝试删号重建，直接使用原账户密码登录；忘记密码则由管理员走恢复流程。

### 登录并为一个浏览器签发应用密码

每增加一个设备，执行一次这一段，不要重复建号：

```powershell
$username = Read-Host '用户名'
$label = Read-Host '当前设备名称，例如 Edge-电脑B'
$passwordSecure = Read-Host '该用户的账户密码' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $passwordSecure).Password
try {
    $login = Invoke-BookmarkApi '/api/login' `
        @{ username = $username; password = $password } ''
    $device = Invoke-BookmarkApi '/api/devices' @{ label = $label } $login.accessToken
    [pscustomobject]@{
        WebDavUrl = $base + '/dav/'
        Username = $username
        DeviceId = $device.id
        ApplicationPassword = $device.applicationPassword
        BookmarkFile = 'bookmarks.xbel'
    } | Format-List
} finally {
    Remove-Variable password, passwordSecure, login, device -ErrorAction SilentlyContinue
}
```

请把显示的应用密码存进密码管理器，不要截图分享终端内容。其他浏览器同样用这段签发新的密码。关闭 PowerShell 后，辅助函数和变量会丢失，下一次先执行前面的定义即可。

## 撤销、导出、退出与恢复

项目 CLI 提供以下操作：

```bash
npm run client -- devices
read -rp '要撤销的设备 ID: ' DEVICE_ID
npm run client -- revoke "$DEVICE_ID"
npm run client -- export
npm run client -- logout
```

设备应用密码本身不设置固定到期日，撤销后即不能再用于 DAV。导出文件放在项目 `backups/`；会话、导出、设备密码都不能发布到 GitHub。

忘记账户密码时，由管理员使用 `reset-password`，这会撤销该用户所有会话和设备应用密码，但不删除书签。步骤见[部署维护](DEPLOYMENT.md#安全恢复密码)。

更多 HTTP 路由与数据格式见[协议说明](PROTOCOL.md)。
