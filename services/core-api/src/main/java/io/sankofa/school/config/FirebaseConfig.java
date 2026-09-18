package io.sankofa.school.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import io.sankofa.school.identity.auth.FirebaseIdentityTokenVerifier;
import io.sankofa.school.identity.auth.IdentityTokenVerifier;
import io.sankofa.school.platform.config.SankofaProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Wires Firebase Admin.
 *
 * <p>Credentials are resolved in the order that keeps secrets off disk wherever possible:
 * Application Default Credentials first — the managed-runtime path, where there is no file to
 * leak, no file to rotate and no file to accidentally commit — and an explicit service-account
 * file only when one is configured, which is really a local-development affordance.
 *
 * <p>The whole configuration is conditional on a project id being set, so the service starts
 * without Firebase for tests and for schema work. {@code IdentityTokenVerifier} is then supplied
 * by the test harness. That conditionality is a convenience, never a security decision: a
 * deployment with no verifier cannot authenticate anyone at all, it does not fall back to
 * trusting the client.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(FirebaseConfiguredCondition.class)
public class FirebaseConfig {

    private static final Logger log = LoggerFactory.getLogger(FirebaseConfig.class);

    @Bean
    @ConditionalOnMissingBean
    public FirebaseApp firebaseApp(SankofaProperties properties) throws IOException {
        SankofaProperties.Firebase config = properties.firebase();

        if (!FirebaseApp.getApps().isEmpty()) {
            return FirebaseApp.getInstance();
        }

        GoogleCredentials credentials = loadCredentials(config);

        FirebaseOptions.Builder options = FirebaseOptions.builder()
                .setCredentials(credentials)
                .setProjectId(config.projectId());

        if (config.storageBucket() != null && !config.storageBucket().isBlank()) {
            options.setStorageBucket(config.storageBucket());
        }

        log.info("Initialising Firebase for project {}", config.projectId());
        return FirebaseApp.initializeApp(options.build());
    }

    private static GoogleCredentials loadCredentials(SankofaProperties.Firebase config)
            throws IOException {
        String path = config.credentialsPath();
        if (path == null || path.isBlank()) {
            return GoogleCredentials.getApplicationDefault();
        }
        // An explicit file path. The file lives outside the repository and outside the image;
        // .gitignore blocks the usual filename patterns as a backstop, not as the control.
        log.info("Loading Firebase credentials from an explicit file path");
        try (InputStream in = new FileInputStream(path)) {
            return GoogleCredentials.fromStream(in);
        }
    }

    @Bean
    @ConditionalOnMissingBean
    public FirebaseAuth firebaseAuth(FirebaseApp app) {
        return FirebaseAuth.getInstance(app);
    }

    @Bean
    @ConditionalOnMissingBean
    public IdentityTokenVerifier identityTokenVerifier(FirebaseAuth firebaseAuth) {
        return new FirebaseIdentityTokenVerifier(firebaseAuth);
    }
}
