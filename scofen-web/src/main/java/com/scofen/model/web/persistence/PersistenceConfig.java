package com.scofen.model.web.persistence;

import com.scofen.model.web.workspace.NoopProjectDirectoryStore;
import com.scofen.model.web.workspace.ProjectDirectoryStore;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

/**
 * 持久化实现选择：默认（或显式 memory）走内存不落库；
 * 仅当 {@code scofen.persistence.mode=mysql} 时切到 JDBC 写穿。
 * 两种模式恰好各注册一组 {@link PersistenceServiceFactory} 与 {@link ProjectDirectoryStore}，无歧义。
 *
 * <p>由于 {@code application.properties} 已全局排除 JDBC 自动配置（内存态零数据库依赖），
 * mysql 模式下需在此手工装配 {@link DataSource} 与 {@link JdbcTemplate}，
 * 全部从 {@code spring.datasource.*} 读取（由使用方自备，或测试用外部实例 / Testcontainers 注入）。</p>
 */
@Configuration
public class PersistenceConfig {

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "memory", matchIfMissing = true)
    public PersistenceServiceFactory noopPersistenceServiceFactory() {
        return new NoopPersistenceServiceFactory();
    }

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "memory", matchIfMissing = true)
    public ProjectDirectoryStore noopProjectDirectoryStore() {
        return new NoopProjectDirectoryStore();
    }

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "mysql")
    public DataSource scofenDataSource(Environment env) {
        String url = env.getRequiredProperty("spring.datasource.url");
        String username = env.getRequiredProperty("spring.datasource.username");
        String password = env.getProperty("spring.datasource.password", "");
        String driver = env.getProperty("spring.datasource.driver-class-name",
                "com.mysql.cj.jdbc.Driver");
        return DataSourceBuilder.create()
                .type(HikariDataSource.class)
                .driverClassName(driver)
                .url(url)
                .username(username)
                .password(password)
                .build();
    }

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "mysql")
    public JdbcTemplate scofenJdbcTemplate(DataSource scofenDataSource) {
        return new JdbcTemplate(scofenDataSource);
    }

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "mysql")
    public PersistenceServiceFactory mysqlPersistenceServiceFactory(
            JdbcTemplate scofenJdbcTemplate,
            @Value("${scofen.persistence.snapshot-retention:100}") int retention) {
        return new MysqlPersistenceServiceFactory(scofenJdbcTemplate, retention);
    }

    @Bean
    @ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "mysql")
    public ProjectDirectoryStore jdbcProjectDirectoryStore(JdbcTemplate scofenJdbcTemplate) {
        return new JdbcProjectDirectoryStore(scofenJdbcTemplate);
    }
}
