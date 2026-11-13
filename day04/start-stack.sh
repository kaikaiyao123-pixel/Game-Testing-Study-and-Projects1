#!/usr/bin/env bash
# Git Bash / macOS / Linux one-click launcher for the Spring Boot stack
cd "$(dirname "$0")" || exit 1

# NOTE: On Git Bash the Unix "mvn" script computes MAVEN_HOME as /f/...
# which the Windows java.exe cannot resolve, causing:
#   ClassNotFoundException: org.codehaus.plexus.classworlds.launcher.Launcher
# So we launch the Maven Launcher directly with an explicit classpath.
# On real Linux/macOS, "pwd -W" is unavailable and the Unix path is used,
# which is also valid for a Unix JVM.
ROOT_WIN="$(pwd -W 2>/dev/null || pwd)"
MH="$ROOT_WIN/backend/.tools/apache-maven-3.9.9"
CW="$MH/boot/plexus-classworlds-2.8.0.jar"

# Default mode detaches both services with nohup and returns immediately.
# --foreground keeps this launcher alive with wait(), so environments that reap
# detached children as soon as the invoking command returns (e.g. tool sandboxes)
# can still run the whole stack with one command held as a background task.
FOREGROUND=0
LAUNCH=nohup
if [ "${1:-}" = "--foreground" ]; then
  FOREGROUND=1
  LAUNCH=""
fi

run_maven() {
  java -classpath "$CW" \
    "-Dclassworlds.conf=$MH/bin/m2.conf" \
    "-Dmaven.home=$MH" \
    "-Dmaven.multiModuleProjectDirectory=$ROOT_WIN/backend" \
    org.codehaus.plexus.classworlds.launcher.Launcher "$@"
}

echo "[1/4] Starting MySQL and Redis containers ..."
docker compose up -d --wait mysql redis || exit 1

echo "[2/4] Building Spring Boot backend ..."
run_maven -f backend/pom.xml -q -DskipTests package || exit 1

echo "[3/4] Starting Spring Boot backend on 8081 ..."
MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_DATABASE=blog \
MYSQL_USER=blog MYSQL_PASSWORD=blog_pass_2026 \
REDIS_HOST=127.0.0.1 REDIS_PORT=6379 SERVER_PORT=8081 \
CORS_ALLOWED_ORIGINS='*' \
  ${LAUNCH:+$LAUNCH }java -jar backend/target/blog-backend.jar > backend.log 2>&1 &
echo $! > .backend.pid

echo "[4/4] Starting static frontend on 3000 ..."
${LAUNCH:+$LAUNCH }node server/frontend.js > frontend.log 2>&1 &
echo $! > .frontend.pid

echo ""
if [ "$FOREGROUND" -eq 1 ]; then
  echo "Foreground mode: services stay alive while this process runs."
  echo "Open http://127.0.0.1:3000/login.html"
  echo "Backend health: http://127.0.0.1:8081/api/health"
  echo "Logs: backend.log / frontend.log"
  echo "Press Ctrl+C to stop both services."
  wait
else
  echo "Done. Open http://127.0.0.1:3000/login.html"
  echo "Backend health: http://127.0.0.1:8081/api/health"
  echo "Logs: backend.log / frontend.log"
  echo 'Stop: kill $(cat .backend.pid) $(cat .frontend.pid); docker compose down'
fi
