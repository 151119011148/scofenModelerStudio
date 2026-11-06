package com.scofen.model.web.rbac;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户与角色管理（需要 USER_MANAGE / ROLE_MANAGE 权限）。
 *
 * <p>内存模式下没有用户表，接口会明确返回「请启用持久化」，
 * 而不是让人以为建了用户却没生效。</p>
 */
@RestController
@RequestMapping("/api/admin")
public class UserAdminController {

    private final UserDirectory directory;

    public UserAdminController(UserDirectory directory) {
        this.directory = directory;
    }

    @GetMapping("/users")
    @RequiresPermission(Permission.USER_MANAGE)
    public Map<String, Object> users() {
        requirePersistent("用户管理");
        List<Map<String, Object>> users = new ArrayList<>();
        for (UserDirectory.UserRecord user : directory.users()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("username", user.username());
            row.put("displayName", user.displayName());
            row.put("enabled", user.enabled());
            row.put("builtin", user.builtin());
            row.put("roles", directory.rolesOf(user.username()));
            users.add(row);
        }
        return Map.of("users", users);
    }

    /** 新增或更新用户；口令留空表示保持原样。 */
    @PostMapping("/users")
    @RequiresPermission(Permission.USER_MANAGE)
    public Map<String, Object> saveUser(@RequestBody(required = false) UserPayload payload) {
        requirePersistent("用户管理");
        if (payload == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少请求体");
        }
        String username = payload.username() == null ? "" : payload.username().trim();
        if (username.isEmpty() || username.length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名不得为空且不超过 64 字");
        }
        UserDirectory.UserRecord existing = directory.find(username).orElse(null);
        String passwordHash;
        if (payload.password() != null && !payload.password().isBlank()) {
            passwordHash = PasswordHash.hash(payload.password());
        } else if (existing != null) {
            passwordHash = existing.passwordHash();
        } else {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "新建用户必须设置口令");
        }
        List<String> roles = payload.roles() == null ? List.of() : payload.roles();
        for (String role : roles) {
            if (directory.findRole(role).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知角色：" + role);
            }
        }
        boolean enabled = payload.enabled() == null || payload.enabled();
        directory.saveUser(new UserDirectory.UserRecord(username,
                payload.displayName() == null ? username : payload.displayName().trim(),
                passwordHash, enabled, existing != null && existing.builtin()), roles);
        return Map.of("username", username, "roles", roles, "enabled", enabled);
    }

    @DeleteMapping("/users/{username}")
    @RequiresPermission(Permission.USER_MANAGE)
    public Map<String, Object> deleteUser(@PathVariable String username) {
        requirePersistent("用户管理");
        UserDirectory.UserRecord existing = directory.find(username).orElse(null);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在：" + username);
        }
        if (existing.builtin()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "内置用户不可删除");
        }
        directory.deleteUser(username);
        return Map.of("username", username, "deleted", Boolean.TRUE);
    }

    /** 全部可用权限码：前端据此渲染权限勾选框，避免两端各维护一份清单。 */
    @GetMapping("/permissions")
    @RequiresPermission(Permission.ROLE_MANAGE)
    public Map<String, Object> permissions() {
        List<Map<String, Object>> permissions = new ArrayList<>();
        for (Permission permission : Permission.values()) {
            permissions.add(Map.of("code", permission.code(), "label", permission.label()));
        }
        return Map.of("permissions", permissions);
    }

    @GetMapping("/roles")
    @RequiresPermission(Permission.ROLE_MANAGE)
    public Map<String, Object> roles() {
        List<Map<String, Object>> roles = new ArrayList<>();
        for (UserDirectory.RoleRecord role : directory.roles()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("code", role.code());
            row.put("name", role.name());
            row.put("description", role.description());
            row.put("builtin", role.builtin());
            row.put("permissions", role.permissions());
            roles.add(row);
        }
        return Map.of("roles", roles);
    }

    @PostMapping("/roles")
    @RequiresPermission(Permission.ROLE_MANAGE)
    public Map<String, Object> saveRole(@RequestBody(required = false) RolePayload payload) {
        requirePersistent("角色管理");
        if (payload == null || payload.code() == null || payload.code().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "角色码不得为空");
        }
        List<String> permissions = payload.permissions() == null ? List.of() : payload.permissions();
        for (String permission : permissions) {
            if (Permission.fromCode(permission).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知权限码：" + permission);
            }
        }
        UserDirectory.RoleRecord existing = directory.findRole(payload.code()).orElse(null);
        directory.saveRole(new UserDirectory.RoleRecord(payload.code(),
                payload.name() == null ? payload.code() : payload.name(),
                payload.description() == null ? "" : payload.description(),
                existing != null && existing.builtin(), permissions), permissions);
        return Map.of("code", payload.code(), "permissions", permissions);
    }

    @DeleteMapping("/roles/{code}")
    @RequiresPermission(Permission.ROLE_MANAGE)
    public Map<String, Object> deleteRole(@PathVariable String code) {
        requirePersistent("角色管理");
        UserDirectory.RoleRecord existing = directory.findRole(code).orElse(null);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "角色不存在：" + code);
        }
        if (existing.builtin()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "内置角色不可删除");
        }
        directory.deleteRole(code);
        return Map.of("code", code, "deleted", Boolean.TRUE);
    }

    /** 内存模式没有用户表，明确报错比「建了却没生效」好。 */
    private void requirePersistent(String what) {
        if (!directory.enabled()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    what + "需要持久化模式：请设置 scofen.persistence.mode=mysql 后重启");
        }
    }

    public record UserPayload(String username, String displayName, String password,
                              Boolean enabled, List<String> roles) {
    }

    public record RolePayload(String code, String name, String description, List<String> permissions) {
    }
}
