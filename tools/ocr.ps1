param([string]$Image, [string]$Out = '', [switch]$Json, [int]$Scale = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$exts = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = ($exts | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function AwaitOp($op, $type) {
  $m = $asTaskOp.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  return $t.Result
}

$lang = New-Object Windows.Globalization.Language 'zh-Hans-CN'
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) { Write-Output 'ERR no zh engine'; exit 2 }

# 预处理：放大 2 倍 + 灰度，能明显提升小字/表格的识别率
$tmpImg = $Image
try {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile($Image)
  $scale = if ($Scale -gt 0) { $Scale } elseif ($src.Width -lt 1200) { 3 } else { 2 }
  $w = [int]($src.Width * $scale); $h = [int]($src.Height * $scale)
  $bmp2 = New-Object System.Drawing.Bitmap($w, $h)
  $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($src, 0, 0, $w, $h)
  $g2.Dispose()
  $tmpImg = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ([guid]::NewGuid().ToString('N') + '.png'))
  $bmp2.Save($tmpImg, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp2.Dispose(); $src.Dispose()
} catch { $tmpImg = $Image }

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpImg)) ([Windows.Storage.StorageFile])
$stream = AwaitOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = AwaitOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = AwaitOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = AwaitOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$sb = New-Object System.Text.StringBuilder
if ($Json) {
  foreach ($line in $result.Lines) {
    foreach ($w in $line.Words) {
      $r = $w.BoundingRect
      $t = ($w.Text -replace "[\t\r\n]", ' ')
      [void]$sb.Append($t + "`t" + [int]$r.X + "`t" + [int]$r.Y + "`t" + [int]$r.Width + "`t" + [int]$r.Height + "`n")
    }
  }
} else {
  foreach ($line in $result.Lines) {
    [void]$sb.Append($line.Text + "`n")
  }
}

if ($tmpImg -ne $Image) { try { Remove-Item $tmpImg -Force } catch {} }
$text = $sb.ToString()
if ($Out) { [System.IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding($false))) } else { Write-Output $text }
