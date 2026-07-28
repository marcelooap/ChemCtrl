$ErrorActionPreference = "Stop"
$root = "c:\Users\mamaral\Documents\ChemCtrl"
$dst = "$root\src\modules\chemflow"

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

Write-Host "== Rewrite modules/chemflow imports =="
Rewrite-Files -Path $dst -Transform {
  param($c)

  # Base44 facade -> ChemFlow entities service
  $c = $c -replace "import \{ base44 \} from ['""]@/api/base44Client['""];?", "import { entities } from '@chemflow/services/entities';"
  $c = $c -replace "base44\.entities\.", "entities."

  # Legacy local auth -> platform auth (shared session, no second login)
  $c = $c -replace "import \{ useAuth \} from ['""]@/hooks/useAuth['""];?", "import { useInternalAuth as useAuth } from '@/lib/InternalAuthContext';"

  # Shared UI / utils / hooks
  $c = $c -replace "@/lib/utils", "@shared/lib/utils"
  $c = $c -replace "@/components/ui/", "@shared/components/ui/"
  $c = $c -replace "@/hooks/use-mobile", "@shared/hooks/use-mobile"

  # ChemFlow-owned modules
  $c = $c -replace "@/lib/fifo", "@chemflow/lib/fifo"
  $c = $c -replace "@/lib/conversao", "@chemflow/lib/conversao"
  $c = $c -replace "@/lib/clipboard", "@chemflow/lib/clipboard"
  $c = $c -replace "@/components/", "@chemflow/components/"
  $c = $c -replace "@/pages/", "@chemflow/pages/"
  $c = $c -replace "@/layouts/", "@chemflow/layouts/"

  return $c
}

Write-Host "== DONE =="
