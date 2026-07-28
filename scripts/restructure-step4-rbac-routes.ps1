$ErrorActionPreference = "Stop"
$f = "c:\Users\mamaral\Documents\ChemCtrl\src\modules\chemblend\lib\rbac\permissionCatalog.js"
$c = Get-Content -Raw -LiteralPath $f -Encoding UTF8

# route: '/' -> route: '/chemblend'  (home)
$c = $c -replace "route: '/',", "route: '/chemblend',"
# route: '/xxx' -> route: '/chemblend/xxx' (skip the one already turned into '/chemblend',  above)
$c = $c -replace "route: '/(?!chemblend)([^']+)'", "route: '/chemblend/`$1'"
# routePrefixes: ['/xxx/'] -> routePrefixes: ['/chemblend/xxx/']
$c = $c -replace "routePrefixes: \['/(?!chemblend)([^']+)'\]", "routePrefixes: ['/chemblend/`$1']"

[System.IO.File]::WriteAllText($f, $c, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Done rewriting permissionCatalog.js routes"
