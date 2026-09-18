package io.sankofa.school;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Entry point for the Sankofa School Platform core service.
 *
 * <p>This is a modular monolith: one deployable, with hard internal seams between the domain
 * packages listed in {@code docs/ARCHITECTURE.md}. {@code ModuleBoundaryTest} enforces those
 * seams in CI, so the option to split a module out later stays open without paying the cost
 * of distributed systems today.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class CoreApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(CoreApiApplication.class, args);
    }
}
