package io.sankofa.school.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.util.StringUtils;

/**
 * Matches only when a Firebase project id is actually present and non-blank.
 *
 * <p>{@code @ConditionalOnProperty} is not sufficient here. It treats a property as "present" if
 * it is defined at all, and an empty string is not the literal {@code false} it looks for — so
 * {@code FIREBASE_PROJECT_ID=} matches. Combined with {@code ${FIREBASE_PROJECT_ID:}} in
 * {@code application.yml}, which yields an empty string when the variable is unset, that means a
 * developer starting the service without Firebase would fail at boot while the SDK went looking
 * for Application Default Credentials that are not there.
 *
 * <p>This condition is about <em>startup</em>, never about security. A deployment with no
 * verifier cannot authenticate anyone; it does not fall back to trusting the client.
 */
public class FirebaseConfiguredCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return StringUtils.hasText(
                context.getEnvironment().getProperty("sankofa.firebase.project-id"));
    }
}
