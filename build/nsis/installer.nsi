; LootyPanel NSIS Installer Script
; Creates a professional Windows installer

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; General
Name "LootyPanel"
OutFile "LootyPanel-Setup.exe"
InstallDir "$PROGRAMFILES\LootyPanel"
InstallDirRegKey HKCU "Software\LootyPanel" ""
RequestExecutionLevel admin

; Version Info
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "LootyPanel"
VIAddVersionKey "FileDescription" "Minecraft Server Management Panel"
VIAddVersionKey "FileVersion" "1.0.0"
VIAddVersionKey "ProductVersion" "1.0.0"
VIAddVersionKey "CompanyName" "LootyPanel"
VIAddVersionKey "LegalCopyright" "MIT License"

; Interface Settings
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Header\win.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\win.bmp"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
Page custom ServiceOptionsPage ServiceOptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; Languages
!insertmacro MUI_LANGUAGE "English"

; Variables
Var InstallService
Var StartMenuFolder
Var ServiceDialog
Var ServiceCheckbox

; Custom Page for Service Options
Function ServiceOptionsPage
    !insertmacro MUI_HEADER_TEXT "Service Options" "Configure Windows Service settings"
    
    nsDialogs::Create 1018
    Pop $ServiceDialog
    
    ${If} $ServiceDialog == error
        Abort
    ${EndIf}
    
    ${NSD_CreateLabel} 0 0 100% 80u "Would you like to install LootyPanel as a Windows Service?$\n$\nInstalling as a service allows LootyPanel to:$\n$\n- Start automatically when Windows boots$\n- Run in the background without a user logged in$\n- Continue running after closing the browser"
    
    ${NSD_CreateCheckbox} 0 90u 100% 12u "Install LootyPanel as a Windows Service (recommended for servers)"
    Pop $ServiceCheckbox
    ${NSD_Check} $ServiceCheckbox
    StrCpy $InstallService 1
    
    nsDialogs::Show
FunctionEnd

Function ServiceOptionsLeave
    ${NSD_GetState} $ServiceCheckbox $InstallService
FunctionEnd

; Installer Sections
Section "LootyPanel" SecMain
    SetOutPath "$INSTDIR"
    
    ; Create directories
    CreateDirectory "$INSTDIR\app"
    CreateDirectory "$INSTDIR\node"
    CreateDirectory "$INSTDIR\data"
    CreateDirectory "$INSTDIR\daemon"
    
    ; Copy application files
    SetOutPath "$INSTDIR\app"
    File /r "source\app\*.*"
    
    ; Copy launcher files
    SetOutPath "$INSTDIR"
    File "source\launcher.js"
    File "source\LootyPanel.bat"
    
    ; Copy daemon files
    SetOutPath "$INSTDIR\daemon"
    File /r "source\daemon\*.*"
    
    ; Copy Node.js
    SetOutPath "$INSTDIR\node"
    File /r "source\node\*.*"
    
    ; Create shortcuts
    CreateDirectory "$SMPROGRAMS\LootyPanel"
    CreateShortcut "$SMPROGRAMS\LootyPanel\LootyPanel.lnk" "$INSTDIR\LootyPanel.bat"
    CreateShortcut "$SMPROGRAMS\LootyPanel\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortcut "$DESKTOP\LootyPanel.lnk" "$INSTDIR\LootyPanel.bat"
    
    ; Write registry
    WriteRegStr HKCU "Software\LootyPanel" "" $INSTDIR
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
    ; Install service if selected
    ${If} $InstallService == 1
        DetailPrint "Installing Windows Service..."
        ExecWait '"$INSTDIR\app\node_modules\.bin\node-windows.cmd" install' $0
        ${If} $0 == 0
            DetailPrint "Service installed successfully"
            ; Start the service
            nsExec::Exec 'sc start LootyPanel'
        ${Else}
            DetailPrint "Service installation may require manual configuration"
        ${EndIf}
    ${EndIf}
    
    ; Create first-run marker
    FileOpen $0 "$INSTDIR\.first-run" w
    FileWrite $0 "Remove this file to trigger first-run setup again"
    FileClose $0
SectionEnd

Section "Desktop Shortcut" SecDesktop
    CreateShortcut "$DESKTOP\LootyPanel.lnk" "$INSTDIR\launcher.exe"
SectionEnd

; Uninstaller
Section "Uninstall"
    ; Stop and remove service
    nsExec::Exec 'sc stop LootyPanel'
    Sleep 2000
    nsExec::Exec 'sc delete LootyPanel'
    
    ; Remove shortcuts
    Delete "$DESKTOP\LootyPanel.lnk"
    Delete "$SMPROGRAMS\LootyPanel\LootyPanel.lnk"
    Delete "$SMPROGRAMS\LootyPanel\Uninstall.lnk"
    RMDir "$SMPROGRAMS\LootyPanel"
    
    ; Remove installed files (keep data directory)
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\node"
    RMDir /r "$INSTDIR\daemon"
    Delete "$INSTDIR\launcher.js"
    Delete "$INSTDIR\LootyPanel.bat"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\.first-run"
    
    ; Ask to remove data
    MessageBox MB_YESNO "Would you like to remove all server data and backups?$\n$\nLocation: $INSTDIR\data" IDNO SkipDataRemoval
    RMDir /r "$INSTDIR\data"
    SkipDataRemoval:
    
    ; Remove registry
    DeleteRegKey HKCU "Software\LootyPanel"
    
    ; Remove install directory if empty
    RMDir "$INSTDIR"
SectionEnd

; Section descriptions
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Install LootyPanel core files and dependencies"
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Create a shortcut on the desktop"
!insertmacro MUI_FUNCTION_DESCRIPTION_END
