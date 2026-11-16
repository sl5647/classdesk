param([string]$Pdf, [string]$OutDir, [int]$Width = 1600)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$exts = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = ($exts | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAct = ($exts | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]

function AwaitOp($op, $type) {
  $m = $asTaskOp.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  return $t.Result
}
function AwaitAct($act) {
  $t = $asTaskAct.Invoke($null, @($act))
  $t.Wait(-1) | Out-Null
}

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
$doc = AwaitOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
Write-Output ("pages=" + $doc.PageCount)

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$base = [System.IO.Path]::GetFileNameWithoutExtension($Pdf)

for ($i = 0; $i -lt $doc.PageCount; $i++) {
  $page = $doc.GetPage($i)
  $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
  $opts = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
  $opts.DestinationWidth = [uint32]$Width
  AwaitAct ($page.RenderToStreamAsync($stream, $opts))
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $out = Join-Path $OutDir ($base + "_" + ($i + 1).ToString("00") + ".png")
  $fs = [System.IO.File]::Create($out)
  $net.CopyTo($fs)
  $fs.Close(); $net.Close(); $stream.Dispose(); $page.Dispose()
  Write-Output ("saved " + $out)
}
