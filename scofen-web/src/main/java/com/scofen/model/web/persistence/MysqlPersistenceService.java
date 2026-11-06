package com.scofen.model.web.persistence;

import com.scofen.model.core.PersistenceService;
import com.scofen.model.core.SnapshotCodec;
import com.scofen.model.metamodel.ModelSnapshot;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;

/**
 * MySQL 8.x 写穿持久化（{@code scofen.persistence.mode=mysql} 时生效），<b>一项目一实例</b>。
 *
 * <p>沿用「JSON 按 (project_id, revision) 整包读写」约束：整包 {@link ModelSnapshot}
 * 以 JSON 写入 {@code scofen_model_snapshot} 的 {@code (project_id, revision)} 主键。
 * 启动幂等建表，写穿时同 revision 覆盖（天然幂等）。</p>
 *
 * <p>内存态仍是热真本与 WS 广播源；本服务仅在每次 Command 成功 apply 后整包落库，
 * 重启时由 {@code loadLatest()} 回载最新 revision，做到「编辑持久化、重启不丢」。</p>
 *
 * <p><b>快照保留窗口</b>：整包 JSON 每次编辑都写一份，revision 会不断增长。
 * 因此保留每个项目最近 N 个 revision 的快照（默认 100），更早的整包删除；
 * 留窗口的意义是留出「回退到前一版」的余地，而不是无限膨胀。</p>
 */
public class MysqlPersistenceService implements PersistenceService {

    private final JdbcTemplate jdbc;
    private final String projectId;
    private final int retention;

    public MysqlPersistenceService(JdbcTemplate jdbcTemplate, String projectId, int retention) {
        this.jdbc = jdbcTemplate;
        this.projectId = projectId == null ? "" : projectId;
        this.retention = Math.max(1, retention);
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    @Override
    public String projectId() {
        return projectId;
    }

    @Override
    public String describe() {
        return "MySQL 8.x (write-through)";
    }

    /** 幂等建表；进程内只执行一次。 */
    void ensureSchema() {
        MysqlSchema.ensure(jdbc);
    }

    @Override
    public Optional<ModelSnapshot> loadLatest() {
        ensureSchema();
        List<String> rows = jdbc.query(
                "SELECT payload FROM scofen_model_snapshot WHERE project_id = ? ORDER BY revision DESC LIMIT 1",
                (ps) -> ps.setString(1, projectId),
                (rs, index) -> rs.getString("payload"));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(SnapshotCodec.fromJson(rows.get(0)));
        } catch (RuntimeException ex) {
            throw new IllegalStateException("反序列化模型快照失败（project=" + projectId + "）", ex);
        }
    }

    @Override
    public void save(ModelSnapshot snapshot) {
        ensureSchema();
        String json = SnapshotCodec.toJson(snapshot);
        // 项目行可能尚未建立（目录尚未落库），用 GREATEST 保证 revision 单调不回退。
        // name 留空：项目名称由目录存储负责，这里不覆盖。
        jdbc.update("INSERT INTO scofen_project (id, name, revision) VALUES (?, '', ?) "
                        + "ON DUPLICATE KEY UPDATE revision = GREATEST(revision, VALUES(revision))",
                (ps) -> {
                    ps.setString(1, projectId);
                    ps.setLong(2, snapshot.revision());
                });
        jdbc.update("INSERT INTO scofen_model_snapshot (project_id, revision, payload) VALUES (?, ?, ?) "
                        + "AS new ON DUPLICATE KEY UPDATE payload = new.payload",
                (ps) -> {
                    ps.setString(1, projectId);
                    ps.setLong(2, snapshot.revision());
                    ps.setString(3, json);
                });
        trimOldSnapshots();
    }

    /** 只保留最近 retention 个 revision 的整包快照，早于窗口的一律删除。 */
    private void trimOldSnapshots() {
        jdbc.update("DELETE FROM scofen_model_snapshot WHERE project_id = ? AND revision <= ("
                        + "SELECT cutoff FROM (SELECT revision AS cutoff FROM scofen_model_snapshot "
                        + "WHERE project_id = ? ORDER BY revision DESC LIMIT 1 OFFSET ?) t)",
                (ps) -> {
                    ps.setString(1, projectId);
                    ps.setString(2, projectId);
                    ps.setInt(3, retention);
                });
    }
}
