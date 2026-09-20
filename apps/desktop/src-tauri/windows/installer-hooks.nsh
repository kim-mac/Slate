!define AI_CLIP_MEMORY_HOST_NAME "com.aiclipmemory.bridge"
!define AI_CLIP_MEMORY_MANIFEST_FILE "${AI_CLIP_MEMORY_HOST_NAME}.json"
!define AI_CLIP_MEMORY_HOOK_DIR "${__FILEDIR__}"
!define AI_CLIP_MEMORY_CHROME_KEY "Software\Google\Chrome\NativeMessagingHosts\com.aiclipmemory.bridge"
!define AI_CLIP_MEMORY_EDGE_KEY "Software\Microsoft\Edge\NativeMessagingHosts\com.aiclipmemory.bridge"

!macro AI_CLIP_MEMORY_REMOVE_OWNED_REGISTRATION REGISTRY_KEY
  ReadRegStr $0 HKCU "${REGISTRY_KEY}" ""
  StrCmp $0 "$INSTDIR\${AI_CLIP_MEMORY_MANIFEST_FILE}" 0 +2
  DeleteRegKey HKCU "${REGISTRY_KEY}"
!macroend

; Tauri creates the product-name shortcut before POSTINSTALL. Prevent it from
; overwriting an unrelated shortcut with the same name on a normal install.
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$SMPROGRAMS\Slate.lnk"
    !insertmacro IsShortcutTarget "$SMPROGRAMS\Slate.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R6
    ${If} $R6 != 1
      Abort "An unrelated Slate Start Menu shortcut already exists."
    ${EndIf}
  ${EndIf}
  ${If} $NoShortcutMode != 1
  ${AndIf} $UpdateMode != 1
    ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $R5
      ${If} $R5 != 1
        Abort "An unrelated AI Clip Memory Start Menu shortcut already exists."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Rename only our own shortcut. Reinstalling the same version can create the
  ; old name again, so remove it when an owned Slate shortcut already exists.
  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $R5
  ${If} $R5 = 1
    ${If} ${FileExists} "$SMPROGRAMS\Slate.lnk"
      !insertmacro IsShortcutTarget "$SMPROGRAMS\Slate.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $R6
      ${If} $R6 != 1
        Abort "An unrelated Slate Start Menu shortcut already exists."
      ${EndIf}
      ClearErrors
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      IfErrors 0 +2
        Abort "Could not remove the old Start Menu shortcut."
    ${Else}
      ClearErrors
      Rename "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\Slate.lnk"
      IfErrors 0 +2
        Abort "Could not rename the Start Menu shortcut to Slate."
    ${EndIf}
  ${EndIf}
  !insertmacro IsShortcutTarget "$SMPROGRAMS\Slate.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $R6
  ${If} $R6 = 1
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Slate.lnk"
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /a "/oname=${AI_CLIP_MEMORY_MANIFEST_FILE}" "${AI_CLIP_MEMORY_HOOK_DIR}\generated\${AI_CLIP_MEMORY_MANIFEST_FILE}"
  WriteRegStr HKCU "${AI_CLIP_MEMORY_CHROME_KEY}" "" "$INSTDIR\${AI_CLIP_MEMORY_MANIFEST_FILE}"
  WriteRegStr HKCU "${AI_CLIP_MEMORY_EDGE_KEY}" "" "$INSTDIR\${AI_CLIP_MEMORY_MANIFEST_FILE}"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AI_CLIP_MEMORY_REMOVE_OWNED_REGISTRATION "${AI_CLIP_MEMORY_CHROME_KEY}"
  !insertmacro AI_CLIP_MEMORY_REMOVE_OWNED_REGISTRATION "${AI_CLIP_MEMORY_EDGE_KEY}"
  Delete "$INSTDIR\${AI_CLIP_MEMORY_MANIFEST_FILE}"
!macroend

; Run after Tauri's successful uninstall path. An update must keep the public
; shortcut so the next installer can reuse it without changing the AUMID.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro IsShortcutTarget "$SMPROGRAMS\Slate.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R5
    ${If} $R5 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\Slate.lnk"
      Delete "$SMPROGRAMS\Slate.lnk"
    ${EndIf}
  ${EndIf}
!macroend
