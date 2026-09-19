package io.sankofa.school.config;

import io.sankofa.school.identity.auth.IdentityTokenVerifier;
import io.sankofa.school.identity.auth.UnconfiguredIdentityTokenVerifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * Supplies a refusing {@link IdentityTokenVerifier} when no identity provider is configured.
 *
 * <p>The condition is the exact inverse of {@link FirebaseConfiguredCondition} rather than a
 * bare {@code @ConditionalOnMissingBean}. That matters: {@code @ConditionalOnMissingBean} in a
 * user configuration depends on bean-definition ordering, which is not guaranteed between
 * {@code @Configuration} classes, so it could register alongside the Firebase verifier and leave
 * the context with two candidates — or, worse, win. Inverting the same condition makes exactly
 * one of the two apply, deterministically.
 *
 * <p>{@code @ConditionalOnMissingBean} is kept as a second guard so a test that supplies its own
 * stub still takes precedence.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(IdentityProviderFallbackConfig.FirebaseNotConfiguredCondition.class)
public class IdentityProviderFallbackConfig {

    @Bean
    @ConditionalOnMissingBean(IdentityTokenVerifier.class)
    public IdentityTokenVerifier unconfiguredIdentityTokenVerifier() {
        return new UnconfiguredIdentityTokenVerifier();
    }

    /** True exactly when {@link FirebaseConfiguredCondition} is false. */
    static class FirebaseNotConfiguredCondition implements Condition {
        private final FirebaseConfiguredCondition configured = new FirebaseConfiguredCondition();

        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return !configured.matches(context, metadata);
        }
    }
}
