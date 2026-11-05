package com.scofen.model.web.workspace;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 空间 / 项目目录接口：前端左侧导航的数据来源，不在前端硬编码项目清单。 */
@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceDirectory directory;
    private final CommandExecutor executor;

    public WorkspaceController(WorkspaceDirectory directory, CommandExecutor executor) {
        this.directory = directory;
        this.executor = executor;
    }

    @GetMapping
    public Map<String, Object> directory() {
        ModelSnapshot snapshot = executor.snapshot();
        String rootName = snapshot.elements().stream()
                .filter(element -> element.ownerId() == null || element.ownerId().isBlank())
                .findFirst()
                .map(ModelElement::name)
                .orElse("未命名项目");

        List<Map<String, Object>> spaces = new ArrayList<>();
        for (WorkspaceDirectory.Space space : directory.spaces()) {
            List<Map<String, Object>> projectRows = new ArrayList<>();
            for (WorkspaceDirectory.Project project : directory.projects(space.code())) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", project.id());
                // 当前项目名与模型树的项目根保持同步（改名后空间栏随之更新）。
                row.put("name", project.current() ? rootName : project.name());
                row.put("description", project.description());
                row.put("owner", project.owner());
                row.put("updatedAt", project.updatedAt());
                row.put("status", project.status());
                row.put("current", project.current());
                row.put("editable", project.editable());
                row.put("spaceCode", project.spaceCode());
                row.put("diagramCount", project.current() ? snapshot.diagrams().size() : 0);
                row.put("elementCount", project.current() ? snapshot.elements().size() : 0);
                row.put("relationshipCount", project.current() ? snapshot.relationships().size() : 0);
                row.put("revision", project.current() ? snapshot.revision() : 0);
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
        result.put("currentProjectId", WorkspaceDirectory.CURRENT_PROJECT_ID);
        result.put("currentProjectName", rootName);
        result.put("spaces", spaces);
        result.put("note", "M0：仅当前项目接入服务端模型，其余为目录项（暂不可编辑）");
        return result;
    }

    /** 在空间下新建项目目录项；创建后可立即在左侧导航看到。 */
    @PostMapping("/projects")
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

    private static String text(Object value) {
        return value == null ? "" : value.toString();
    }
}
