package io.sankofa.school.config;

import io.sankofa.school.identity.auth.SessionAuthenticationFilter;
import io.sankofa.school.platform.error.ApiError;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.platform.context.CorrelationId;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.XXssProtectionHeaderWriter;

/**
 * HTTP security for the core API.
 *
 * <h2>Why CSRF protection is disabled here, and why that is not a hole</h2>
 * CSRF exists because browsers attach ambient credentials — cookies — to cross-site requests.
 * This API accepts no cookies. It authenticates solely on an {@code Authorization: Bearer}
 * header, which a cross-site form or image tag cannot set. The session cookie lives one tier up,
 * in the Next.js BFF, and that tier applies CSRF protection to its own routes.
 *
 * <p>If this API ever starts reading a cookie, CSRF protection must be reinstated in the same
 * change. That is the condition, not a style preference.
 */
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {

    private final ObjectMapper objectMapper;

    public SecurityConfig(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * A separate chain for the API documentation UI.
     *
     * <p>Swagger UI is an HTML application, and the main chain sends {@code default-src 'none'} —
     * which is exactly right for an API that returns only JSON, and which makes any HTML
     * application impossible. The result was a blank page: the browser refused every stylesheet
     * and script the page asked for. Loosening the API's CSP to fix that would have been the
     * wrong trade entirely, so the docs get their own chain instead.
     *
     * <p>This policy is still narrow — everything must come from this origin — but it does permit
     * {@code 'unsafe-inline'}, which Swagger UI's bootstrap script requires. That is a real
     * relaxation, and it is confined to a UI that is disabled by default and should stay disabled
     * in production ({@code SWAGGER_UI_ENABLED}).
     */
    @Bean
    @Order(1)
    public SecurityFilterChain docsFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**")
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .headers(headers -> headers
                    .frameOptions(frame -> frame.deny())
                    .contentTypeOptions(Customizer.withDefaults())
                    .contentSecurityPolicy(csp -> csp.policyDirectives(
                            "default-src 'self'; "
                                    + "script-src 'self' 'unsafe-inline'; "
                                    + "style-src 'self' 'unsafe-inline'; "
                                    + "img-src 'self' data:; "
                                    + "font-src 'self'; "
                                    + "connect-src 'self'; "
                                    + "frame-ancestors 'none'; "
                                    + "base-uri 'none'")));

        return http.build();
    }

    @Bean
    @Order(2)
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           SessionAuthenticationFilter sessionFilter)
            throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                    // Liveness and readiness only. The full actuator surface is not exposed;
                    // see application.yml, which limits management.endpoints.web.exposure.
                    .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                    // Session establishment must be reachable without a session.
                    .requestMatchers("/api/v1/sessions").permitAll()
                    // Public admissions intake and webhook receivers authenticate by their own
                    // means: an application reference, or a provider signature.
                    .requestMatchers("/api/v1/public/**").permitAll()
                    .requestMatchers("/api/v1/webhooks/**").permitAll()
                    .anyRequest().authenticated())
            .addFilterBefore(sessionFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(ex -> ex
                    .authenticationEntryPoint((request, response, authException) ->
                            writeError(response, ErrorCode.UNAUTHENTICATED,
                                    "Authentication is required"))
                    .accessDeniedHandler((request, response, deniedException) ->
                            writeError(response, ErrorCode.FORBIDDEN,
                                    "You do not have permission to perform this action")))
            .headers(headers -> headers
                    // The API returns JSON, never a document a browser should frame or sniff.
                    .frameOptions(frame -> frame.deny())
                    .contentTypeOptions(Customizer.withDefaults())
                    .xssProtection(xss -> xss
                            .headerValue(XXssProtectionHeaderWriter.HeaderValue.DISABLED))
                    .referrerPolicy(ref -> ref
                            .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                    .httpStrictTransportSecurity(hsts -> hsts
                            .includeSubDomains(true)
                            .maxAgeInSeconds(63_072_000))
                    .contentSecurityPolicy(csp -> csp
                            // An API serves no scripts, styles or frames. The strictest possible
                            // policy costs nothing here and closes off any response that
                            // unexpectedly renders as HTML.
                            .policyDirectives("default-src 'none'; frame-ancestors 'none'; "
                                    + "base-uri 'none'; form-action 'none'"))
                    .permissionsPolicyHeader(pp -> pp
                            .policy("geolocation=(), microphone=(), camera=(), payment=(), "
                                    + "usb=(), interest-cohort=()")));

        return http.build();
    }

    private void writeError(jakarta.servlet.http.HttpServletResponse response,
                            ErrorCode code, String message) throws java.io.IOException {
        response.setStatus(code.httpStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(),
                ApiError.of(code, message, CorrelationId.current()));
    }
}
