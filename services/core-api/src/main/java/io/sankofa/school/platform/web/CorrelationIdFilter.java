package io.sankofa.school.platform.web;

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
 * Gives every request a correlation id, and puts it in the logging context and the response.
 *
 * <p>When a bursar reports that a receipt failed to print, the correlation id on their screen is
 * what turns "something went wrong last Tuesday" into a single log query. It also threads through
 * the outbox, so a notification can be traced back to the transaction that produced it.
 *
 * <p>An inbound {@code X-Correlation-Id} is honoured so a trace survives the hop from the web
 * tier, but it is validated first: it ends up in log lines, and an unvalidated header is how log
 * injection and forged log entries happen.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    /** Deliberately narrow: identifier characters only, bounded length. */
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    /** The correlation id for the request being handled, or a placeholder outside one. */
    public static String current() {
        String value = CURRENT.get();
        return value == null ? "no-correlation-id" : value;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String inbound = request.getHeader(HEADER);
        String correlationId = inbound != null && SAFE.matcher(inbound).matches()
                ? inbound
                : Ids.newId().toString();

        CURRENT.set(correlationId);
        MDC.put(MDC_KEY, correlationId);
        response.setHeader(HEADER, correlationId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
            CURRENT.remove();
        }
    }
}
