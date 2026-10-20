$ErrorActionPreference = 'Stop'
$root  = 'G:\文件\DSH工作区'
$build = Join-Path $root '.pet-build'
$out   = Join-Path $root 'DSH-Pet-Windows'
$csc   = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

$payload = Join-Path $build 'payload.tar.zst'
if (Test-Path $payload) { Remove-Item $payload -Force }
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
$sw = [Diagnostics.Stopwatch]::StartNew()
Push-Location $out
& $tarExe --zstd --options "zstd:compression-level=19" -cf $payload . 2>&1 | Out-Null
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "tar payload failed: $LASTEXITCODE" }
$sw.Stop()
Write-Host ("payload.tar.zst: {0:N1} MB ({1:N0}s)" -f ((Get-Item $payload).Length / 1MB), $sw.Elapsed.TotalSeconds)

$res1 = "/resource:$payload,DSH-Pet-Payload.tar.zst"
$res2 = "/resource:$build\Uninstall.exe,DSH-Pet-Uninstall.exe"
$setupExe = Join-Path $root 'DSH-Pet-Setup.exe'
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /win32icon:"$build\app.ico" `
  /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  $res1 $res2 /out:"$setupExe" (Join-Path $build 'setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'setup csc failed' }
Write-Host ("setup: {0:N1} MB" -f ((Get-Item $setupExe).Length / 1MB))
Write-Host 'REBUILD-DONE'
