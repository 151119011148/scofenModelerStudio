package com.scofen.model.web.persistence;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * MySQL 模式的建表脚本。抽成独立类是因为项目目录、模型快照、RBAC 三块表
 * 都要在同一处建，避免多处建表导致 DDL 漂移。
 */
public final class MysqlSchema {

    /** 项目目录：目录元数据与最新 revision 指针共处一行。 */
    static final String PROJECT_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_project (
                id           VARCHAR(64)   NOT NULL,
                name         VARCHAR(255)  NOT NULL DEFAULT '',
                description  VARCHAR(1024) NOT NULL DEFAULT '',
                owner        VARCHAR(128)  NOT NULL DEFAULT '',
                space_code   VARCHAR(32)   NOT NULL DEFAULT 'personal',
                status       VARCHAR(32)   NOT NULL DEFAULT '可打开',
                editable     TINYINT(1)    NOT NULL DEFAULT 1,
                revision     BIGINT        NOT NULL DEFAULT 0,
                created_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (id)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    /** 模型整包快照：按 (project_id, revision) 读写。 */
    static final String SNAPSHOT_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_model_snapshot (
                project_id   VARCHAR(64)  NOT NULL,
                revision     BIGINT       NOT NULL,
                payload      JSON         NOT NULL,
                created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (project_id, revision),
                CONSTRAINT fk_scofen_snapshot_project FOREIGN KEY (project_id)
                    REFERENCES scofen_project (id) ON DELETE CASCADE
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    /** 用户表：口令只存 PBKDF2 哈希，明文永不进库。 */
    static final String USER_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_user (
                username      VARCHAR(64)  NOT NULL,
                display_name  VARCHAR(128) NOT NULL DEFAULT '',
                password_hash VARCHAR(255) NOT NULL DEFAULT '',
                enabled       TINYINT(1)   NOT NULL DEFAULT 1,
                builtin       TINYINT(1)   NOT NULL DEFAULT 0,
                created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                               ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (username)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    /** 角色表：code 稳定，name 是展示名。 */
    static final String ROLE_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_role (
                code        VARCHAR(64)  NOT NULL,
                name        VARCHAR(128) NOT NULL DEFAULT '',
                description VARCHAR(255) NOT NULL DEFAULT '',
                builtin     TINYINT(1)   NOT NULL DEFAULT 0,
                PRIMARY KEY (code)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    /** 用户-角色关联。 */
    static final String USER_ROLE_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_user_role (
                username VARCHAR(64) NOT NULL,
                role_code VARCHAR(64) NOT NULL,
                PRIMARY KEY (username, role_code),
                CONSTRAINT fk_user_role_user FOREIGN KEY (username)
                    REFERENCES scofen_user (username) ON DELETE CASCADE,
                CONSTRAINT fk_user_role_role FOREIGN KEY (role_code)
                    REFERENCES scofen_role (code) ON DELETE CASCADE
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    /** 角色-权限关联；权限码与 Permission 枚举同名。 */
    static final String ROLE_PERMISSION_TABLE = """
            CREATE TABLE IF NOT EXISTS scofen_role_permission (
                role_code  VARCHAR(64) NOT NULL,
                permission VARCHAR(64) NOT NULL,
                PRIMARY KEY (role_code, permission),
                CONSTRAINT fk_role_permission_role FOREIGN KEY (role_code)
                    REFERENCES scofen_role (code) ON DELETE CASCADE
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
            """;

    private static volatile boolean ready = false;

    private MysqlSchema() {
    }

    /** 幂等建表；进程内只执行一次。 */
    public static synchronized void ensure(JdbcTemplate jdbc) {
        if (ready) {
            return;
        }
        for (String ddl : new String[]{PROJECT_TABLE, SNAPSHOT_TABLE, USER_TABLE, ROLE_TABLE,
                USER_ROLE_TABLE, ROLE_PERMISSION_TABLE}) {
            jdbc.execute(ddl);
        }
        ready = true;
    }
}
