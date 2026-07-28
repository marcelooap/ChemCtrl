$root = "c:\Users\mamaral\Documents\ChemCtrl\src\modules\chemflow"
$pattern = "(navigate\(['""`]/(?!chemflow)|to=[{'""]/(?!chemflow)|to=\{`/(?!chemflow))"
Get-ChildItem $root -Recurse -Include *.jsx,*.tsx,*.js,*.ts | Select-String -Pattern $pattern | ForEach-Object {
  "$($_.Path):$($_.LineNumber): $($_.Line.Trim())"
}
