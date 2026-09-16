; MySafe 설치 스크립트 보강
;
; 업데이트 설치는 기존 설치 폴더를 통째로 지우고(RMDir /r $INSTDIR) 다시 만든다.
; 사용자가 볼트 파일(vault.mv)을 설치 폴더 안에 두었다면 그 과정에서 데이터가 사라진다.
; 그래서 설치 전에 볼트 파일을 대피시키고, 설치가 끝나면 제자리에 돌려놓는다.
; 대피본은 %APPDATA%\MySafe\backups 에도 한 부 남겨, 되돌리기가 실패해도 복구할 수 있게 한다.

!macro mysafeRescueDir OUTVAR
  StrCpy ${OUTVAR} "$LOCALAPPDATA\MySafe\vault-rescue"
!macroend

!macro customInit
  ; 이전 설치 폴더를 찾는다 ($INSTDIR가 아직 없으면 레지스트리에서 읽는다)
  StrCpy $R7 "$INSTDIR"
  ${If} $R7 == ""
    ReadRegStr $R7 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $R7 == ""
    ReadRegStr $R7 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}

  ${If} $R7 != ""
  ${AndIf} ${FileExists} "$R7\vault.mv"
    !insertmacro mysafeRescueDir $R8
    CreateDirectory "$R8"
    CopyFiles /SILENT "$R7\vault.mv*" "$R8"
    ; 설치가 잘못되더라도 남도록 AppData 백업 폴더에도 한 부 복사
    CreateDirectory "$APPDATA\MySafe\backups"
    CopyFiles /SILENT "$R7\vault.mv" "$APPDATA\MySafe\backups\vault-rescued-from-installdir.mv"
    DetailPrint "설치 폴더의 볼트 파일을 임시 보관합니다."
  ${EndIf}
!macroend

!macro customInstall
  ; 대피시켜 둔 볼트 파일을 설치 폴더로 되돌린다 (같은 이름이 이미 있으면 건드리지 않는다)
  !insertmacro mysafeRescueDir $R8
  ${If} ${FileExists} "$R8\vault.mv"
    ${IfNot} ${FileExists} "$INSTDIR\vault.mv"
      CopyFiles /SILENT "$R8\vault.mv*" "$INSTDIR"
      DetailPrint "임시 보관한 볼트 파일을 제자리에 되돌렸습니다."
    ${EndIf}
    RMDir /r "$R8"
  ${EndIf}
!macroend
