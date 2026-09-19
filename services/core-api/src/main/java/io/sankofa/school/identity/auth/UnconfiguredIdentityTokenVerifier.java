package io.sankofa.school.identity.auth;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The verifier used when no identity provider is configured. It refuses everything.
 *
 * <h2>Why this exists</h2>
 * Without it, an environment with no Firebase project could not start at all: {@code
 * SessionService} requires an {@link IdentityTokenVerifier}, the only other implementation is
 * supplied conditionally by {@code FirebaseConfig}, and the context failed with
 * {@code NoSuchBeanDefinitionException}. That is a poor failure. Running migrations, serving
 * health checks and inspecting the schema are all legitimate things to do in an environment that
 * cannot yet authenticate anyone, and none of them should require an identity provider.
 *
 * <h2>Why it is safe</h2>
 * It is not a bypass and cannot become one. Every call refuses with the same message a bad token
 * produces, so the only reachable outcome is that nobody signs in — which is the truthful
 * behaviour when there is no identity provider to verify against. The alternative failure mode,
 * a stub that accepts, is the one that must never exist; this is its opposite.
 *
 * <p>It announces itself at startup at {@code WARN}, because an operator who has misconfigured
 * production needs to discover that from a log line rather than from a user unable to sign in.
 */
public class UnconfiguredIdentityTokenVerifier implements IdentityTokenVerifier {

    private static final Logger log =
            LoggerFactory.getLogger(UnconfiguredIdentityTokenVerifier.class);

    @PostConstruct
    void announce() {
        log.warn("""
                No identity provider is configured — sankofa.firebase.project-id is not set.
                The service will start, but NO USER CAN SIGN IN: every authentication attempt
                will be refused. This is correct for a migration or schema-inspection
                environment, and is a misconfiguration anywhere else.
                See docs/DEPLOYMENT.md section 2.2.""");
    }

    @Override
    public VerifiedIdentity verify(String idToken) {
        // Logged at WARN rather than DEBUG: in a correctly configured environment this line
        // should never appear, so its presence is itself the diagnostic.
        log.warn("Authentication attempted with no identity provider configured; refusing");
        throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
    }
}
