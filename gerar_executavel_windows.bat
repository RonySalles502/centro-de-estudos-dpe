@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python de desenvolvimento nao localizado.
  pause
  exit /b 1
)

py -3 -m pip install --upgrade pyinstaller
if errorlevel 1 goto :falha

py -3 -m PyInstaller --noconfirm --clean CentroEstudosDPERN.spec
if errorlevel 1 goto :falha

echo.
echo Executavel criado em dist\CentroEstudosDPERN.exe
pause
exit /b 0

:falha
echo.
echo Nao foi possivel gerar o executavel.
pause
exit /b 1
