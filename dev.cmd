@echo off
REM Focus OS dev launcher — double-click this (or run `.\dev.cmd`) to start the app.
REM Adds cargo to PATH itself, so it works even in terminals with a stale PATH.
title Focus OS dev
set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
cd /d "%~dp0"
npm run tauri dev
pause
