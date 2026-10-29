param([switch]$FullInstaller)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$id=[Guid]::NewGuid().ToString('N')
$namespace="Software\ClipboardManagerVerification\$id"
$fixtures=Join-Path $root ".tools\brand-migration-$id"
New-Item -ItemType Directory -Path $fixtures -Force | Out-Null
$shell=New-Object -ComObject WScript.Shell
function Assert($condition,$message){if(-not $condition){throw $message}}
function Shortcut($path,$target){$link=$shell.CreateShortcut($path);$link.TargetPath=$target;$link.Save()}
$nsis=Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'
$include=Join-Path $root 'src-tauri\installer\brand-migration.nsh'
$utils=Join-Path $root 'src-tauri\target\release\nsis\x64\utils.nsh'
try {
  foreach($scenario in @('enabled','disabled','taskmanager-disabled','foreign-legacy','registry-conflict','shortcut-conflict','startup-conflict')){
    $dir=Join-Path $fixtures $scenario
    New-Item -ItemType Directory -Path $dir,"$dir\start","$dir\desktop","$dir\media" -Force | Out-Null
    [IO.File]::WriteAllText("$dir\clipia.exe",'old fixture binary')
    [IO.File]::WriteAllText("$dir\clipia.sqlite3",'history favorites prompts provider dictionary preferences sentinel')
    [IO.File]::WriteAllText("$dir\media\image.png",'image sentinel')
    $before=(Get-FileHash -LiteralPath "$dir\clipia.sqlite3").Hash
    $key="$namespace\$scenario"
    $reg=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$key\uninstall")
    $reg.SetValue('DisplayName','Clipia');$reg.SetValue('Publisher','clipia');$reg.SetValue('MainBinaryName','clipia.exe');$reg.Close()
    $reg=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$key\location");$reg.SetValue('',$dir);$reg.Close()
    $run=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$key\run")
    $approval=[byte[]](3,0,0,0,12,34,56,78,90,123,222,255)
    if($scenario -in @('enabled','taskmanager-disabled')){
      $run.SetValue('clipia',"$dir\clipia.exe --background")
      if($scenario -eq 'enabled'){$approval[0]=2}
      $reg=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$key\approved");$reg.SetValue('clipia',$approval,[Microsoft.Win32.RegistryValueKind]::Binary);$reg.Close()
    }
    if($scenario -eq 'foreign-legacy'){$run.SetValue('clipia','C:\foreign\clipia.exe --background')}
    if($scenario -eq 'startup-conflict'){$run.SetValue('Clipboard Manager','C:\foreign\clipboard-manager.exe --background')}
    $run.Close()
    Shortcut "$dir\start\Clipia.lnk" "$dir\clipia.exe"
    Shortcut "$dir\desktop\Clipia.lnk" 'C:\foreign\clipia.exe'
    if($scenario -eq 'shortcut-conflict'){Shortcut "$dir\desktop\Clipboard Manager.lnk" 'C:\foreign\other.exe'}
    if($scenario -eq 'registry-conflict'){$reg=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$key\other");$reg.SetValue('UninstallString','foreign');$reg.Close()}
    $source=@'
Unicode true
!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!addplugindir "@PLUGINS@"
!include "@UTILS@"
!define CM_UNINSTKEY "@KEY@\uninstall"
!define CM_LOCATIONKEY "@KEY@\location"
!define CM_OTHERKEY "@KEY@\other"
!define CM_RUNKEY "@KEY@\run"
!define CM_APPROVEDKEY "@KEY@\approved"
!define CM_STARTROOT "$INSTDIR\start"
!define CM_DESKTOPROOT "$INSTDIR\desktop"
!define MAINBINARYNAME "clipboard-manager"
!define BUNDLEID "local.clipia.verification"
!include "@INCLUDE@"
Name "Isolated brand migration verification"
OutFile "@DIR@\fixture.exe"
RequestExecutionLevel user
SilentInstall silent
Var UpdateMode
Var PassiveMode
Var AppStartMenuFolder
!insertmacro CM_DEFINE_MIGRATION
!insertmacro MUI_LANGUAGE "English"
LangString appRunning ${LANG_ENGLISH} "Application running"
LangString appRunningOkKill ${LANG_ENGLISH} "Close application"
LangString failedToKillApp ${LANG_ENGLISH} "Unable to close application"
Function .onInit
  SetRegView 64
  SetShellVarContext current
  StrCpy $INSTDIR "@DIR@"
  Call CMValidateRegistry
  Call CMValidateDirectory
FunctionEnd
Section
  Call CMPreInstall
  FileOpen $9 "$INSTDIR\clipboard-manager.exe" w
  FileWrite $9 "new fixture binary"
  FileClose $9
  WriteRegStr HKCU "${CM_UNINSTKEY}" "DisplayName" "Clipboard Manager"
  WriteRegStr HKCU "${CM_UNINSTKEY}" "Publisher" "Clipboard Manager"
  WriteRegStr HKCU "${CM_UNINSTKEY}" "MainBinaryName" "clipboard-manager.exe"
  Delete "$INSTDIR\clipia.exe"
  Call CMPostInstall
SectionEnd
'@
    $source=$source.Replace('@DIR@',$dir).Replace('@KEY@',$key).Replace('@INCLUDE@',$include).Replace('@UTILS@',$utils).Replace('@PLUGINS@',(Join-Path $env:LOCALAPPDATA 'tauri\NSIS\Plugins\x86-unicode\additional'))
    if($FullInstaller){
      # Exercise the generated distribution template, not only its migration functions.
      $defines=@"
!define CM_UNINSTKEY "$key\uninstall"
!define CM_LOCATIONKEY "$key\location"
!define CM_OTHERKEY "$key\other"
!define CM_RUNKEY "$key\run"
!define CM_APPROVEDKEY "$key\approved"
!define CM_STARTROOT "`$INSTDIR\start"
!define CM_DESKTOPROOT "`$INSTDIR\desktop"
"@
      $source=$defines+"`n"+[IO.File]::ReadAllText((Join-Path (Split-Path $utils) 'installer.nsi'))
      $source=$source.Replace('$SMPROGRAMS','$INSTDIR\start').Replace('$DESKTOP','$INSTDIR\desktop')
      $source=$source.Replace('!define OUTFILE "nsis-output.exe"',"!define OUTFILE `"$dir\fixture.exe`"")
      $source=$source.Replace('!include "utils.nsh"',"!include `"$utils`"")
      $source=$source.Replace('!include "FileAssociation.nsh"',"!include `"$(Join-Path (Split-Path $utils) 'FileAssociation.nsh')`"")
    }
    [IO.File]::WriteAllText("$dir\fixture.nsi",$source,[Text.UTF8Encoding]::new($false))
    & $nsis /V2 "$dir\fixture.nsi" *> "$dir\compile.log"
    if($LASTEXITCODE -ne 0){throw "NSIS compilation failed: $dir\compile.log"}
    $process=Start-Process -FilePath "$dir\fixture.exe" -ArgumentList @('/S',"/D=$dir") -WindowStyle Hidden -PassThru -Wait
    $conflict=$scenario -like '*conflict'
    Assert ($process.ExitCode -eq $(if($conflict){42}else{0})) "Unexpected exit $($process.ExitCode): $scenario"
    Assert ((Get-FileHash -LiteralPath "$dir\clipia.sqlite3").Hash -eq $before) "Data changed: $scenario"
    Assert ([IO.File]::ReadAllText("$dir\media\image.png") -eq 'image sentinel') 'Image changed'
    $reg=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$key\uninstall")
    Assert ($reg.GetValue('DisplayName') -eq $(if($conflict){'Clipia'}else{'Clipboard Manager'})) 'Wrong registration'
    $reg.Close()
    if($conflict){Assert (-not (Test-Path -LiteralPath "$dir\clipboard-manager.exe")) 'Conflict wrote a binary'}
    else {
      Assert (-not (Test-Path -LiteralPath "$dir\clipia.exe")) 'Old binary retained'
      Assert (-not (Test-Path -LiteralPath "$dir\start\Clipia.lnk")) 'Owned old shortcut retained'
      Assert (Test-Path -LiteralPath "$dir\desktop\Clipia.lnk") 'Foreign old shortcut deleted'
      Assert ($shell.CreateShortcut("$dir\start\Clipboard Manager.lnk").TargetPath -eq "$dir\clipboard-manager.exe") 'Wrong shortcut target'
      $run=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$key\run")
      if($scenario -in @('enabled','taskmanager-disabled')){
        Assert ($run.GetValue('Clipboard Manager') -eq "`"$dir\clipboard-manager.exe`" --background") 'Wrong startup command'
        Assert ($null -eq $run.GetValue('clipia')) 'Old startup retained'
        $reg=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$key\approved")
        Assert ([Convert]::ToBase64String($reg.GetValue('Clipboard Manager')) -eq [Convert]::ToBase64String($approval)) 'Startup approval changed'
        $reg.Close()
      } else {Assert ($null -eq $run.GetValue('Clipboard Manager')) 'Startup enabled unexpectedly'}
      if($scenario -eq 'foreign-legacy'){Assert ($run.GetValue('clipia') -eq 'C:\foreign\clipia.exe --background') 'Foreign startup changed'}
      $run.Close()
    }
    Write-Output "PASS $scenario"
  }
} finally {
  if($namespace -notmatch '^Software\\ClipboardManagerVerification\\[0-9a-f]{32}$'){throw 'Unsafe cleanup namespace'}
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($namespace,$false)
}
Write-Output "Fixtures retained in $fixtures. Personal installation untouched."
