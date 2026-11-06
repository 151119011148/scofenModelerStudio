package com.scofen.model.web.persistence;

import com.scofen.model.web.workspace.ProjectDirectoryStore;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

/**
 * 项目目录的 JDBC 实现：目录行与模型快照共用 {@code scofen_project} 表。
 */
public final class JdbcProjectDirectoryStore implements ProjectDirectoryStore {

    private final JdbcTemplate jdbc;

    public JdbcProjectDirectoryStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean enabled() {
        return true;
    }

    @Override
    public List<ProjectRow> loadAll() {
        MysqlSchema.ensure(jdbc);
        return jdbc.query("SELECT id, name, description, owner, space_code, status, editable "
                        + "FROM scofen_project ORDER BY created_at, id",
                (rs, index) -> new ProjectRow(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getString("description"),
                        rs.getString("owner"),
                        rs.getString("space_code"),
                        rs.getString("status"),
                        rs.getBoolean("editable")));
    }

    @Override
    public void save(ProjectRow row) {
        MysqlSchema.ensure(jdbc);
        jdbc.update("INSERT INTO scofen_project "
                        + "(id, name, description, owner, space_code, status, editable) VALUES (?, ?, ?, ?, ?, ?, ?) "
                        + "AS new ON DUPLICATE KEY UPDATE name = new.name, description = new.description, "
                        + "owner = new.owner, space_code = new.space_code, status = new.status, editable = new.editable",
                (ps) -> {
                    ps.setString(1, row.id());
                    ps.setString(2, row.name());
                    ps.setString(3, row.description());
                    ps.setString(4, row.owner());
                    ps.setString(5, row.spaceCode());
                    ps.setString(6, row.status());
                    ps.setBoolean(7, row.editable());
                });
    }

    @Override
    public void delete(String projectId) {
        MysqlSchema.ensure(jdbc);
        jdbc.update("DELETE FROM scofen_project WHERE id = ?", projectId);
    }
}
