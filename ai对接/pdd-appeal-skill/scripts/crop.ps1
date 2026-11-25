# crop.ps1 — 裁剪 + 放大截图，供模型读表格文字。
# 为什么不用 MCP 的 clip 参数：clip 的坐标是视口 CSS 像素，截图 PNG 是设备像素，
# 两者有缩放比，换算容易错位。整页 PNG 一旦落盘，宽高就是确定的像素坐标系，
# 在它上面裁剪不会错。放大 2~3 倍后 view_image 的识别准确率明显更高。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File crop.ps1 -In shot.png -Out part.png -X 1400 -Y 80 -W 400 -H 300 -Scale 3
param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][int]$W,
  [Parameter(Mandatory=$true)][int]$H,
  [double]$Scale = 2
)

Add-Type -AssemblyName System.Drawing

if (!(Test-Path $In)) { throw "输入图不存在: $In" }

$src = [System.Drawing.Image]::FromFile((Resolve-Path $In).Path)
try {
  $x0 = [Math]::Max(0, [Math]::Min($X, $src.Width - 1))
  $y0 = [Math]::Max(0, [Math]::Min($Y, $src.Height - 1))
  $w  = [Math]::Max(1, [Math]::Min($W, $src.Width - $x0))
  $h  = [Math]::Max(1, [Math]::Min($H, $src.Height - $y0))

  $tw = [int][Math]::Round($w * $Scale)
  $th = [int][Math]::Round($h * $Scale)

  $bmp = New-Object System.Drawing.Bitmap($tw, $th)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $tw, $th)), (New-Object System.Drawing.Rectangle($x0, $y0, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }

  $dir = Split-Path -Parent $Out
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  "SRC=$($src.Width)x$($src.Height) CROP=$x0,$y0,${w}x${h} SCALE=$Scale OUT=$Out ($tw x $th)"
} finally { $src.Dispose() }
