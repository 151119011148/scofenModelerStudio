package com.scofen.model.web.persistence;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.metamodel.ModelSnapshot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用真实 MySQL 8.4 容器验证「编辑持久化」：种子落库 → 回载一致 → 改名后回载反映新值。
 * 依赖 Docker；无 Docker 时 {@link Testcontainers#disabledWithoutDocker()} 自动跳过，不破坏主构建。
 *
 * <p>用 {@link DynamicPropertySource} 把容器连接信息写入 {@code spring.datasource.*}，
 * 由 {@link PersistenceConfig#scofenDataSource} 据此装配唯一 DataSource（避免与
 * 被排除的 {@code DataSourceAutoConfiguration} 冲突，也不会产生重复 DataSource bean）。</p>
 */
@SpringBootTest(properties = "scofen.persistence.mode=mysql")
@Testcontainers(disabledWithoutDocker = true)
class MysqlPersistenceIntegrationTest {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>(
            DockerImageName.parse("mysql:8.4")).withDatabaseName("scofen");

    @DynamicPropertySource
    static void scofenDatasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.datasource.driver-class-name", MYSQL::getDriverClassName);
    }

    @Autowired
    private PersistenceService persistence;

    @Autowired
    private CommandExecutor executor;

    @Test
    void seedsAndReloadsSnapshotFromMysql() {
        assertThat(persistence.isEnabled()).isTrue();

        ModelSnapshot live = executor.snapshot();
        Optional<ModelSnapshot> reloaded = persistence.loadLatest();

        assertThat(reloaded).isPresent();
        assertThat(reloaded.get().revision()).isEqualTo(live.revision());
        assertThat(reloaded.get().elements()).hasSameSizeAs(live.elements());
        assertThat(reloaded.get().diagrams()).hasSize(9);

        String vcuName = live.elements().stream()
                .filter(e -> "e-vcu".equals(e.id())).findFirst().orElseThrow().name();
        assertThat(reloaded.get().elements()).anyMatch(e -> "e-vcu".equals(e.id()) && vcuName.equals(e.name()));
    }

    @Test
    void editIsPersistedAndVisibleAfterReload() {
        long before = executor.revision();
        executor.execute("it-session",
                com.scofen.model.core.Command.of("RENAME_ELEMENT", before, "it-rename",
                        java.util.Map.of("id", "e-vcu", "name", "整车控制器(持久化验证)")));

        Optional<ModelSnapshot> reloaded = persistence.loadLatest();
        assertThat(reloaded).isPresent();
        assertThat(reloaded.get().revision()).isGreaterThan(before);
        assertThat(reloaded.get().elements())
                .anyMatch(e -> "e-vcu".equals(e.id()) && "整车控制器(持久化验证)".equals(e.name()));
    }
}
