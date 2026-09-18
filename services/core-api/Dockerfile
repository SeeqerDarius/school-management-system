# =====================================================================================
# Core API container image.
#
# Deliberately host-agnostic: plain OCI, no platform-specific base or build hook. It runs on
# Cloud Run, Railway, Fly.io, Vercel's container runtime or a plain VM without modification,
# because the decision of where to run it has not been made and this image should not make it.
#
# The only contract with the host is: listen on $PORT, and report readiness at
# /actuator/health/readiness.
# =====================================================================================

# -------------------------------------------------------------------------------------
# Stage 1 — build
#
# Dependencies resolve in their own layer, before the source is copied. A change to one Java
# file then rebuilds in seconds rather than re-downloading 400MB of Maven artifacts, which is
# the difference between a CI run that takes one minute and one that takes six.
# -------------------------------------------------------------------------------------
FROM eclipse-temurin:25-jdk-noble AS build

WORKDIR /build

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline

COPY src/ src/
# Tests do not run here. They run in CI, against a real PostgreSQL, as a non-superuser role —
# see .github/workflows/ci.yml. Running them again inside the image build would double the
# build time and prove nothing new; and an image built from a commit CI has not passed should
# never be deployed in the first place.
RUN ./mvnw -B -ntp -DskipTests package

# Spring Boot's layered jar, unpacked so Docker can cache the parts that rarely change
# (dependencies) separately from the part that changes every commit (application classes).
RUN java -Djarmode=tools -jar target/core-api-*.jar extract --layers --launcher --destination extracted

# -------------------------------------------------------------------------------------
# Stage 2 — runtime
#
# A JRE, not a JDK: the compiler, javadoc tool and debugger have no business in a production
# image, and every binary omitted is one fewer thing to patch when a CVE lands.
# -------------------------------------------------------------------------------------
FROM eclipse-temurin:25-jre-noble AS runtime

# curl for the healthcheck; nothing else. The image is intentionally boring.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root. A container escape is a great deal less interesting from an unprivileged account,
# and nothing this service does requires root.
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin sankofa

WORKDIR /app

# Ordered least- to most-frequently-changed, so a code-only change invalidates one thin layer.
COPY --from=build --chown=sankofa:sankofa /build/extracted/dependencies/ ./
COPY --from=build --chown=sankofa:sankofa /build/extracted/spring-boot-loader/ ./
COPY --from=build --chown=sankofa:sankofa /build/extracted/snapshot-dependencies/ ./
COPY --from=build --chown=sankofa:sankofa /build/extracted/application/ ./

USER sankofa

# Hosts differ on how they tell a container which port to use; $PORT is the common denominator.
ENV PORT=8080
EXPOSE 8080

# MaxRAMPercentage rather than a fixed -Xmx: the JVM then adapts to whatever the platform
# actually granted the container, instead of being tuned for a memory limit that may not exist.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -XX:+UseContainerSupport -Djava.security.egd=file:/dev/./urandom"

# Readiness, not liveness: readiness reports whether the service can serve traffic, which
# includes the database being reachable. A liveness probe that fails on a transient database
# blip would restart a perfectly healthy process and make an outage worse.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${PORT}/actuator/health/readiness" || exit 1

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
