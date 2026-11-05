package com.scofen.model.web;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.JdbcTemplateAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.health.DataSourceHealthContributorAutoConfiguration;

/**
 * 内存态为默认运行模式（scofen.persistence.mode=memory）：不引入任何 JDBC 自动配置，
 * 避免 Actuator 的健康指示器在无 DataSource 时仍尝试推断一个 DataSource 而启动失败。
 * mysql 模式由 {@code PersistenceConfig} 手工装配 HikariDataSource + JdbcTemplate。
 */
@SpringBootApplication(exclude = {
        DataSourceAutoConfiguration.class,
        JdbcTemplateAutoConfiguration.class,
        DataSourceHealthContributorAutoConfiguration.class
})
public class ScofenApplication {

    public static void main(String[] args) {
        SpringApplication.run(ScofenApplication.class, args);
    }
}
