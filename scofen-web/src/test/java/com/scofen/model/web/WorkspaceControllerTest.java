package com.scofen.model.web;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.web.persistence.PersistenceServiceFactory;
import com.scofen.model.web.project.ProjectRegistry;
import com.scofen.model.web.workspace.WorkspaceController;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 个人 / 团队空间目录、当前项目实时统计与新建项目的服务端契约。 */
class WorkspaceControllerTest {

    private WorkspaceController controller;
    private CommandExecutor executor;

    @BeforeEach
    void setUp() {
        PatchBroker broker = new PatchBroker(new PatchWebSocketHandler());
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker);
        controller = new WorkspaceController(new WorkspaceDirectory(), executor);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> spaces() {
        return (List<Map<String, Object>>) controller.directory().get("spaces");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> projects(int spaceIndex) {
        return (List<Map<String, Object>>) spaces().get(spaceIndex).get("projects");
    }

    @Test
    void directoryContainsPersonalAndTeamSpacesWithProjectLists() {
        assertThat(spaces()).extracting(space -> space.get("code"))
                .containsExactly("personal", "team");
        assertThat(spaces()).allSatisfy(space ->
                assertThat((List<?>) space.get("projects")).isNotEmpty());
        assertThat(controller.directory()).containsEntry("currentProjectId", "project-vehicle");
        assertThat(projects(0)).filteredOn(project -> Boolean.TRUE.equals(project.get("current")))
                .singleElement()
                .satisfies(project -> assertThat(project).containsEntry("editable", true));
    }

    @Test
    void currentProjectStatisticsComeFromLiveModelSnapshot() {
        executor.execute("test", Command.of("CREATE_ELEMENT", 0L, "c-1",
                Map.of("id", "model-root", "type", "Package", "name", "实时项目", "ownerId", "")));
        executor.execute("test", Command.of("CREATE_DIAGRAM", 1L, "c-2",
                Map.of("id", "d-pkg", "kind", "pkg", "name", "包图", "elementIds", List.of())));

        assertThat(controller.directory()).containsEntry("currentProjectName", "实时项目");
        Map<String, Object> current = projects(0).stream()
                .filter(project -> Boolean.TRUE.equals(project.get("current")))
                .findFirst().orElseThrow();
        assertThat(current)
                .containsEntry("name", "实时项目")
                .containsEntry("elementCount", 1)
                .containsEntry("diagramCount", 1)
                .containsEntry("revision", 2L);
    }

    @Test
    void createProjectAddsDirectoryItemAndRejectsDuplicateNames() {
        Map<String, Object> created = controller.createProject(
                Map.of("spaceCode", "team", "name", "制动系统模型", "description", "接口基线"));
        assertThat(created).containsEntry("name", "制动系统模型").containsEntry("spaceCode", "team");

        Map<String, Object> team = spaces().get(1);
        assertThat(team).containsEntry("projectCount", 4);
        assertThat(projects(1)).extracting(project -> project.get("name")).contains("制动系统模型");

        assertThatThrownBy(() -> controller.createProject(
                Map.of("spaceCode", "team", "name", "制动系统模型")))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.createProject(
                Map.of("spaceCode", "unknown", "name", "未知空间项目")))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void deleteProjectRemovesDirectoryItemAndRejectsUnknownId() {
        Map<String, Object> created = controller.createProject(
                Map.of("spaceCode", "team", "name", "待删项目", "description", "临时"));
        String id = (String) created.get("id");
        assertThat(projects(1)).extracting(project -> project.get("id")).contains(id);

        Map<String, Object> removed = controller.deleteProject(id);
        assertThat(removed).containsEntry("id", id).containsEntry("spaceCode", "team");
        // 目录项消失、空间计数同步回落
        assertThat(projects(1)).extracting(project -> project.get("id")).doesNotContain(id);
        assertThat(spaces().get(1)).containsEntry("projectCount", 3);

        assertThatThrownBy(() -> controller.deleteProject(id))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value())
                        .isEqualTo(404));
    }

    @Test
    void primarySampleProjectIsProtectedFromDeletion() {
        assertThatThrownBy(() -> controller.deleteProject(WorkspaceDirectory.CURRENT_PROJECT_ID))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value())
                        .isEqualTo(400));
        assertThat(projects(0)).extracting(project -> project.get("id"))
                .contains(WorkspaceDirectory.CURRENT_PROJECT_ID);
    }

    @Test
    void deleteProjectRemovesRuntimeFromRegistry() {
        PatchBroker broker = new PatchBroker(new PatchWebSocketHandler());
        WorkspaceDirectory scopedDirectory = new WorkspaceDirectory();
        ProjectRegistry registry = new ProjectRegistry(
                executor, broker, scopedDirectory,
                new PersistenceServiceFactory() {
                    @Override
                    public boolean enabled() {
                        return false;
                    }

                    @Override
                    public com.scofen.model.core.PersistenceService forProject(String projectId) {
                        return new com.scofen.model.core.NoopPersistenceService();
                    }
                });
        WorkspaceController scoped = new WorkspaceController(scopedDirectory, executor);
        scoped.setProjectRegistry(registry);

        Map<String, Object> created = scoped.createProject(
                Map.of("spaceCode", "personal", "name", "运行时待删"));
        String id = (String) created.get("id");
        assertThat(registry.resolve(id)).isNotNull();
        assertThat(registry.isOpened(id)).isTrue();

        assertThat(scoped.deleteProject(id)).containsEntry("runtimeDropped", true);
        assertThat(registry.isOpened(id)).isFalse();
    }
}
