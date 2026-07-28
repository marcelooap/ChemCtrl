$ErrorActionPreference = "Stop"
$root = "c:\Users\mamaral\Documents\ChemCtrl"
$srcCF = "$root\CHEMFLOW\src"
$dst = "$root\src\modules\chemflow"

function CopyDir($from, $to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item -Path "$from\*" -Destination $to -Recurse -Force
}

# pages (all except Placeholder stays too, it's used for /chemflow/dashboard)
CopyDir "$srcCF\pages" "$dst\pages"

# components — copy everything, then remove Base44/auth-only/duplicate-ui pieces
CopyDir "$srcCF\components" "$dst\components"
Remove-Item -Recurse -Force "$dst\components\ui"
Remove-Item -Force "$dst\components\ScrollToTop.jsx"
Remove-Item -Force "$dst\components\ProtectedRoute.jsx"
Remove-Item -Force "$dst\components\AuthLayout.jsx"
Remove-Item -Force "$dst\components\GoogleIcon.jsx"
Remove-Item -Force "$dst\components\UserNotRegisteredError.jsx"

# layouts
CopyDir "$srcCF\layouts" "$dst\layouts"

# lib — only the non-Base44, non-duplicate utility files
New-Item -ItemType Directory -Force -Path "$dst\lib" | Out-Null
Copy-Item "$srcCF\lib\fifo.js" "$dst\lib\fifo.js"
Copy-Item "$srcCF\lib\conversao.js" "$dst\lib\conversao.js"
Copy-Item "$srcCF\lib\clipboard.js" "$dst\lib\clipboard.js"

Write-Host "== ChemFlow source copied =="
