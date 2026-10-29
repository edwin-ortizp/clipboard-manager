param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$package=Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$config=Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$cargoVersion=Select-String -LiteralPath src-tauri/Cargo.toml -Pattern '^version = "([^"]+)"' | Select-Object -First 1
if($package.version -ne $config.version -or $package.version -ne $cargoVersion.Matches[0].Groups[1].Value){throw 'Las versiones de package.json, Cargo.toml y tauri.conf.json deben coincidir'}
if(-not $SkipBuild){& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native.ps1 build;if($LASTEXITCODE -ne 0){throw 'Falló la compilación'}}
$version=$package.version
$name="Clipboard-Manager_${version}_x64-setup.exe"
$sourceName="$($config.productName)_${version}_x64-setup.exe"
$source=Join-Path $root "src-tauri\target\release\bundle\nsis\$sourceName"
$signature="$source.sig"
if(-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $signature)){throw 'Falta el instalador o su firma'}
$destination=Join-Path $root "artifacts\release\$version"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $destination $name)
Copy-Item -LiteralPath $signature -Destination (Join-Path $destination "$name.sig")
$notesPath=Join-Path $root 'CHANGELOG.md'
$notes="Clipboard Manager $version"
if(Test-Path -LiteralPath $notesPath){
    $changelog=[IO.File]::ReadAllText($notesPath)
    $notes=[regex]::Match($changelog,"(?ms)^# Clipboard Manager $([regex]::Escape($version))\r?\n.*?(?=^# |\z)").Value.Trim()
    if(-not $notes){throw "Faltan las notas de Clipboard Manager $version en CHANGELOG.md"}
}
$manifest=@{version=[string]$version;notes=[string]$notes;pub_date=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ');platforms=@{'windows-x86_64'=@{url="https://github.com/edwin-ortizp/clipboard-manager/releases/download/v$version/$name";signature=[IO.File]::ReadAllText($signature).Trim()}}}
[IO.File]::WriteAllText((Join-Path $destination 'latest.json'),($manifest | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Get-FileHash -LiteralPath $source -Algorithm SHA256 | Select-Object Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'sha256.json') -Encoding UTF8
Write-Output "Preparado en $destination. No se ha publicado ningún archivo."
