# Draws the app icon (a comic page with slanted panels and a sketch line) at the sizes iOS and the manifest need.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function P([double]$x, [double]$y, [double]$k) { New-Object System.Drawing.PointF ([single]($x * $k)), ([single]($y * $k)) }

foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(255, 30, 32, 40))
  $k = $size / 100.0

  $g.FillRectangle([System.Drawing.Brushes]::White, [single](19 * $k), [single](11 * $k), [single](62 * $k), [single](78 * $k))

  $ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 17, 17, 17)), ([single](2.6 * $k))
  $ink.LineJoin = 'Miter'
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 120, 170, 255))
  $sky = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 220, 232, 252))

  $top = @((P 24 16 $k), (P 76 16 $k), (P 76 38 $k), (P 24 45 $k))
  $left = @((P 24 49 $k), (P 47 46 $k), (P 41 84 $k), (P 24 84 $k))
  $right = @((P 51 45.5 $k), (P 76 42 $k), (P 76 84 $k), (P 45 84 $k))
  $g.FillPolygon($blue, $top); $g.DrawPolygon($ink, $top)
  $g.FillPolygon($sky, $left); $g.DrawPolygon($ink, $left)
  $g.FillPolygon($sky, $right); $g.DrawPolygon($ink, $right)

  # a figure "popping out" of the top panel
  $pop = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 92, 120))
  $g.FillEllipse($pop, [single](56 * $k), [single](28 * $k), [single](16 * $k), [single](22 * $k))

  # loose sketch line
  $pencil = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 47, 111, 214)), ([single](2.2 * $k))
  $pencil.StartCap = 'Round'; $pencil.EndCap = 'Round'
  $g.DrawBezier($pencil, (P 28 72 $k), (P 32 58 $k), (P 38 78 $k), (P 39 60 $k))
  $g.DrawBezier($pencil, (P 52 76 $k), (P 58 60 $k), (P 66 80 $k), (P 72 58 $k))

  $bmp.Save((Join-Path $out "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Write-Output "icons written to $out"
