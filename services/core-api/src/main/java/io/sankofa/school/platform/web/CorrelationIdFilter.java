package io.sankofa.school.platform.web;

import io.sankofa.school.platform.context.CorrelationId;
import io.sankofa.school.platform.id.Ids;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Pattern;

/**
 * Gives every HTTP request a correlation id, and puts it in the logging context and the response.
 *
 * <p>When a bursar reports that a receipt failed to print, the correlation id on their screen is
 * what turns "something went wrong last Tuesday" into a single log query.
 *
 * <p>The id itself lives in {@link CorrelationId}, in the platform kernel rather than here. That
 * separation matters: an audit write or an outbox dispatch needs the id too, and neither should
 * have to depend on the web layer to get it.
 *
 * <p>An inbound {@code X-Correlation-Id} is honoured so a trace survives the hop from the web
 * tier, but it is validated first — it ends up in log lines, and an unvalidated header is how
 * log injection and forged log entries happen.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    /** Deliberately narrow: identifier characters only, bounded length. */
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String inbound = request.getHeader(HEADER);
        String correlationId = inbound != null && SAFE.matcher(inbound).matches()
                ? inbound
                : Ids.newId().toString();

        CorrelationId.bind(correlationId);
        MDC.put(MDC_KEY, correlationId);
        response.setHeader(HEADER, correlationId);
        try {
            chain.doFilter(request, response);
        } finally {
            // Both must be cleared: the thread returns to the container's pool, and a leaked id
            // would silently mislabel whichever request lands on it next.
            MDC.remove(MDC_KEY);
            CorrelationId.clear();
        }
    }
}
