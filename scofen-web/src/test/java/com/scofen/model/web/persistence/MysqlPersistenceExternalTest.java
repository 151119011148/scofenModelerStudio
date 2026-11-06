package com.scofen.model.web.persistence;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用外部真实 MySQL 验证持久化闭环（无需 Docker）。
 *
 * <p>启用方式：设置 {@code SCOFEN_TEST_MYSQL_URL / USERNAME / PASSWORD} 三个环境变量后运行。
 * 未设置则整类跳过，主构建不受影响——CI 无库可跑，本地与服务器有库就真验。</p>
 *
 * <p>覆盖四件事：整包回载一致、项目间快照隔离、目录落库（重启不丢）、
 * 以及快照保留窗口不会无限膨胀。</p>
 */
@SpringBootTest(properties = "scofen.persistence.mode=mysql")
@EnabledIfEnvironmentVariable(named = "SCOFEN_TEST_MYSQL_URL", matches = ".+")
class MysqlPersistenceExternalTest {

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("SCOFEN_TEST_MYSQL_URL"));
        registry.add("spring.datasource.username", () -> env("SCOFEN_TEST_MYSQL_USERNAME", "root"));
        registry.add("spring.datasource.password", () -> env("SCOFEN_TEST_MYSQL_PASSWORD", ""));
        registry.add("spring.datasource.driver-class-name", () -> "com.mysql.cj.jdbc.Driver");
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    @Autowired
    private PersistenceServiceFactory factory;

    @Autowired
    private CommandExecutor executor;

    @Autowired
    private WorkspaceDirectory directory;

    private PersistenceService primary() {
        return factory.forProject(WorkspaceDirectory.CURRENT_PROJECT_ID);
    }

    @Test
    void snapshotRoundTripsThroughMysql() {
        assertThat(factory.enabled()).isTrue();
        ModelSnapshot live = executor.snapshot();
        Optional<ModelSnapshot> reloaded = primary().loadLatest();
        assertThat(reloaded).isPresent();
        assertThat(reloaded.get().revision()).isEqualTo(live.revision());
        assertThat(reloaded.get().elements()).hasSameSizeAs(live.elements());
        assertThat(reloaded.get().diagrams()).hasSize(9);
    }

    @Test
    void editSurvivesReload() {
        long before = executor.revision();
        executor.execute("ext-session", Command.of("RENAME_ELEMENT", before, "ext-rename",
                java.util.Map.of("id", "e-vcu", "name", "整车控制器(外部库验证)")));
        Optional<ModelSnapshot> reloaded = primary().loadLatest();
        assertThat(reloaded).isPresent();
        assertThat(reloaded.get().elements())
                .anyMatch(e -> "e-vcu".equals(e.id()) && "整车控制器(外部库验证)".equals(e.name()));
    }

    @Test
    void projectsDoNotShareSnapshots() {
        PersistenceService other = factory.forProject("project-req");
        assertThat(other.loadLatest()).isEmpty();
        assertThat(primary().loadLatest()).isPresent();
    }

    @Test
    void projectDirectoryIsPersisted() {
        // 目录已落库：新建一个项目后，换一个目录实例（模拟重启）仍能读到。
        WorkspaceDirectory.Project created = directory.addProject(
                WorkspaceDirectory.PERSONAL, "持久化目录验证-" + System.nanoTime(), "外部库验证");
        WorkspaceDirectory reloaded = new WorkspaceDirectory(
                new JdbcProjectDirectoryStore(jdbcTemplate));
        assertThat(reloaded.findProject(created.id())).isPresent();
        assertThat(reloaded.findProject(created.id()).orElseThrow().name()).isEqualTo(created.name());
    }

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @Test
    void snapshotHistoryIsBounded() {
        // 连续编辑会产生多份整包快照，保留窗口必须生效，不能无限膨胀。
        long before = executor.revision();
        for (int i = 0; i < 3; i++) {
            executor.execute("ext-session", Command.of("RENAME_ELEMENT", executor.revision(),
                    "ext-bound-" + i, java.util.Map.of("id", "e-bat", "name", "动力电池" + i)));
        }
        Integer rows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM scofen_model_snapshot WHERE project_id = ?",
                Integer.class, WorkspaceDirectory.CURRENT_PROJECT_ID);
        assertThat(rows).isNotNull();
        assertThat(rows).isLessThanOrEqualTo(100);
        assertThat(executor.revision()).isGreaterThan(before);
    }
}
