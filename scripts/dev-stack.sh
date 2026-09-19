#!/usr/bin/env bash
#
# Runs the whole platform locally: throwaway PostgreSQL, migrations, demo data, core API.
#
#   scripts/dev-stack.sh
#
# Needs a JDK and nothing else. No PostgreSQL install, no superuser password, no Docker —
# it starts its own database on a random port and removes it on exit.
#
# To sign in locally you also need an identity provider. Start the Firebase Auth emulator
# and export these before running:
#
#   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
#   FIREBASE_PROJECT_ID=demo-sankofa
#
# Without them the service still starts, but every sign-in is refused — which is the truthful
# behaviour when there is no provider to verify tokens against, and the same behaviour a
# misconfigured deployment would show.

set -euo pipefail

cd "$(dirname "$0")/../services/core-api"

CP_FILE="target/test-cp.txt"

# The dev stack lives in test sources, so it needs the test classpath. Rebuild it whenever the
# POM is newer than the cached file, which is the only time it can have gone stale.
if [ ! -f "$CP_FILE" ] || [ pom.xml -nt "$CP_FILE" ]; then
  echo "Resolving the test classpath…"
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

exec java -cp "target/classes${SEP}target/test-classes${SEP}$(cat "$CP_FILE")" \
  io.sankofa.school.devstack.DevStack "$@"
