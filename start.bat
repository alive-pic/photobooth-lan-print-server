@echo off
REM ──────────────────────────────────────────────────────────
REM  PhotoBooth LAN Print-Server – Windows launcher
REM  • Adds a firewall rule (once) to open TCP 4000
REM  • Then runs the packaged binary
REM ──────────────────────────────────────────────────────────

cd /d %~dp0

set "BIN=photobooth-print-server.exe"
if not exist "%BIN%" (
  echo Error: %BIN% not found next to start.bat
  pause
  exit /b 1
)

REM Add inbound firewall rule silently (ignored if already exists or lacks permission)
netsh advfirewall firewall add rule ^
    name="PhotoBooth Print Server" dir=in action=allow protocol=TCP localport=4000 ^
    profile=any 2>nul

"%BIN%" %* 