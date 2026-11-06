package com.scofen.model.web.rbac;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 内置角色。落库模式首次启动时把内置角色写入 {@code scofen_role} 与
 * {@code scofen_role_permission}，之后可由管理员在界面上增删改。
 *
 * <p>角色码稳定不变（{@code admin} / {@code editor} / {@code viewer}），
 * 权限码来自 {@link Permission}，两边用字符串关联，数据库里看得懂。</p>
 */
public final class BuiltinRoles {

    public static final String ADMIN = "admin";
    public static final String EDITOR = "editor";
    public static final String VIEWER = "viewer";

    /** 建模者：能读、能改、能导入导出，但不能管用户。 */
    public static final Set<String> EDITOR_PERMISSIONS = Set.of(
            Permission.MODEL_VIEW.code(),
            Permission.MODEL_EDIT.code(),
            Permission.MODEL_DELETE.code(),
            Permission.MODEL_IMPORT.code(),
            Permission.MODEL_EXPORT.code(),
            Permission.PROJECT_CREATE.code());

    /** 观察者：只读，外加导出（交付物常常要由只读角色导出）。 */
    public static final Set<String> VIEWER_PERMISSIONS = Set.of(
            Permission.MODEL_VIEW.code(),
            Permission.MODEL_EXPORT.code());

    private BuiltinRoles() {
    }

    /** 内置角色的静态定义：code → (名称, 说明, 权限集)。 */
    public static Map<String, RoleSpec> specs() {
        Map<String, RoleSpec> specs = new LinkedHashMap<>();
        specs.put(ADMIN, new RoleSpec(ADMIN, "管理员", "全部权限，含用户与角色管理",
                java.util.Arrays.stream(Permission.values()).map(Permission::code).collect(
                        java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new))));
        specs.put(EDITOR, new RoleSpec(EDITOR, "建模者", "可编辑模型、导入导出、建项目",
                new LinkedHashSet<>(EDITOR_PERMISSIONS)));
        specs.put(VIEWER, new RoleSpec(VIEWER, "观察者", "只读模型与导出", new LinkedHashSet<>(VIEWER_PERMISSIONS)));
        return specs;
    }

    /** 角色定义。 */
    public record RoleSpec(String code, String name, String description, Set<String> permissions) {
        public RoleSpec {
            permissions = Set.copyOf(permissions);
        }
    }

    /** 展开后的角色→权限映射，用于给内置超管直接授权。 */
    public static Map<String, List<String>> permissionMap() {
        Map<String, List<String>> result = new LinkedHashMap<>();
        specs().forEach((code, spec) -> result.put(code, List.copyOf(spec.permissions())));
        return result;
    }
}
