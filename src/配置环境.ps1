# 配置环境.ps1 —— 一键配置当前环境（安装器会以管理员身份调用）
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root 'DSH-Pet.exe'
$log = @()
function Say($m) { $script:log += $m; Write-Host $m }

Say "== 鲸鱼娘 一键配置 =="
Say "安装目录：$root"

# 1) 提示音目录
foreach ($k in @('chime', 'notify')) {
  $dir = Join-Path $root ("sounds\" + $k)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; Say ("已创建音效目录：" + $dir) }
  else { Say ("音效目录已存在：" + $dir) }
}

# 2) guard.ini 关键项（全屏隐藏 / 通知接管 / 常隐 DSH 桌宠）
$ini = Join-Path $root 'guard.ini'
if (Test-Path $ini) {
  $text = Get-Content $ini -Raw -Encoding UTF8
  $want = [ordered]@{ 'hide_on_fullscreen' = '1'; 'also_hide_dsh_pet' = '1'; 'hide_dsh_pet_always' = '1'; 'takeover_notifications' = '1'; 'poll_ms' = '500'; 'log' = '1' }
  foreach ($key in $want.Keys) {
    if ($text -match ('(?m)^\s*' + [regex]::Escape($key) + '\s*=')) {
      $text = [regex]::Replace($text, ('(?m)^\s*' + [regex]::Escape($key) + '\s*=.*$'), ($key + '=' + $want[$key]))
    } else { $text = $text.TrimEnd() + "`r`n" + $key + '=' + $want[$key] + "`r`n" }
  }
  [System.IO.File]::WriteAllText($ini, $text, (New-Object System.Text.UTF8Encoding($false)))
  Say "已写入 guard.ini（全屏隐藏 / 通知接管 / 常隐 DSH 桌宠 已开启）"
} else { Say "未找到 guard.ini（跳过）" }

# 3) 开机自启
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$cur = (Get-ItemProperty -Path $runKey -Name 'DSH-Pet' -ErrorAction SilentlyContinue).'DSH-Pet'
$wantCmd = '"' + $exe + '" --autostart'
if ($cur -ne $wantCmd) {
  New-ItemProperty -Path $runKey -Name 'DSH-Pet' -Value $wantCmd -PropertyType String -Force | Out-Null
  Say "已设置开机自启"
} else { Say "开机自启已存在" }

# 5) 启动桌宠
$running = Get-CimInstance Win32_Process -Filter "Name='DSH-Pet.exe'" -ErrorAction SilentlyContinue
if (-not $running) {
  try { Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList '--autostart'; Say "已启动桌宠" }
  catch { Say ("启动失败：" + $_.Exception.Message) }
} else { Say "桌宠已在运行" }
Say "配置完成"
