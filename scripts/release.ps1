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
$name="Clipia_${version}_x64-setup.exe"
$source=Join-Path $root "src-tauri\target\release\bundle\nsis\$name"
$signature="$source.sig"
if(-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $signature)){throw 'Falta el instalador o su firma'}
$destination=Join-Path $root "artifacts\release\$version"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $source,$signature -Destination $destination
$notesPath=Join-Path $root 'CHANGELOG.md'
$notes=if(Test-Path -LiteralPath $notesPath){[IO.File]::ReadAllText($notesPath)}else{"Clipia $version"}
$manifest=@{version=[string]$version;notes=[string]$notes;pub_date=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ');platforms=@{'windows-x86_64'=@{url="https://github.com/edwin-ortizp/clipia-releases/releases/download/v$version/$name";signature=[IO.File]::ReadAllText($signature).Trim()}}}
[IO.File]::WriteAllText((Join-Path $destination 'latest.json'),($manifest | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Get-FileHash -LiteralPath $source -Algorithm SHA256 | Select-Object Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'sha256.json') -Encoding UTF8
Write-Output "Preparado en $destination. No se ha publicado ningún archivo."
