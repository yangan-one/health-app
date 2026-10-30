@echo off
REM One-click start for the health app (Windows).
REM Opens two windows: backend API on 3001, web dev server on 5173.
chcp 65001 >nul
setlocal

if not exist "%~dp0server\node_modules" (
  echo [setup] installing backend deps...
  pushd "%~dp0server" && call npm.cmd install && popd
)
if not exist "%~dp0web\node_modules" (
  echo [setup] installing web deps...
  pushd "%~dp0web" && call npm.cmd install && popd
)

echo [1/2] starting backend on http://127.0.0.1:3001 ...
start "health-backend" cmd /k "cd /d %~dp0server && npm.cmd start"

timeout /t 2 /nobreak >nul

echo [2/2] starting web on http://127.0.0.1:5173 ...
start "health-web" cmd /k "cd /d %~dp0web && npm.cmd run dev"

timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:5173

echo.
echo Done. Two windows are running:
echo   health-backend  - Express API
echo   health-web      - Vite dev server
echo Close those windows to stop the app.
