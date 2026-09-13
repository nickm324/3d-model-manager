@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current Node.js LTS release, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing 3D Model Manager dependencies...
  if exist "%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js" (
    node.exe "%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js" install
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 (
    echo Dependency installation failed. Review the message above.
    pause
    exit /b 1
  )
)

if not exist ".local-data\" mkdir ".local-data"
if not exist ".local-library\" mkdir ".local-library"

set "HOST=127.0.0.1"
set "PORT=3210"
set "DATA_PATH=%CD%\.local-data"
set "LIBRARY_PATH=%CD%\.local-library"
set "LIBRARY_WRITABLE=true"
if exist "%ProgramFiles%\OpenSCAD\openscad.com" set "OPENSCAD_BIN=%ProgramFiles%\OpenSCAD\openscad.com"

echo.
echo 3D Model Manager is starting at http://127.0.0.1:3210/
echo Keep this window open while using the local preview.
echo Press Ctrl+C to stop it.
echo.
start "" cmd.exe /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:3210/"
node.exe server.mjs

if errorlevel 1 (
  echo.
  echo The preview stopped with an error. If port 3210 is already in use, close the existing preview first.
  pause
)
