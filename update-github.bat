@echo off
chcp 65001 >nul
title Tự động đẩy code mới lên GitHub - lkimlamdev
echo.
echo =======================================================
echo     ĐANG ĐẨY TOÀN BỘ CODE MỚI LÊN GITHUB...
echo =======================================================
echo.

cd /d %~dp0

:: Lấy thời gian hiện tại làm ghi chú commit
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set mydate=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set mytime=%%a:%%b

echo [1/3] Đang thêm các file thay đổi (git add)...
git add .

echo [2/3] Đang lưu ghi chú (git commit)...
git commit -m "update: Cập nhật code mới lúc %mydate% %mytime%"

echo [3/3] Đang đẩy lên GitHub (git push)...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo   [THÀNH CÔNG] Code đã được cập nhật lên GitHub!
    echo   Xem tại: https://github.com/thongdithahaha-web/lkimlam
    echo =======================================================
) else (
    echo.
    echo [Lỗi] Có lỗi xảy ra trong quá trình đẩy code lên GitHub.
)

echo.
pause
