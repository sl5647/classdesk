param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [ValidateSet('word', 'excel', 'ppt')][string]$Kind = 'word'
)
$ErrorActionPreference = 'Stop'

# 记录本次运行前已有的 Office 进程，结束后只清理本次新建的，绝不碰用户手动打开的
$procName = @{ word = 'WINWORD'; excel = 'EXCEL'; ppt = 'POWERPNT' }[$Kind]
function Get-Pids { @(Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) }
$before = Get-Pids

$app = $null
$doc = $null
$okOut = $false
$msg = ''
try {
  switch ($Kind) {
    'word' {
      $app = New-Object -ComObject Word.Application
      $app.Visible = $false
      $app.DisplayAlerts = 0
      $doc = $app.Documents.Open($In, $false, $true)
      $doc.ExportAsFixedFormat($Out, 17)   # wdExportFormatPDF
    }
    'excel' {
      $app = New-Object -ComObject Excel.Application
      $app.Visible = $false
      $app.DisplayAlerts = $false
      $doc = $app.Workbooks.Open($In, 0, $true)
      $doc.ExportAsFixedFormat(0, $Out)    # xlTypePDF
    }
    'ppt' {
      $app = New-Object -ComObject PowerPoint.Application
      $doc = $app.Presentations.Open($In, $true, $false, $true)    # 第4个参数必须 true，false 会报 0x80070003
      $doc.SaveAs($Out, 32)                # ppSaveAsPDF
    }
  }
  if (-not (Test-Path $Out)) { throw "导出失败：没有生成输出文件" }
  $okOut = $true
  $msg = "ok " + (Get-Item $Out).Length
}
catch {
  $msg = "FAIL " + $_.Exception.Message
}

# 产物已落盘。不调用 $app.Quit()——这台机器上 Quit 会卡住；改用 Close + 只结束本次新建的进程
try { if ($doc) { $doc.Close(0) } } catch {}
try { if ($app) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) } } catch {}
Write-Output $msg

Start-Sleep -Milliseconds 120
$after = Get-Pids
foreach ($p in $after) {
  if ($before -notcontains $p) { try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {} }
}
[Environment]::Exit(0)
