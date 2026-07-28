$ErrorActionPreference = "Stop"
$root = "c:\Users\mamaral\Documents\ChemCtrl"
$src = "$root\src"

function Rewrite-Files {
  param([string]$Path, [scriptblock]$Transform)
  $files = Get-ChildItem -Path $Path -Recurse -Include *.js,*.jsx,*.ts,*.tsx -File
  foreach ($f in $files) {
    $content = Get-Content -Raw -LiteralPath $f.FullName -Encoding UTF8
    $new = & $Transform $content
    if ($new -ne $content) {
      [System.IO.File]::WriteAllText($f.FullName, $new, (New-Object System.Text.UTF8Encoding($false)))
    }
  }
}

Write-Host "== Rewrite modules/chemblend (pass 2: api/ moved too) =="
Rewrite-Files -Path "$src\modules\chemblend" -Transform {
  param($c)
  $c = $c -replace "@/lib/(?!InternalAuthContext|theme/|PageNotFound|query-client)", "@chemblend/lib/"
  $c = $c -replace "@/api/", "@chemblend/api/"
  return $c
}

Write-Host "== DONE =="
