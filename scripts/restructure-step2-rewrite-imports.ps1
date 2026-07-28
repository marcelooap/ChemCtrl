$ErrorActionPreference = "Stop"
$root = "c:\Users\mamaral\Documents\ChemCtrl"
$src = "$root\src"

function Rewrite-Files {
  param(
    [string]$Path,
    [scriptblock]$Transform
  )
  $files = Get-ChildItem -Path $Path -Recurse -Include *.js,*.jsx,*.ts,*.tsx -File
  foreach ($f in $files) {
    $content = Get-Content -Raw -LiteralPath $f.FullName -Encoding UTF8
    $new = & $Transform $content
    if ($new -ne $content) {
      [System.IO.File]::WriteAllText($f.FullName, $new, (New-Object System.Text.UTF8Encoding($false)))
    }
  }
}

Write-Host "== Rewrite shared/components/ui internal imports =="
Rewrite-Files -Path "$src\shared\components\ui" -Transform {
  param($c)
  $c = $c -replace "@/components/ui/", "./"
  $c = $c -replace "@/lib/utils", "@shared/lib/utils"
  $c = $c -replace "@/hooks/use-mobile", "@shared/hooks/use-mobile"
  return $c
}

Write-Host "== Rewrite modules/chemblend imports =="
Rewrite-Files -Path "$src\modules\chemblend" -Transform {
  param($c)
  # Most specific first
  $c = $c -replace "@/lib/utils", "@shared/lib/utils"
  $c = $c -replace "@/components/ui/", "@shared/components/ui/"
  $c = $c -replace "@/hooks/use-mobile", "@shared/hooks/use-mobile"
  # Remaining components/* (excluding ui, already handled) -> @chemblend/components/
  $c = $c -replace "@/components/(?!ui/)", "@chemblend/components/"
  # Remaining lib/* excluding platform-kept ones -> @chemblend/lib/
  $c = $c -replace "@/lib/(?!InternalAuthContext|theme/|PageNotFound|query-client)", "@chemblend/lib/"
  # Remaining hooks/* (use-mobile already handled) -> @chemblend/hooks/
  $c = $c -replace "@/hooks/", "@chemblend/hooks/"
  # pages/* excluding Login, SystemSelector -> @chemblend/pages/
  $c = $c -replace "@/pages/(?!Login|SystemSelector)", "@chemblend/pages/"
  return $c
}

Write-Host "== DONE REWRITE STEP 2 =="
