-- Scofen Modeler Studio / MySQL 8.4 LTS
-- §2.4.1 六条建表约束：JSON 按 (project_id, revision) 整包读写；uuidv7 存 BINARY(16)；
-- DDL 隐式提交故 Flyway 脚本单向幂等；命名唯一性在 Java 规则引擎判定（默认 utf8mb4_0900_ai_ci 不区分大小写/重音）；
-- revision CAS 用 UPDATE ... WHERE revision = ? + affected rows（MySQL 无 RETURNING）；RR 默认隔离下保持短事务。

CREATE TABLE IF NOT EXISTS project (
    id              BINARY(16)   NOT NULL,
    name            VARCHAR(255) NOT NULL,
    revision        BIGINT       NOT NULL DEFAULT 0,
    editor_lock     VARCHAR(128) NULL,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS model_snapshot (
    project_id      BINARY(16)   NOT NULL,
    revision        BIGINT       NOT NULL,
    payload         JSON         NOT NULL,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (project_id, revision),
    CONSTRAINT fk_snapshot_project FOREIGN KEY (project_id) REFERENCES project (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS model_element (
    project_id      BINARY(16)   NOT NULL,
    element_id      VARCHAR(64)  NOT NULL,
    element_type    VARCHAR(128) NOT NULL,
    name            VARCHAR(512) NOT NULL,
    owner_id        VARCHAR(64)  NULL,
    name_norm       VARCHAR(512) GENERATED ALWAYS AS (LOWER(name)) STORED,
    PRIMARY KEY (project_id, element_id),
    KEY idx_element_owner (project_id, owner_id),
    KEY idx_element_name (project_id, name_norm),
    CONSTRAINT fk_element_project FOREIGN KEY (project_id) REFERENCES project (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS trace_index (
    project_id      BINARY(16)   NOT NULL,
    requirement_id  VARCHAR(64)  NOT NULL,
    design_id       VARCHAR(64)  NOT NULL,
    relation_type   VARCHAR(64)  NOT NULL,
    verification    VARCHAR(255) NULL,
    PRIMARY KEY (project_id, requirement_id, design_id, relation_type),
    KEY idx_trace_design (project_id, design_id),
    CONSTRAINT fk_trace_project FOREIGN KEY (project_id) REFERENCES project (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS command_log (
    project_id      BINARY(16)   NOT NULL,
    seq             BIGINT       NOT NULL,
    client_cmd_id   VARCHAR(128) NOT NULL,
    command_type    VARCHAR(64)  NOT NULL,
    payload         JSON         NOT NULL,
    affected_ids    JSON         NULL,
    inverse         JSON         NULL,
    actor           VARCHAR(128) NOT NULL,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (project_id, seq),
    UNIQUE KEY uk_client_cmd (project_id, client_cmd_id),
    CONSTRAINT fk_command_project FOREIGN KEY (project_id) REFERENCES project (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
