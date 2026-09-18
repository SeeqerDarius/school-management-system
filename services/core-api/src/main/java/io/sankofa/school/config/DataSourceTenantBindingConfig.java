package io.sankofa.school.config;

import io.sankofa.school.tenancy.TenantAwareDataSource;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * Wraps the application's {@link DataSource} so that every connection carries the request's
 * tenant into the PostgreSQL session, where Row Level Security can act on it.
 *
 * <p>A {@link BeanPostProcessor} is used rather than declaring the DataSource ourselves, so that
 * Spring Boot keeps ownership of pool configuration, metrics and health indicators. The wrapper
 * is applied to whatever Boot built.
 *
 * <p>Flyway is deliberately unaffected: it is configured with its own credentials
 * ({@code spring.flyway.user}) and therefore its own DataSource, because migrations run as the
 * schema owner while the application runs as a role that Row Level Security actually applies to.
 * If both used the same role, either migrations would fail or RLS would be bypassed — and the
 * second failure mode is the dangerous one, because nothing would look broken.
 */
@Configuration(proxyBeanMethods = false)
public class DataSourceTenantBindingConfig {

    @Configuration(proxyBeanMethods = false)
    static class TenantBindingPostProcessor implements BeanPostProcessor {

        @Override
        public Object postProcessAfterInitialization(Object bean, String beanName)
                throws BeansException {
            if (bean instanceof DataSource dataSource
                    && !(bean instanceof TenantAwareDataSource)
                    && "dataSource".equals(beanName)) {
                return new TenantAwareDataSource(dataSource);
            }
            return bean;
        }
    }
}
