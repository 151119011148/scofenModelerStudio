package com.scofen.model.web.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.metamodel.ModelSnapshot;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * MySQL 8.4 写穿持久化（{@code scofen.persistence.mode=mysql} 时生效）。
 *
 * <p>沿用 §2.4.1 六表约束：整包 {@link ModelSnapshot} 以 JSON 写入 {@code model_snapshot}
 * 的 {@code (project_id, revision)} 主键，满足「JSON 按 (project_id, revision) 整包读写」。
 * 启动幂等建表（与 V1__init.sql 同源），写穿时同 revision 用 {@code ON DUPLICATE KEY UPDATE} 覆盖，天然幂等。</p>
 *
 * <p>内存态仍是热真本与 WS 广播源；本服务仅在每次 Command 成功 apply 后整包落库，
 * 重启时由 {@code loadLatest()} 回载最新 revision，做到「编辑持久化、重启不丢」。</p>
 */
@Service
@ConditionalOnProperty(name = "scofen.persistence.mode", havingValue = "mysql")
public class MysqlPersistenceService implements PersistenceService {

    /** 单租户演示库固定 project id（BINARY(16) = UUID 16 字节）。 */
    private static final UUID PROJECT_ID = UUID.fromString("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    private static final String[] V1_DDL = {
            """
            CREATE TABLE IF NOT EXISTS project (
                id              BINARY(16)   NOT NULL,
                name            VARCHAR(255) NOT NULL,
                revision        BIGINT       NOT NULL DEFAULT 0,
                editor_lock     VARCHAR(128) NULL,
                created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (id)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """,
            """
            CREATE TABLE IF NOT EXISTS model_snapshot (
                project_id      BINARY(16)   NOT NULL,
                revision        BIGINT       NOT NULL,
                payload         JSON         NOT NULL,
                created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (project_id, revision),
                CONSTRAINT fk_snapshot_project FOREIGN KEY (project_id) REFERENCES project (id)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private volatile boolean schemaReady = false;

    public MysqlPersistenceService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbc = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    @Override
    public String describe() {
        return "MySQL 8.4 (write-through)";
    }

    private void ensureSchema() {
        if (schemaReady) {
            return;
        }
        synchronized (this) {
            if (schemaReady) {
                return;
            }
            for (String ddl : V1_DDL) {
                jdbc.execute(ddl);
            }
            jdbc.update("INSERT IGNORE INTO project (id, name, revision) VALUES (?, 'scofen-demo', 0)",
                    (ps) -> ps.setBytes(1, uuidBytes(PROJECT_ID)));
            schemaReady = true;
        }
    }

    @Override
    public Optional<ModelSnapshot> loadLatest() {
        ensureSchema();
        List<String> rows = jdbc.query(
                "SELECT payload FROM model_snapshot WHERE project_id = ? ORDER BY revision DESC LIMIT 1",
                (ps) -> ps.setBytes(1, uuidBytes(PROJECT_ID)),
                (rs, index) -> rs.getString("payload"));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(rows.get(0), ModelSnapshot.class));
        } catch (Exception ex) {
            throw new IllegalStateException("反序列化模型快照失败", ex);
        }
    }

    @Override
    public void save(ModelSnapshot snapshot) {
        ensureSchema();
        String json;
        try {
            json = objectMapper.writeValueAsString(snapshot);
        } catch (Exception ex) {
            throw new IllegalStateException("序列化模型快照失败", ex);
        }
        jdbc.update(
                "INSERT INTO model_snapshot (project_id, revision, payload) VALUES (?, ?, ?) "
                        + "ON DUPLICATE KEY UPDATE payload = VALUES(payload)",
                (ps) -> {
                    ps.setBytes(1, uuidBytes(PROJECT_ID));
                    ps.setLong(2, snapshot.revision());
                    ps.setString(3, json);
                });
    }

    private static byte[] uuidBytes(UUID uuid) {
        ByteBuffer buffer = ByteBuffer.wrap(new byte[16]);
        buffer.putLong(uuid.getMostSignificantBits());
        buffer.putLong(uuid.getLeastSignificantBits());
        return buffer.array();
    }
}
