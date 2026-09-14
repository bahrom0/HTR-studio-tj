@echo off
setlocal
chcp 65001 >nul
title TJOCR Next
cd /d "%~dp0tjocr-next"
npm run dev:open
