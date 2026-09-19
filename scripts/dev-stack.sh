#!/usr/bin/env bash
#
# Runs the whole platform locally: throwaway PostgreSQL, migrations, demo data, core API.
#
#   scripts/dev-stack.sh
#
# Needs a JDK 25 installed somewhere. Nothing else — no PostgreSQL install, no superuser
# password, no Docker. It starts its own database on a random port and removes it on exit.
#
# To sign in locally you also need an identity provider. Start the Firebase Auth emulator and
# export these before running:
#
#   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
#   FIREBASE_PROJECT_ID=demo-sankofa
#
# Without them the service still starts, but every sign-in is refused — the truthful behaviour
# when there is no provider to verify tokens against, and the same one a misconfigured
# deployment shows.

set -euo pipefail

cd "$(dirname "$0")/../services/core-api"

REQUIRED_MAJOR=25

# ---------------------------------------------------------------------------------------
# Find a JDK 25.
#
# Machines commonly have several JDKs with JAVA_HOME pointing at whichever was installed last,
# and this project needs 25. Searching rather than demanding the user set JAVA_HOME removes a
# setup step and, more usefully, removes a failure mode: compiling with one JDK and running
# with another produces an UnsupportedClassVersionError that names class-file version numbers
# instead of the actual problem. This script hit exactly that.
# ---------------------------------------------------------------------------------------
java_major() {
  "$1" -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/'
}

find_jdk() {
  # 1. An explicitly set JAVA_HOME, if it is new enough.
  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    if [ "$(java_major "${JAVA_HOME}/bin/java")" -ge "$REQUIRED_MAJOR" ] 2>/dev/null; then
      echo "${JAVA_HOME}"
      return 0
    fi
  fi

  # 2. Whatever is on PATH, if it is new enough.
  local on_path
  on_path="$(command -v java || true)"
  if [ -n "$on_path" ] && [ "$(java_major "$on_path")" -ge "$REQUIRED_MAJOR" ] 2>/dev/null; then
    dirname "$(dirname "$on_path")"
    return 0
  fi

  # 3. The usual installation directories, newest first.
  local candidate
  for candidate in \
    "/c/Program Files/Eclipse Adoptium"/jdk-"$REQUIRED_MAJOR"* \
    "/c/Program Files/Java"/jdk-"$REQUIRED_MAJOR"* \
    "/c/Program Files/Microsoft"/jdk-"$REQUIRED_MAJOR"* \
    "/usr/lib/jvm"/*"$REQUIRED_MAJOR"* \
    "/Library/Java/JavaVirtualMachines"/*"$REQUIRED_MAJOR"*/Contents/Home
  do
    if [ -x "${candidate}/bin/java" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! JDK_HOME="$(find_jdk)"; then
  cat >&2 <<EOF
No JDK ${REQUIRED_MAJOR} found.

This project targets Java ${REQUIRED_MAJOR}. Install a JDK ${REQUIRED_MAJOR} — on Windows:

  winget install --id EclipseAdoptium.Temurin.${REQUIRED_MAJOR}.JDK

— then run this script again. It will find the new JDK without you setting JAVA_HOME.
EOF
  exit 1
fi

# Exported so the Maven wrapper below compiles with the same JDK we then run with.
export JAVA_HOME="$JDK_HOME"
JAVA="${JAVA_HOME}/bin/java"

echo "Using JDK $(java_major "$JAVA") at ${JAVA_HOME}"

# ---------------------------------------------------------------------------------------

CP_FILE="target/test-cp.txt"

# The dev stack lives in test sources, so it needs the test classpath. Rebuild it whenever the
# POM is newer than the cached file, which is the only time it can have gone stale.
if [ ! -f "$CP_FILE" ] || [ pom.xml -nt "$CP_FILE" ]; then
  echo "Resolving the test classpath (first run takes a minute)…"
  ./mvnw -B -ntp -q dependency:build-classpath \
    -Dmdep.includeScope=test \
    -Dmdep.outputFile="$CP_FILE"
fi

echo "Compiling…"
./mvnw -B -ntp -q -DskipTests test-compile

SEP=':'
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) SEP=';' ;;
esac

exec "$JAVA" -cp "target/classes${SEP}target/test-classes${SEP}$(cat "$CP_FILE")" \
  io.sankofa.school.devstack.DevStack "$@"
