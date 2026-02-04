@echo off
chcp 65001 >nul
echo ==========================================
echo    أداة تحديث الموقع (Tracking Program Updater)
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
echo جاري الرفع إلى الخادم...
git push

echo.
echo ==========================================
echo ✅ تم الإرسال بنجاح!
echo سيقوم Cloudflare بتحديث الموقع تلقائياً خلال ثوانٍ.
echo ==========================================
pause
