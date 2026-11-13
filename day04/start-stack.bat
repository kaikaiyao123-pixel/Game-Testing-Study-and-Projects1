@echo off
chcp 65001 >nul
cd /d "%~dp0"

@REM Launch the Maven Launcher directly with java. The bundled mvn.cmd
@REM requires JAVA_HOME, which is not guaranteed on this machine.
set "MH=%~dp0backend\.tools\apache-maven-3.9.9"
set "CW=%MH%\boot\plexus-classworlds-2.8.0.jar"
set "BASE=%~dp0backend"

echo [1/4] Starting MySQL and Redis containers ...
docker compose up -d --wait mysql redis
if errorlevel 1 goto :fail

echo [2/4] Building Spring Boot backend ...
java -classpath "%CW%" "-Dclassworlds.conf=%MH%\bin\m2.conf" "-Dmaven.home=%MH%" "-Dmaven.multiModuleProjectDirectory=%BASE%" org.codehaus.plexus.classworlds.launcher.Launcher -f "backend\pom.xml" -q -DskipTests package
if errorlevel 1 goto :fail

echo [3/4] Starting Spring Boot backend on 8081 ...
set MYSQL_HOST=127.0.0.1
set MYSQL_PORT=3306
set MYSQL_DATABASE=blog
set MYSQL_USER=blog
set MYSQL_PASSWORD=blog_pass_2026
set REDIS_HOST=127.0.0.1
set REDIS_PORT=6379
set SERVER_PORT=8081
set "CORS_ALLOWED_ORIGINS=*"
start "blog-backend" java -jar "backend\target\blog-backend.jar"

echo [4/4] Starting static frontend on 3000 ...
start "blog-frontend" node "server\frontend.js"

echo.
echo Done. Open http://127.0.0.1:3000/login.html
echo Backend health: http://127.0.0.1:8081/api/health
echo Stop containers: docker compose down
goto :eof

:fail
echo [ERROR] Startup failed. See messages above.
pause
exit /b 1
