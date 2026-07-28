$ErrorActionPreference = "Stop"
$root = "c:\Users\mamaral\Documents\ChemCtrl"
$src = "$root\src"

Write-Host "== 1. Create target directories =="
$dirs = @(
  "$src\modules\chemblend",
  "$src\modules\chemflow",
  "$src\shared\components",
  "$src\shared\lib",
  "$src\shared\hooks",
  "$src\services\supabase",
  "$src\routes"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Write-Host "== 2. Move shared UI (components/ui -> shared/components/ui) =="
Move-Item "$src\components\ui" "$src\shared\components\ui"

Write-Host "== 3. Move shared utils.js =="
Move-Item "$src\lib\utils.js" "$src\shared\lib\utils.js"

Write-Host "== 4. Move shared hook use-mobile.jsx =="
Move-Item "$src\hooks\use-mobile.jsx" "$src\shared\hooks\use-mobile.jsx"

Write-Host "== 5. Pull platform-only pages out, bulk-move rest to modules/chemblend/pages =="
New-Item -ItemType Directory -Force -Path "$src\_tmp_pages" | Out-Null
Move-Item "$src\pages\Login.jsx" "$src\_tmp_pages\Login.jsx"
Move-Item "$src\pages\SystemSelector.jsx" "$src\_tmp_pages\SystemSelector.jsx"
Move-Item "$src\pages" "$src\modules\chemblend\pages"
New-Item -ItemType Directory -Force -Path "$src\pages" | Out-Null
Move-Item "$src\_tmp_pages\Login.jsx" "$src\pages\Login.jsx"
Move-Item "$src\_tmp_pages\SystemSelector.jsx" "$src\pages\SystemSelector.jsx"
Remove-Item "$src\_tmp_pages"

Write-Host "== 6. Pull platform-only components out, bulk-move rest to modules/chemblend/components =="
New-Item -ItemType Directory -Force -Path "$src\_tmp_components" | Out-Null
Move-Item "$src\components\ProtectedRoute.jsx" "$src\_tmp_components\ProtectedRoute.jsx"
Move-Item "$src\components\ScrollToTop.jsx" "$src\_tmp_components\ScrollToTop.jsx"
Move-Item "$src\components" "$src\modules\chemblend\components"
New-Item -ItemType Directory -Force -Path "$src\components" | Out-Null
Move-Item "$src\_tmp_components\ProtectedRoute.jsx" "$src\components\ProtectedRoute.jsx"
Move-Item "$src\_tmp_components\ScrollToTop.jsx" "$src\components\ScrollToTop.jsx"
Remove-Item "$src\_tmp_components"

Write-Host "== 7. Pull platform-only lib files out, bulk-move rest to modules/chemblend/lib =="
New-Item -ItemType Directory -Force -Path "$src\_tmp_lib" | Out-Null
Move-Item "$src\lib\InternalAuthContext.jsx" "$src\_tmp_lib\InternalAuthContext.jsx"
Move-Item "$src\lib\PageNotFound.jsx" "$src\_tmp_lib\PageNotFound.jsx"
Move-Item "$src\lib\query-client.js" "$src\_tmp_lib\query-client.js"
Move-Item "$src\lib\theme" "$src\_tmp_lib\theme"
Move-Item "$src\lib" "$src\modules\chemblend\lib"
New-Item -ItemType Directory -Force -Path "$src\lib" | Out-Null
Move-Item "$src\_tmp_lib\InternalAuthContext.jsx" "$src\lib\InternalAuthContext.jsx"
Move-Item "$src\_tmp_lib\PageNotFound.jsx" "$src\lib\PageNotFound.jsx"
Move-Item "$src\_tmp_lib\query-client.js" "$src\lib\query-client.js"
Move-Item "$src\_tmp_lib\theme" "$src\lib\theme"
Remove-Item "$src\_tmp_lib"

Write-Host "== 8. Move remaining hooks -> modules/chemblend/hooks =="
Move-Item "$src\hooks" "$src\modules\chemblend\hooks"

Write-Host "== 9. Move sql -> modules/chemblend/sql =="
Move-Item "$src\sql" "$src\modules\chemblend\sql"

Write-Host "== DONE MOVE STEP 1 =="
