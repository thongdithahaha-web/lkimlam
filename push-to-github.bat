@echo off
chcp 65001 >nul
title Đẩy code lên GitHub - lkimlamdev
echo.
echo =======================================================
echo    HỖ TRỢ ĐẨY CODE LÊN GITHUB - LKIMLAMDEV
echo =======================================================
echo.
echo Bước 1: Hãy vào https://github.com/new và tạo 1 Repository mới.
echo Bước 2: Dán đường dẫn repository của bạn vào đây (ví dụ: https://github.com/username/repo.git)
echo.
set /p REPO_URL="Nhập Link GitHub Repo: "

if "%REPO_URL%"=="" (
    echo.
    echo [Lỗi] Bạn chưa nhập link repo!
    pause
    exit /b
)

echo.
echo [1/3] Đang cấu hình Remote origin...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo [2/3] Đổi tên nhánh thành main...
git branch -M main

echo [3/3] Đang đẩy code lên GitHub...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo   [THÀNH CÔNG] Code đã được đẩy lên GitHub thành công!
    echo =======================================================
) else (
    echo.
    echo [Lỗi] Đẩy code thất bại. Vui lòng kiểm tra lại đường link hoặc quyền truy cập.
)

echo.
pause
