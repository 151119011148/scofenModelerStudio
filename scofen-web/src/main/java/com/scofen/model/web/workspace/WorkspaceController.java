package com.scofen.model.web.workspace;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.auth.AuthController;
import com.scofen.model.web.auth.AuthService.Principal;
import com.scofen.model.web.project.ProjectAccess;
import com.scofen.model.web.project.ProjectRegistry;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.rbac.RequiresPermission;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestAttribute;
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
    private ProjectAccess access;
    private PatchWebSocketHandler sockets;

    public WorkspaceController(WorkspaceDirectory directory, CommandExecutor executor) {
        this.directory = directory;
        this.executor = executor;
    }

    @Autowired
    public void setProjectRegistry(ProjectRegistry projects) {
        this.projects = projects;
    }

    @Autowired
    void setProjectAccess(ProjectAccess access, PatchWebSocketHandler sockets) {
        this.access = access;
        this.sockets = sockets;
    }

    /** 兼容直接调用（单元测试）：默认打开主示例项目。 */
    public Map<String, Object> directory() {
        return directory("");
    }

    public Map<String, Object> directory(String activeProjectId) {
        return directory(activeProjectId, null);
    }

    @GetMapping
    @RequiresPermission(Permission.MODEL_VIEW)
    public Map<String, Object> directory(
            @RequestHeader(value = ProjectAccess.HEADER, defaultValue = "") String activeProjectId,
            @RequestAttribute(AuthController.PRINCIPAL_ATTRIBUTE) Principal principal) {
        String active = ProjectAccess.projectId(activeProjectId);
        if (directory.findProject(active).isEmpty() || (access != null && !access.grant(active, principal).canView())) {
            active = access == null ? WorkspaceDirectory.CURRENT_PROJECT_ID : directory.spaces().stream()
                    .flatMap(space -> directory.projects(space.code()).stream())
                    .map(WorkspaceDirectory.Project::id).filter(id -> access.grant(id, principal).canView())
                    .findFirst().orElse("");
        }
        CommandExecutor activeExecutor = active.isBlank() ? null : projects == null ? executor : projects.resolve(active);
        String rootName = activeExecutor == null ? "" : rootName(activeExecutor.snapshot());

        List<Map<String, Object>> spaces = new ArrayList<>();
        for (WorkspaceDirectory.Space space : directory.spaces()) {
            List<Map<String, Object>> projectRows = new ArrayList<>();
            for (WorkspaceDirectory.Project project : directory.projects(space.code())) {
                ProjectAccess.Grant grant = access == null ? null : access.grant(project.id(), principal);
                if (grant != null && !grant.canView()) continue;
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
                row.put("editable", grant == null || grant.canEdit());
                if (grant != null) row.put("grant", grant);
                // 主示例项目是目录为空 / 当前项目失效时的回退目标，服务端拒绝删除；
                // 由服务端下发 deletable，前端据此决定是否显示删除入口，避免「点了一定失败」。
                row.put("deletable", !WorkspaceDirectory.CURRENT_PROJECT_ID.equals(project.id())
                        && (grant == null || grant.canManage()));
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
        result.put("note", "仅显示有访问权限的项目");
        return result;
    }

    /** 在空间下新建项目目录项；创建后前端会立即打开它。 */
    public Map<String, Object> createProject(Map<String, Object> body) {
        return createProject(body, null);
    }

    @PostMapping("/projects")
    @RequiresPermission(Permission.PROJECT_CREATE)
    public Map<String, Object> createProject(@RequestBody Map<String, Object> body,
            @RequestAttribute(AuthController.PRINCIPAL_ATTRIBUTE) Principal principal) {
        String spaceCode = text(body.get("spaceCode"));
        String name = text(body.get("name"));
        String description = text(body.get("description"));
        try {
            String space = spaceCode.isEmpty() ? WorkspaceDirectory.PERSONAL : spaceCode;
            WorkspaceDirectory.Project project = principal == null ? directory.addProject(space, name, description)
                    : directory.addProject(space, name, description, principal.username());
            return Map.of(
                    "id", project.id(),
                    "name", project.name(),
                    "spaceCode", project.spaceCode());
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    /** 删除项目：目录项卸载 + 运行时丢弃；落库快照由外键级联清理。 */
    public Map<String, Object> deleteProject(String id) {
        return deleteProject(id, null);
    }

    @DeleteMapping("/projects/{id}")
    @RequiresPermission(Permission.MODEL_VIEW)
    public Map<String, Object> deleteProject(@PathVariable("id") String id,
            @RequestAttribute(AuthController.PRINCIPAL_ATTRIBUTE) Principal principal) {
        if (access != null && !access.grant(id, principal).canManage()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅项目负责人可删除项目");
        }
        if (id == null || id.isBlank() || directory.findProject(id).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在：" + id);
        }
        try {
            WorkspaceDirectory.Project removed = directory.removeProject(id);
            boolean runtimeDropped = projects != null && projects.remove(id);
            if (access != null) access.forget(id);
            if (sockets != null) sockets.projectRecordsChanged(id);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", removed.id());
            result.put("name", removed.name());
            result.put("spaceCode", removed.spaceCode());
            result.put("runtimeDropped", runtimeDropped);
            return result;
        } catch (IllegalArgumentException ex) {
            // 主示例项目受保护：它是目录为空 / 当前项目失效时的回退目标。
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
