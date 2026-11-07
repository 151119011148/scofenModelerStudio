package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.core.ProjectRoot;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.persistence.NoopPersistenceServiceFactory;
import com.scofen.model.web.persistence.PersistenceServiceFactory;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 打开项目 = 拿到一份独立的内存态模型运行时，互不串写。 */
class ProjectRegistryTest {

    private CommandExecutor primary;
    private ProjectRegistry registry;

    @BeforeEach
    void setUp() {
        PatchBroker broker = new PatchBroker(new PatchWebSocketHandler());
        primary = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker);
        registry = new ProjectRegistry(primary, broker, new WorkspaceDirectory(),
                new NoopPersistenceServiceFactory());
    }

    @Test
    void primaryProjectKeepsItsOwnExecutor() {
        assertThat(registry.resolve("")).isSameAs(primary);
        assertThat(registry.resolve(WorkspaceDirectory.CURRENT_PROJECT_ID)).isSameAs(primary);
    }

    @Test
    void openingOtherProjectSeedsPackageRootAndNineEmptyDiagrams() {
        CommandExecutor opened = registry.resolve("project-req");
        assertThat(opened).isNotSameAs(primary);
        // 项目根 + 通用扩展包（SysML / UML 的元类与构造型）
        assertThat(opened.snapshot().elements()).hasSize(1 + ExtensionLibrary.size());
        assertThat(opened.snapshot().elements().get(0).name()).isEqualTo("需求工程样例");
        assertThat(opened.snapshot().elements().get(0).type()).isEqualTo("Package");
        assertThat(opened.snapshot().elements().get(0).ownerId()).isNull();
        assertThat(opened.snapshot().elements()).extracting(ModelElement::id)
                .contains(ExtensionLibrary.SYSML_PROFILE_ID, ExtensionLibrary.UML_PROFILE_ID);
        assertThat(opened.snapshot().diagrams()).hasSize(9);
        assertThat(registry.isOpened("project-req")).isTrue();
        assertThat(registry.resolve("project-req")).isSameAs(opened);
    }

    @Test
    void writesAreIsolatedBetweenProjects() {
        CommandExecutor other = registry.resolve("project-req");
        long before = other.revision();
        other.execute("session-1", Command.of("CREATE_ELEMENT", before, "c-1",
                Map.of("id", "e-isolated", "type", "Package", "name", "只属于这个项目",
                        "ownerId", "model-root", "stereotypes", List.of("package"))));
        assertThat(other.snapshot().elements()).hasSize(2 + ExtensionLibrary.size());
        assertThat(primary.snapshot().elements()).isEmpty();
        assertThat(primary.revision()).isZero();
    }

    @Test
    void peekingDoesNotCreateRuntime() {
        assertThat(registry.peek("project-eea")).isNull();
        assertThat(registry.isOpened("project-eea")).isFalse();
    }

    @Test
    void unknownProjectIdIsRejectedInsteadOfCreatingWildRuntime() {
        // 已删项目 / 手改的旧项目头：不能凭空造运行时，否则删掉的项目会复活。
        assertThatThrownBy(() -> registry.resolve("project-deleted-xyz"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value())
                        .isEqualTo(404));
        assertThat(registry.isOpened("project-deleted-xyz")).isFalse();
        assertThat(registry.peek("project-deleted-xyz")).isNull();
    }

    /**
     * 存量项目补齐：老快照只带两个 Profile，打开项目时应把升级后新增的
     * 原始类型库 / 值类型库 / 单位量纲库 / 标准构造型库补进去，并重写一次快照。
     *
     * <p>线上库里的项目是上一个版本建的，若没有这一步，用户升级后仍然见不到
     * {@code String} 这类原始类型——「枚举 + String 值类型」会再次断链。</p>
     */
    @Test
    void openingLegacyProjectBackfillsLibrariesAddedByNewerVersions() {
        ModelElement legacyRoot = new ModelElement(ProjectRoot.ID, ProjectRoot.TYPE_CODE, "旧项目",
                List.of("package"), null, "", Map.of(), null, Map.of());
        ModelElement legacySysml = new ModelElement(ExtensionLibrary.SYSML_PROFILE_ID, "PROFILE",
                "SysML 扩展包", List.of("profile"), ProjectRoot.ID, "", Map.of(), null, Map.of());
        ModelSnapshot legacy = new ModelSnapshot(7L, List.of(legacyRoot, legacySysml),
                List.of(), List.of(), List.of());

        AtomicReference<ModelSnapshot> saved = new AtomicReference<>();
        PersistenceService persistence = new PersistenceService() {
            @Override
            public boolean isEnabled() {
                return true;
            }

            @Override
            public String projectId() {
                return "project-req";
            }

            @Override
            public Optional<ModelSnapshot> loadLatest() {
                return Optional.of(legacy);
            }

            @Override
            public void save(ModelSnapshot snapshot) {
                saved.set(snapshot);
            }
        };
        PersistenceServiceFactory factory = new PersistenceServiceFactory() {
            @Override
            public boolean enabled() {
                return true;
            }

            @Override
            public PersistenceService forProject(String projectId) {
                return persistence;
            }
        };
        PatchBroker broker = new PatchBroker(new PatchWebSocketHandler());
        ProjectRegistry persistent = new ProjectRegistry(primary, broker, new WorkspaceDirectory(), factory);

        CommandExecutor opened = persistent.resolve("project-req");

        assertThat(opened.snapshot().elements()).extracting(ModelElement::id)
                .contains(ExtensionLibrary.PRIMITIVE_LIBRARY_ID, ExtensionLibrary.VALUE_LIBRARY_ID,
                        ExtensionLibrary.UNITS_LIBRARY_ID, ExtensionLibrary.STANDARD_PROFILE_ID,
                        "prim-String", "unit-kilogram");
        // 老快照里的内容不能被覆盖掉。
        assertThat(opened.snapshot().elements()).extracting(ModelElement::id)
                .contains(ProjectRoot.ID, ExtensionLibrary.SYSML_PROFILE_ID);
        // 老快照已有 1 个 Profile，只补缺的那些，数量正好等于「根 + 完整扩展包」。
        assertThat(opened.snapshot().elements()).hasSize(1 + ExtensionLibrary.size());
        assertThat(saved.get()).as("补齐后应重写一次快照").isNotNull();
        assertThat(saved.get().revision()).isGreaterThan(7L);
    }
}
