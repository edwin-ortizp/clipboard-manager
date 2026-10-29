; Compatibility layer for the public rename. Override CM_* only in isolated tests.
!define /ifndef CM_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clipia"
!define /ifndef CM_LOCATIONKEY "Software\clipia\Clipia"
!define /ifndef CM_OTHERKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clipboard Manager"
!define /ifndef CM_RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define /ifndef CM_APPROVEDKEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define /ifndef CM_STARTROOT "$SMPROGRAMS"
!define /ifndef CM_DESKTOPROOT "$DESKTOP"

!macro NSIS_HOOK_PREINSTALL
  Call CMPreInstall
!macroend
!macro NSIS_HOOK_POSTINSTALL
  Call CMPostInstall
!macroend

!macro CM_ABORT message
  IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "${message}"
  SetErrorLevel 42
  Abort
!macroend

!macro CM_REMOVE_OLD_SHORTCUT shortcut replacement
  !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\clipia.exe"
  Pop $R9
  ${If} $R9 = 1
    CreateShortcut "${replacement}" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "${replacement}"
    Delete "${shortcut}"
  ${Else}
    !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R9
    ${If} $R9 = 1
      CreateShortcut "${replacement}" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "${replacement}"
      Delete "${shortcut}"
    ${EndIf}
  ${EndIf}
!macroend

!macro CM_CHECK_NEW_SHORTCUT shortcut
  ${If} ${FileExists} "${shortcut}"
    !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R9
    ${If} $R9 != 1
      !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\clipia.exe"
      Pop $R9
      ${If} $R9 != 1
        !insertmacro CM_ABORT "Ya existe un acceso directo de otra instalación de Clipboard Manager. No se modificó."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro CM_DEFINE_MIGRATION
Var CMOldPath
Var CMOldRun
Var CMRunEnabled
Var CMApproved
Var CMPreviousName

; Preserve the actual REG_BINARY state (including a Task Manager disabled flag).
Function CMReadApproval
  Pop $5
  StrCpy $CMApproved ""
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001,w "${CM_APPROVEDKEY}",i 0,i 0x101,*p .r0)i.r1'
  ${If} $1 = 0
    System::Alloc 12
    Pop $2
    StrCpy $3 12
    System::Call 'advapi32::RegQueryValueExW(p r0,w r5,p 0,*i .r4,p r2,*i r3)i.r1'
    ${If} $1 = 0
    ${AndIf} $4 = 3
    ${AndIf} $3 = 12
      StrCpy $6 0
      cm_read_approval_loop:
        IntOp $7 $2 + $6
        System::Call '*$7(&i1 .r8)'
        IntFmt $8 "%02X" $8
        StrCpy $CMApproved "$CMApproved$8"
        IntOp $6 $6 + 1
        IntCmp $6 12 cm_read_approval_done cm_read_approval_loop cm_read_approval_done
      cm_read_approval_done:
    ${EndIf}
    System::Free $2
    System::Call 'advapi32::RegCloseKey(p r0)'
  ${EndIf}
FunctionEnd

Function CMWriteApproval
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001,w "${CM_APPROVEDKEY}",i 0,i 0x102,*p .r0)i.r1'
  ${If} $1 = 0
    System::Alloc 12
    Pop $2
    StrCpy $6 0
    cm_write_approval_loop:
      IntOp $7 $6 * 2
      StrCpy $8 $CMApproved 2 $7
      IntOp $8 "0x$8" + 0
      IntOp $7 $2 + $6
      System::Call '*$7(&i1 r8)'
      IntOp $6 $6 + 1
      IntCmp $6 12 cm_write_approval_done cm_write_approval_loop cm_write_approval_done
    cm_write_approval_done:
    System::Call 'advapi32::RegSetValueExW(p r0,w "Clipboard Manager",i 0,i 3,p r2,i 12)i.r1'
    System::Free $2
    System::Call 'advapi32::RegCloseKey(p r0)'
  ${EndIf}
FunctionEnd

Function CMValidateRegistry
  StrCpy $CMOldPath ""
  StrCpy $CMOldRun ""
  StrCpy $CMRunEnabled 0
  StrCpy $CMApproved ""
  ReadRegStr $R0 SHCTX "${CM_OTHERKEY}" "UninstallString"
  ${If} $R0 != ""
    !insertmacro CM_ABORT "Se detectó otra instalación de Clipboard Manager. Resuelve el conflicto antes de continuar."
  ${EndIf}
  ReadRegStr $CMPreviousName SHCTX "${CM_UNINSTKEY}" "DisplayName"
  ${If} $CMPreviousName != ""
    ${If} $CMPreviousName != "Clipia"
    ${AndIf} $CMPreviousName != "Clipboard Manager"
      !insertmacro CM_ABORT "El registro anterior pertenece a otra aplicación. No se modificó."
    ${EndIf}
    ReadRegStr $R0 SHCTX "${CM_UNINSTKEY}" "Publisher"
    ${If} $R0 != "clipia"
    ${AndIf} $R0 != "Clipboard Manager"
      !insertmacro CM_ABORT "No se pudo verificar la instalación anterior. No se modificó."
    ${EndIf}
    ReadRegStr $R0 SHCTX "${CM_UNINSTKEY}" "MainBinaryName"
    ${If} $R0 != "clipia.exe"
    ${AndIf} $R0 != "${MAINBINARYNAME}.exe"
      !insertmacro CM_ABORT "El ejecutable de la instalación anterior no es compatible."
    ${EndIf}
    ReadRegStr $CMOldPath SHCTX "${CM_LOCATIONKEY}" ""
    ${If} $CMOldPath == ""
      !insertmacro CM_ABORT "Falta la ubicación de la instalación anterior. No se modificó."
    ${EndIf}
    ${IfNot} ${FileExists} "$CMOldPath\$R0"
      !insertmacro CM_ABORT "No se encuentra el ejecutable anterior. Revisa la instalación antes de continuar."
    ${EndIf}
    ; This is an in-place upgrade: never invoke the old uninstaller for the rename.
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Function CMValidateDirectory
  ${If} $CMOldPath != ""
  ${AndIf} $CMOldPath != $INSTDIR
    !insertmacro CM_ABORT "La actualización debe utilizar la carpeta de la instalación existente. No se modificó."
  ${EndIf}
  ReadRegStr $CMOldRun HKCU "${CM_RUNKEY}" "clipia"
  ${If} $CMOldRun == '$INSTDIR\clipia.exe --background'
  ${OrIf} $CMOldRun == '$\"$INSTDIR\clipia.exe$\" --background'
    StrCpy $CMRunEnabled 1
    Push "clipia"
    Call CMReadApproval
  ${Else}
    ; An unrelated entry with the legacy name must remain untouched.
    StrCpy $CMOldRun ""
  ${EndIf}
  ReadRegStr $R0 HKCU "${CM_RUNKEY}" "Clipboard Manager"
  ${If} $R0 != ""
    ${If} $R0 == '$INSTDIR\${MAINBINARYNAME}.exe --background'
    ${OrIf} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --background'
      StrCpy $CMRunEnabled 1
      Push "Clipboard Manager"
      Call CMReadApproval
    ${Else}
      !insertmacro CM_ABORT "El inicio automático de Clipboard Manager pertenece a otra instalación. No se modificó."
    ${EndIf}
  ${EndIf}
  !insertmacro CM_CHECK_NEW_SHORTCUT "${CM_DESKTOPROOT}\Clipboard Manager.lnk"
  !insertmacro CM_CHECK_NEW_SHORTCUT "${CM_STARTROOT}\Clipboard Manager.lnk"
  ${If} $AppStartMenuFolder != ""
    !insertmacro CM_CHECK_NEW_SHORTCUT "${CM_STARTROOT}\$AppStartMenuFolder\Clipboard Manager.lnk"
  ${EndIf}
FunctionEnd

Function CMPreInstall
  ; Revalidate after the directory page, before copying any files.
  Call CMValidateDirectory
  ${If} $CMOldPath != ""
  ${AndIf} ${FileExists} "$INSTDIR\clipia.exe"
    !insertmacro CheckIfAppIsRunning "$INSTDIR\clipia.exe" "Clipboard Manager"
  ${EndIf}
FunctionEnd

Function CMPostInstall
  !insertmacro CM_REMOVE_OLD_SHORTCUT "${CM_STARTROOT}\Clipia.lnk" "${CM_STARTROOT}\Clipboard Manager.lnk"
  !insertmacro CM_REMOVE_OLD_SHORTCUT "${CM_DESKTOPROOT}\Clipia.lnk" "${CM_DESKTOPROOT}\Clipboard Manager.lnk"
  ${If} $AppStartMenuFolder != ""
    !insertmacro CM_REMOVE_OLD_SHORTCUT "${CM_STARTROOT}\$AppStartMenuFolder\Clipia.lnk" "${CM_STARTROOT}\$AppStartMenuFolder\Clipboard Manager.lnk"
  ${EndIf}
  ${If} $CMRunEnabled = 1
    WriteRegStr HKCU "${CM_RUNKEY}" "Clipboard Manager" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --background'
    ${If} $CMApproved != ""
      Call CMWriteApproval
    ${EndIf}
  ${EndIf}
  ${If} $CMOldRun != ""
    ReadRegStr $R0 HKCU "${CM_RUNKEY}" "clipia"
    ${If} $R0 == $CMOldRun
      DeleteRegValue HKCU "${CM_RUNKEY}" "clipia"
      DeleteRegValue HKCU "${CM_APPROVEDKEY}" "clipia"
    ${EndIf}
  ${EndIf}
FunctionEnd
!macroend
