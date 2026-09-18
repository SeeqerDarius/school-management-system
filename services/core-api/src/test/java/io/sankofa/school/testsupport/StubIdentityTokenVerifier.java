package io.sankofa.school.testsupport;

import io.sankofa.school.identity.auth.IdentityTokenVerifier;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * A verifier that returns whatever a test tells it to.
 *
 * <p>This exists so the sign-in path can be tested without a live Firebase project. That matters
 * more than it sounds: authentication is simultaneously the code most worth testing and the code
 * most often left untested, precisely because standing up the provider is awkward.
 *
 * <p>What it does <b>not</b> do is skip verification in production. The real
 * {@link io.sankofa.school.identity.auth.FirebaseIdentityTokenVerifier} is the only
 * implementation registered outside tests, and it is wired by a configuration class conditional
 * on a Firebase project being present. A deployment without one cannot authenticate anybody —
 * it does not fall back to trusting the client.
 */
public class StubIdentityTokenVerifier implements IdentityTokenVerifier {

    private final Map<String, VerifiedIdentity> tokens = new HashMap<>();

    /** Registers a token that will verify successfully to the given identity. */
    public void accept(String token, String uid, String email, boolean emailVerified,
                       boolean mfaSatisfied) {
        tokens.put(token, new VerifiedIdentity(uid, email, emailVerified, mfaSatisfied,
                Instant.now()));
    }

    /** Registers a token whose identity was issued at a specific instant. */
    public void acceptIssuedAt(String token, String uid, String email, Instant issuedAt) {
        tokens.put(token, new VerifiedIdentity(uid, email, true, false, issuedAt));
    }

    public void reset() {
        tokens.clear();
    }

    @Override
    public VerifiedIdentity verify(String idToken) {
        VerifiedIdentity identity = tokens.get(idToken);
        if (identity == null) {
            // Mirrors the real verifier: one message for every failure mode, so nothing about
            // why the token was rejected leaks back to the caller.
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        }
        return identity;
    }
}
