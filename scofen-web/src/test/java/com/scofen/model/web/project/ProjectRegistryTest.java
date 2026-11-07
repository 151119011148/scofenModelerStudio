package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.web.persistence.NoopPersistenceServiceFactory;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

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
}
