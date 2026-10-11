@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 LTS.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 (
  echo Nao foi possivel instalar. Confira o erro acima.
  pause
  exit /b 1
)
echo Abra http://localhost:3000 no navegador. Fechar esta janela para o servidor.
call npm start
pause
