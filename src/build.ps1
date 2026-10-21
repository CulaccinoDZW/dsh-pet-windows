$ErrorActionPreference = 'Stop'

$root    = 'G:\文件\DSH工作区'
$build   = Join-Path $root '.pet-build'
$out     = Join-Path $root 'DSH-Pet-Windows'
$pkg     = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-pet'
$electron= Join-Path $env:USERPROFILE '.dsh\electron'
$csc     = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$node    = 'C:\Users\16876\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$python  = 'C:\Users\16876\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'

Write-Host '=== 1/7 准备目录 ==='
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'runtime') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'app') | Out-Null

Write-Host '=== 2/7 复制 Electron 运行时（约 347 MB）==='
robocopy $electron (Join-Path $out 'runtime\electron') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy electron failed: $LASTEXITCODE" }

Write-Host '=== 2b/7 精简 Electron（只留中英文语言包 / 去掉用不到的显卡编译器与许可全文）==='
$eleOut = Join-Path $out 'runtime\electron'
# 1) 语言包：只保留 zh-CN / en-US（约省 44 MB）
$localesDir = Join-Path $eleOut 'locales'
if (Test-Path $localesDir) {
  Get-ChildItem $localesDir -Filter '*.pak' | Where-Object { $_.Name -notin @('zh-CN.pak', 'en-US.pak') } | Remove-Item -Force
}
# 2) 第三方许可全文（19 MB 纯文本）压缩存放，保留合规材料（约省 17 MB）
$lic = Join-Path $eleOut 'LICENSES.chromium.html'
if (Test-Path $lic) {
  $gz = "$lic.gz"
  $in = [System.IO.File]::OpenRead($lic)
  $outFs = [System.IO.File]::Create($gz)
  $gzs = New-Object System.IO.Compression.GZipStream($outFs, [System.IO.Compression.CompressionLevel]::Optimal)
  $in.CopyTo($gzs); $gzs.Dispose(); $outFs.Dispose(); $in.Dispose()
  Remove-Item $lic -Force
}
# 3) 桌面桌宠用不到的组件：DirectX 着色器编译器（WebGPU 用）与 SwiftShader Vulkan 软件光栅（约省 32 MB）
foreach ($f in @('dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vulkan-1.dll')) {
  $p = Join-Path $eleOut $f
  if (Test-Path $p) { Remove-Item $p -Force }
}
$eleSize = [math]::Round(((Get-ChildItem $eleOut -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "    精简后 Electron 运行时：$eleSize MB"

Write-Host '=== 3/7 复制 dsh-pet 插件本体 ==='
foreach ($item in @('lib', 'assets', 'runtime', 'package.json')) {
  $srcPath = Join-Path $pkg $item
  if (-not (Test-Path $srcPath)) { throw "missing $srcPath" }
  if ((Get-Item $srcPath).PSIsContainer) {
    robocopy $srcPath (Join-Path (Join-Path $out 'app') $item) /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $item failed: $LASTEXITCODE" }
  } else {
    Copy-Item $srcPath (Join-Path (Join-Path $out 'app') $item) -Force
  }
}

Write-Host '=== 3b/7 复制外部运行依赖（@electron/get 依赖树）==='
& $node (Join-Path $build 'collect_deps.mjs') $pkg (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw 'collect_deps failed' }

Write-Host '=== 3c/7 给独立版打补丁（AI 对话 / DSH 桥接 / 右键菜单 / 退出）==='
& $node (Join-Path $build 'patch_v3.mjs') (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw 'patch failed' }

Write-Host '=== 3d/7 追加 随机动作 菜单 ==='
& $node (Join-Path $build 'patch_sprite_extra.mjs') (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw 'patch sprite extra failed' }

Write-Host '=== 3e/7 独立配置 / 大小 / 最小化 / 托盘（patch_v4）==='
& $node (Join-Path $build 'patch_v4.mjs') (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw 'patch v4 failed' }

Write-Host '=== 3f/7 通知接管开关 / 余额菜单条件显示（patch_v5）==='
& $node (Join-Path $build 'patch_v5.mjs') (Join-Path $out 'app')
if ($LASTEXITCODE -ne 0) { throw 'patch v5 failed' }

Write-Host '=== 3g/7 提示音 / 整点报时 / 待办（patch_v6）==='
& $node (Join-Path $build 'patch_v6.mjs') (Join-Path $out 'app')

Write-Host '=== 3h/7 待办整屏浮层修复（patch_v7）==='
& $node (Join-Path $build 'patch_v7.mjs') (Join-Path $out 'app')
Write-Host '=== 3i/7 待办重复语义 / 改名 / API Key（patch_v8）==='
& $node (Join-Path $build 'patch_v8.mjs') (Join-Path $out 'app')
Write-Host '=== 3j/7 用 ins/ 最终版 helper 覆盖（patch_v10）==='
& $node (Join-Path $build 'patch_v10.mjs') (Join-Path $out 'app')
Write-Host '=== 3k/7 API Key 路由 / 报时尺寸 / 报时音回退（patch_v11）==='
& $node (Join-Path $build 'patch_v11.mjs') (Join-Path $out 'app')
Write-Host '=== 3l/7 移除系统通知接管（patch_v12）==='
& $node (Join-Path $build 'patch_v12.mjs') (Join-Path $out 'app')

Write-Host '=== 3m/7 对话回落本地 API + via 标记（patch_v13）==='
& $node (Join-Path $build 'patch_v13.mjs') (Join-Path $out 'app')

Write-Host '=== 3n/7 API Key 保存即生效（patch_v14）==='
& $node (Join-Path $build 'patch_v14.mjs') (Join-Path $out 'app')

Write-Host '=== 3o/7 Key 自动识别端点（patch_v15）==='
& $node (Join-Path $build 'patch_v15.mjs') (Join-Path $out 'app')

Write-Host '=== 3p/7 断开 DSH 后隐藏余额 + 不弹提示（patch_v16）==='
& $node (Join-Path $build 'patch_v16.mjs') (Join-Path $out 'app')

Write-Host '=== 3q/7 余额菜单双保险（patch_v17）==='
& $node (Join-Path $build 'patch_v17.mjs') (Join-Path $out 'app')
Write-Host '=== 4/7 生成图标（白底抠成透明）==='
& $python (Join-Path $build 'make_ico.py') (Join-Path $pkg 'assets\logo.png') (Join-Path $build 'app.ico') (Join-Path $out 'app\assets\logo-transparent.png')
if ($LASTEXITCODE -ne 0) { throw 'icon generation failed' }

Write-Host '=== 5/7 编译启动器 DSH-Pet.exe ==='
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /win32icon:"$build\app.ico" `
  /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll /r:System.ServiceProcess.dll `
  /out:"$out\DSH-Pet.exe" (Join-Path $build 'launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

Write-Host '=== 6/7 写入说明文件 / 配置 / 自启脚本 ==='
foreach ($doc in @('使用说明.txt', 'guard.ini', '设置开机自启.bat', '取消开机自启.bat', '配置环境.ps1', '一键配置.bat')) {
  Copy-Item (Join-Path $build $doc) (Join-Path $out $doc) -Force
}
# 快捷方式单独引用一个 .ico（路径与 exe 不同，避免 Windows 图标缓存沿用旧的“白底”图标）
Copy-Item (Join-Path $build 'app.ico') (Join-Path $out 'DSH-Pet.ico') -Force
# 默认提示音：打包时放进 sounds\chime 与 sounds\notify（存在则覆盖）
$defaultSfx = Join-Path $build 'ins\sounds\1.mp3'
if (Test-Path $defaultSfx) {
  foreach ($k in @('chime','notify')) {
    $d = Join-Path $out ('sounds\' + $k)
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    Copy-Item $defaultSfx (Join-Path $d '1.mp3') -Force
  }
  Write-Host '    默认提示音 1.mp3 已放入 sounds\chime 与 sounds\notify'
}

Write-Host '=== 7/10 自检 ==='
& $node (Join-Path $out 'app\lib\standalone.js') --check 2>&1 | ForEach-Object { "    $_" }

Write-Host '=== 8/10 编译卸载程序 Uninstall.exe ==='
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /win32icon:"$build\app.ico" `
  /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /out:"$build\Uninstall.exe" (Join-Path $build 'uninstall.cs')
if ($LASTEXITCODE -ne 0) { throw 'uninstall csc failed' }

Write-Host '=== 9/10 打包安装用的 payload.tar.zst（zstd-19，比 zip 小很多）==='
$payload = Join-Path $build 'payload.tar.zst'
if (Test-Path $payload) { Remove-Item $payload -Force }
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { throw "missing tar.exe: $tarExe" }
$sw = [Diagnostics.Stopwatch]::StartNew()
Push-Location $out
& $tarExe --zstd --options "zstd:compression-level=19" -cf $payload . 2>&1 | Out-Null
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "tar payload failed: $LASTEXITCODE" }
$sw.Stop()
Write-Host ("    payload.tar.zst：{0:N1} MB（压缩用时 {1:N0}s）" -f ((Get-Item $payload).Length / 1MB), $sw.Elapsed.TotalSeconds)

Write-Host '=== 10/10 编译安装程序 DSH-Pet-Setup.exe ==='
$res1 = "/resource:$payload,DSH-Pet-Payload.tar.zst"
$res2 = "/resource:$build\Uninstall.exe,DSH-Pet-Uninstall.exe"
$setupExe = Join-Path $root 'DSH-Pet-Setup.exe'
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /win32icon:"$build\app.ico" `
  /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  $res1 $res2 /out:"$setupExe" (Join-Path $build 'setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'setup csc failed' }

$sizeMB = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ''
Write-Host "输出目录 : $out"
Write-Host "总大小   : $sizeMB MB"
Write-Host ("安装程序 : {0}（{1:N1} MB）" -f $setupExe, ((Get-Item $setupExe).Length / 1MB))
Write-Host "文件清单（顶层）:"
Get-ChildItem $out | Select-Object Mode, @{n='Size';e={if($_.PSIsContainer){''}else{$_.Length}}}, Name | Format-Table -AutoSize | Out-String | ForEach-Object { "    $_" }
