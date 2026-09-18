package io.sankofa.school.identity.auth;

import java.time.Instant;

/**
 * Verifies an identity token issued by the external identity provider.
 *
 * <p>An interface rather than a direct call to {@code FirebaseAuth} for one reason that matters:
 * it makes the sign-in path testable without a live Firebase project. Authentication is the code
 * most worth testing and the code most often left untested precisely because the provider is
 * awkward to stand up.
 *
 * <p>Implementations must verify the token's <b>signature</b>, <b>audience</b>, <b>issuer</b>,
 * <b>expiry</b> and <b>revocation</b>. A verifier that only decodes the payload is worse than
 * none, because it looks like a security control while accepting any token an attacker cares
 * to write.
 */
public interface IdentityTokenVerifier {

    /**
     * @param idToken the raw token presented by the client
     * @return the verified identity
     * @throws io.sankofa.school.platform.error.ApiException with
     *         {@link io.sankofa.school.platform.error.ErrorCode#UNAUTHENTICATED} if the token is
     *         absent, malformed, expired, revoked, or not issued for this project
     */
    VerifiedIdentity verify(String idToken);

    /**
     * An identity the provider has vouched for.
     *
     * @param uid           the provider's stable user identifier; the join key to
     *                      {@code identity.app_user.firebase_uid}
     * @param email         the verified or unverified email on the account
     * @param emailVerified whether the provider has confirmed the address
     * @param mfaSatisfied  whether a second factor was presented during this sign-in. Privileged
     *                      memberships require this; see {@code docs/SECURITY.md}
     * @param issuedAt      when the token was minted, compared against
     *                      {@code app_user.sessions_valid_from} so that an administrative
     *                      revocation cuts off tokens issued before it
     */
    record VerifiedIdentity(
            String uid,
            String email,
            boolean emailVerified,
            boolean mfaSatisfied,
            Instant issuedAt) {
    }
}
