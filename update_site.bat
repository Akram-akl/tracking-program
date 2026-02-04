@echo off
chcp 65001 >nul
echo ==========================================
echo    أداة تحديث برنامج المتابعة (Trial Version)
echo ==========================================
echo.
echo جاري تحضير الملفات...
git add .

echo.
set /p commit_msg="ماذا قمت بتعديله؟ (اكتب وصفاً مختصراً): "

if "%commit_msg%"=="" set commit_msg="تحديث عام"

echo.
echo جاري الحفظ والإرسال...
git commit -m "%commit_msg%"

echo.
echo جاري الرفع إلى GitHub...
git push origin main

echo.
echo ==========================================
echo ✅ تم الإرسال بنجاح!
echo سيقوم Cloudflare بتحديث الموقع تلقائياً خلال ثوانٍ.
echo رابط الموقع: https://tracking-program.pages.dev
echo ==========================================
pause
