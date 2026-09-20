param(
  [Parameter(Mandatory=$true)][string]$InputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile($InputPath)
$maxSide = 1400
$longSide = [double]([Math]::Max($source.Width, $source.Height))
$scale = [Math]::Min([double]1, [double]$maxSide / $longSide)
$width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
$height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
$bitmap = New-Object System.Drawing.Bitmap($width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.DrawImage($source, 0, 0, $width, $height)
$graphics.Dispose()
$source.Dispose()

$rectangle = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$bits = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
$byteCount = $bits.Stride * $bits.Height
$pixels = New-Object byte[] $byteCount
[System.Runtime.InteropServices.Marshal]::Copy($bits.Scan0, $pixels, 0, $byteCount)
$bitmap.UnlockBits($bits)

$stream = [Console]::OpenStandardOutput()
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([int32]$width)
$writer.Write([int32]$height)
$writer.Write($pixels)
$writer.Flush()
$writer.Dispose()
$bitmap.Dispose()
