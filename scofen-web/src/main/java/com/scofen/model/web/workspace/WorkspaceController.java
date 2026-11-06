package com.scofen.model.web.workspace;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.project.ProjectRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.rbac.RequiresPermission;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 空间 / 项目目录接口：项目可打开，统计来自各自的服务端模型快照。 */
@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceDirectory directory;
    private final CommandExecutor executor;
    /** 单元测试可直接构造本类而不注入 registry；Spring 运行时由 setter 注入。 */
    private ProjectRegistry projects;

    public WorkspaceController(WorkspaceDirectory directory, CommandExecutor executor) {
        this.directory = directory;
        this.executor = executor;
    }

    @Autowired
    public void setProjectRegistry(ProjectRegistry projects) {
        this.projects = projects;
    }

    /** 兼容直接调用（单元测试）：默认打开主示例项目。 */
    public Map<String, Object> directory() {
        return directory("");
    }

    @GetMapping
    @RequiresPermission(Permission.MODEL_VIEW)
    public Map<String, Object> directory(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String activeProjectId) {
        String active = (activeProjectId == null || activeProjectId.isBlank())
                ? WorkspaceDirectory.CURRENT_PROJECT_ID : activeProjectId;
        // 前端可能带着上一轮会话里已被删除的目录项，回退到主示例项目，避免创建野运行时。
        if (directory.findProject(active).isEmpty()) {
            active = WorkspaceDirectory.CURRENT_PROJECT_ID;
        }
        CommandExecutor activeExecutor = projects == null ? executor : projects.resolve(active);
        ModelSnapshot activeSnapshot = activeExecutor.snapshot();
        String rootName = rootName(activeSnapshot);

        List<Map<String, Object>> spaces = new ArrayList<>();
        for (WorkspaceDirectory.Space space : directory.spaces()) {
            List<Map<String, Object>> projectRows = new ArrayList<>();
            for (WorkspaceDirectory.Project project : directory.projects(space.code())) {
                boolean isActive = project.id().equals(active);
                CommandExecutor runtime = isActive ? activeExecutor
                        : (projects == null ? null : projects.peek(project.id()));
                ModelSnapshot snapshot = runtime == null ? null : runtime.snapshot();
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", project.id());
                // 项目名与该项目模型树的项目根保持同步（改名后目录随之更新）。
                row.put("name", snapshot == null ? project.name() : rootName(snapshot));
                row.put("description", project.description());
                row.put("owner", project.owner());
                row.put("updatedAt", project.updatedAt());
                row.put("status", isActive ? "编辑中" : project.status());
                row.put("current", isActive);
                row.put("editable", true);
                row.put("opened", runtime != null);
                row.put("spaceCode", project.spaceCode());
                row.put("diagramCount", snapshot == null ? 0 : snapshot.diagrams().size());
                row.put("elementCount", snapshot == null ? 0 : snapshot.elements().size());
                row.put("relationshipCount", snapshot == null ? 0 : snapshot.relationships().size());
                row.put("revision", snapshot == null ? 0 : snapshot.revision());
                projectRows.add(row);
            }
            Map<String, Object> spaceRow = new LinkedHashMap<>();
            spaceRow.put("code", space.code());
            spaceRow.put("label", space.label());
            spaceRow.put("kind", space.kind());
            spaceRow.put("owner", space.owner());
            spaceRow.put("memberCount", space.memberCount());
            spaceRow.put("projectCount", projectRows.size());
            spaceRow.put("projects", projectRows);
            spaces.add(spaceRow);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("currentProjectId", active);
        result.put("currentProjectName", rootName);
        result.put("spaces", spaces);
        result.put("note", "M0：项目模型为内存态，点击项目即可打开编辑；重启服务后回到初始基线。");
        return result;
    }

    /** 在空间下新建项目目录项；创建后前端会立即打开它。 */
    @PostMapping("/projects")
    @RequiresPermission(Permission.PROJECT_CREATE)
    public Map<String, Object> createProject(@RequestBody Map<String, Object> body) {
        String spaceCode = text(body.get("spaceCode"));
        String name = text(body.get("name"));
        String description = text(body.get("description"));
        try {
            WorkspaceDirectory.Project project = directory.addProject(
                    spaceCode.isEmpty() ? WorkspaceDirectory.PERSONAL : spaceCode,
                    name, description);
            return Map.of(
                    "id", project.id(),
                    "name", project.name(),
                    "spaceCode", project.spaceCode());
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    private static String rootName(ModelSnapshot snapshot) {
        return snapshot.elements().stream()
                .filter(element -> element.ownerId() == null || element.ownerId().isBlank())
                .findFirst()
                .map(ModelElement::name)
                .orElse("未命名项目");
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString();
    }
}
