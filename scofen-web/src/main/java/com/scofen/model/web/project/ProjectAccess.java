package com.scofen.model.web.project;

import com.scofen.model.web.auth.AuthService.Principal;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Component
public final class ProjectAccess {
    public static final String HEADER = "X-Scofen-Project";
    private static final String MEMBER = "member";
    private static final Set<String> ROLES = Set.of("owner", "editor", "reviewer", "viewer");

    public record Member(String username, String role, boolean inherited) {}
    public record Grant(String role, boolean canView, boolean canEdit, boolean canImport,
                        boolean canExport, boolean canReview, boolean canManage) {}

    private final WorkspaceDirectory directory;
    private final ProjectRecords records;

    public ProjectAccess(WorkspaceDirectory directory, ProjectRecords records) {
        this.directory = directory;
        this.records = records;
    }

    public static String projectId(String value) {
        return value == null || value.isBlank() ? WorkspaceDirectory.CURRENT_PROJECT_ID : value;
    }

    public static String session(Principal principal, String value) {
        String id = value == null || !value.matches("[a-zA-Z0-9_.-]{1,100}") ? "default" : value;
        return principal == null ? id : principal.username() + "/" + id;
    }

    public Grant grant(String project, Principal principal) {
        var found = directory.findProject(project);
        if (principal == null || found.isEmpty() || !principal.hasPermission(Permission.MODEL_VIEW.code())) {
            return new Grant("", false, false, false, false, false, false);
        }
        String username = principal.username().toLowerCase(Locale.ROOT);
        String role = principal.admin() || username.equalsIgnoreCase(found.get().owner()) ? "owner"
                : records.find(project, MEMBER, username, Member.class).map(Member::role)
                .orElse("");
        boolean view = !role.isEmpty();
        boolean write = role.equals("owner") || role.equals("editor");
        return new Grant(role, view, write && principal.hasPermission(Permission.MODEL_EDIT.code()),
                write && principal.hasPermission(Permission.MODEL_IMPORT.code()),
                view && principal.hasPermission(Permission.MODEL_EXPORT.code()),
                write || role.equals("reviewer"), role.equals("owner"));
    }

    public List<Member> members(String project) {
        var result = new ArrayList<>(records.list(project, MEMBER, Member.class));
        directory.findProject(project).map(WorkspaceDirectory.Project::owner)
                .filter(ProjectAccess::isUsername)
                .ifPresent(owner -> result.add(new Member(owner, "owner", true)));
        result.sort(Comparator.comparing(Member::username));
        return result;
    }

    public void changeMember(String project, Principal actor, String username, String role) {
        if (!grant(project, actor).canManage()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅项目负责人可管理成员");
        }
        String name = username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
        if (!isUsername(name) || (role != null && !ROLES.contains(role))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的用户名或项目角色");
        }
        if (directory.findProject(project).map(WorkspaceDirectory.Project::owner).orElse("").equalsIgnoreCase(name)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "创建者的负责人权限由项目目录保留");
        }
        boolean changingOwner = "owner".equals(role)
                || records.find(project, MEMBER, name, Member.class).map(Member::role).filter("owner"::equals).isPresent();
        if (changingOwner && !actor.admin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅平台管理员可分配或撤销负责人");
        }
        if (role == null) {
            records.delete(project, MEMBER, name);
        } else {
            records.save(project, MEMBER, name, new Member(name, role, false));
        }
    }

    public void forget(String project) {
        records.forget(project);
    }

    private static boolean isUsername(String value) {
        return value != null && value.matches("[a-zA-Z0-9_.@-]{1,80}");
    }
}
