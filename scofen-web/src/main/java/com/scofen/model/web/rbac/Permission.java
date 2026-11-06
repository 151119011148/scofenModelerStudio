package com.scofen.model.web.rbac;

/**
 * 权限码。服务端按权限码门控，前端按同一套码隐藏操作入口——
 * 两端共用一份定义，避免「界面藏了但接口还能调」这类半吊子状态。
 */
public enum Permission {

    MODEL_VIEW("model.view", "查看模型"),
    MODEL_EDIT("model.edit", "编辑模型"),
    MODEL_DELETE("model.delete", "删除模型元素"),
    MODEL_IMPORT("model.import", "导入模型"),
    MODEL_EXPORT("model.export", "导出模型"),
    PROJECT_CREATE("project.create", "新建项目"),
    PROJECT_DELETE("project.delete", "删除项目"),
    USER_MANAGE("user.manage", "用户管理"),
    ROLE_MANAGE("role.manage", "角色管理");

    private final String code;
    private final String label;

    Permission(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    /** 按权限码解析；未知权限码返回空（宁可拒绝，也不误放行）。 */
    public static java.util.Optional<Permission> fromCode(String code) {
        if (code == null) {
            return java.util.Optional.empty();
        }
        for (Permission permission : values()) {
            if (permission.code.equals(code)) {
                return java.util.Optional.of(permission);
            }
        }
        return java.util.Optional.empty();
    }
}
