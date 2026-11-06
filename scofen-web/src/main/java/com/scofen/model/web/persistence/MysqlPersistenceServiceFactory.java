package com.scofen.model.web.persistence;

import com.scofen.model.core.PersistenceService;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * MySQL 模式的持久化工厂：为每个项目 id 产出一个绑定它的 {@link MysqlPersistenceService}。
 */
public final class MysqlPersistenceServiceFactory implements PersistenceServiceFactory {

    private final JdbcTemplate jdbc;
    private final int retention;

    public MysqlPersistenceServiceFactory(JdbcTemplate jdbc, int retention) {
        this.jdbc = jdbc;
        this.retention = retention;
    }

    @Override
    public boolean enabled() {
        return true;
    }

    @Override
    public PersistenceService forProject(String projectId) {
        return new MysqlPersistenceService(jdbc, projectId, retention);
    }
}
