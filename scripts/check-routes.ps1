$root = "c:\Users\mamaral\Documents\ChemCtrl\src\modules\chemblend"
$pattern = "(navigate\(['""`]/(?!chemblend)|to=[{'""]/(?!chemblend)|to=\{`/(?!chemblend)|window\.location\.href = ['""]/(?!chemblend|login))"
Get-ChildItem $root -Recurse -Include *.jsx,*.tsx,*.js,*.ts | Select-String -Pattern $pattern | ForEach-Object {
  "$($_.Path):$($_.LineNumber): $($_.Line.Trim())"
}
