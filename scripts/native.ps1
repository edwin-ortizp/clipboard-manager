param([Parameter(ValueFromRemainingArguments=$true)][string[]]$NativeArgs)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableSetup = Join-Path $projectRoot '.tools\msvc\setup_x64.bat'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $portableSetup) {
    $setup = $portableSetup
} elseif (Test-Path -LiteralPath $vswhere) {
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) { $setup = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat' }
}
if ($setup) {
    & cmd.exe /d /c "call `"$setup`" >nul && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
} elseif (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    throw 'Instala Visual Studio Build Tools con Desarrollo para el escritorio con C++ y Windows SDK. Consulta README.md.'
}
Set-Location -LiteralPath $projectRoot
if ($NativeArgs.Count -eq 0) { $NativeArgs = @('check') }
if ($NativeArgs[0] -in @('check','test','fmt','clippy','run')) {
    $cargoAction = $NativeArgs[0]
    $cargoTail = @($NativeArgs | Select-Object -Skip 1)
    & cargo $cargoAction --manifest-path src-tauri/Cargo.toml @cargoTail
} else {
    if ($NativeArgs[0] -eq 'build' -and -not $env:TAURI_SIGNING_PRIVATE_KEY) {
        $signingKey = Join-Path $env:LOCALAPPDATA 'Clipia\signing\updater.key'
        if (-not (Test-Path -LiteralPath $signingKey)) { throw 'Falta la clave de firma. Consulta RELEASES.md.' }
        $env:TAURI_SIGNING_PRIVATE_KEY = $signingKey
    }
    & npx.cmd tauri @NativeArgs
}
exit $LASTEXITCODE
