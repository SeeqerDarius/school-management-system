package io.sankofa.school.identity.auth;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.Map;

/**
 * Verifies a Firebase ID token against Google's published signing keys.
 *
 * <p>Verification is delegated to the Admin SDK, which checks the signature, the issuer, the
 * audience (this project and no other), and expiry. We additionally pass {@code checkRevoked},
 * which costs a call to Firebase but means a revoked session cannot keep working for the
 * remainder of its hour-long token lifetime — the difference between "disabled immediately" and
 * "disabled eventually" when an account is compromised.
 *
 * <p>The failure branches deliberately return the <em>same</em> message to the caller. A
 * verifier that distinguishes "expired" from "wrong audience" from "bad signature" tells an
 * attacker which part of their forgery to fix.
 */
public class FirebaseIdentityTokenVerifier implements IdentityTokenVerifier {

    private static final Logger log = LoggerFactory.getLogger(FirebaseIdentityTokenVerifier.class);

    private final FirebaseAuth firebaseAuth;

    public FirebaseIdentityTokenVerifier(FirebaseAuth firebaseAuth) {
        this.firebaseAuth = firebaseAuth;
    }

    @Override
    public VerifiedIdentity verify(String idToken) {
        if (idToken == null || idToken.isBlank()) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        }

        FirebaseToken token;
        try {
            token = firebaseAuth.verifyIdToken(idToken, true);
        } catch (FirebaseAuthException e) {
            // Logged with the provider's own error code so an operator can tell an expired
            // token from a misconfigured audience; the caller learns neither.
            log.info("Identity token rejected: {}", e.getAuthErrorCode(), e);
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        } catch (IllegalArgumentException e) {
            log.info("Identity token was malformed");
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        }

        return new VerifiedIdentity(
                token.getUid(),
                token.getEmail(),
                token.isEmailVerified(),
                secondFactorPresented(token.getClaims()),
                issuedAt(token.getClaims()));
    }

    /**
     * Whether a second factor was actually presented during this sign-in.
     *
     * <p>Firebase records this in the {@code firebase.sign_in_second_factor} claim. Its absence
     * means no second factor, which is what a privileged membership checks before it is allowed
     * to bind.
     */
    private static boolean secondFactorPresented(Map<String, Object> claims) {
        Object firebase = claims.get("firebase");
        if (firebase instanceof Map<?, ?> map) {
            Object secondFactor = map.get("sign_in_second_factor");
            return secondFactor != null && !String.valueOf(secondFactor).isBlank();
        }
        return false;
    }

    private static Instant issuedAt(Map<String, Object> claims) {
        Object iat = claims.get("iat");
        if (iat instanceof Number seconds) {
            return Instant.ofEpochSecond(seconds.longValue());
        }
        // The SDK would have rejected a token without iat, so this is unreachable in practice.
        // Returning `now` rather than null keeps the session cut-off comparison total.
        return Instant.now();
    }
}
