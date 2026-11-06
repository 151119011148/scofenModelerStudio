package com.scofen.model.web.rbac;

import com.scofen.model.web.persistence.MysqlSchema;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 用户与角色的 JDBC 实现。
 *
 * <p>首次启动时把内置角色（admin / editor / viewer）写入库；之后角色可由管理员增删改，
 * 用户的角色分配也在库里维护。</p>
 */
public final class JdbcUserDirectory implements UserDirectory {

    private final JdbcTemplate jdbc;

    public JdbcUserDirectory(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean enabled() {
        return true;
    }

    private void ensure() {
        MysqlSchema.ensure(jdbc);
        seedBuiltinRoles();
    }

    /** 内置角色只在缺失时补齐，不覆盖管理员改过的说明文案。 */
    private void seedBuiltinRoles() {
        for (BuiltinRoles.RoleSpec spec : BuiltinRoles.specs().values()) {
            jdbc.update("INSERT INTO scofen_role (code, name, description, builtin) VALUES (?, ?, ?, 1) "
                            + "ON DUPLICATE KEY UPDATE name = name",
                    (ps) -> {
                        ps.setString(1, spec.code());
                        ps.setString(2, spec.name());
                        ps.setString(3, spec.description());
                    });
            for (String permission : spec.permissions()) {
                jdbc.update("INSERT IGNORE INTO scofen_role_permission (role_code, permission) VALUES (?, ?)",
                        (ps) -> {
                            ps.setString(1, spec.code());
                            ps.setString(2, permission);
                        });
            }
        }
    }

    @Override
    public List<UserRecord> users() {
        ensure();
        return jdbc.query("SELECT username, display_name, password_hash, enabled, builtin "
                        + "FROM scofen_user ORDER BY username",
                (rs, index) -> new UserRecord(
                        rs.getString("username"),
                        rs.getString("display_name"),
                        rs.getString("password_hash"),
                        rs.getBoolean("enabled"),
                        rs.getBoolean("builtin")));
    }

    @Override
    public Optional<UserRecord> find(String username) {
        if (username == null || username.isBlank()) {
            return Optional.empty();
        }
        ensure();
        List<UserRecord> rows = jdbc.query("SELECT username, display_name, password_hash, enabled, builtin "
                        + "FROM scofen_user WHERE username = ?",
                (ps) -> ps.setString(1, username),
                (rs, index) -> new UserRecord(
                        rs.getString("username"),
                        rs.getString("display_name"),
                        rs.getString("password_hash"),
                        rs.getBoolean("enabled"),
                        rs.getBoolean("builtin")));
        return rows.stream().findFirst();
    }

    @Override
    public List<String> rolesOf(String username) {
        ensure();
        return jdbc.query("SELECT role_code FROM scofen_user_role WHERE username = ? ORDER BY role_code",
                (ps) -> ps.setString(1, username),
                (rs, index) -> rs.getString("role_code"));
    }

    @Override
    public void saveUser(UserRecord user, List<String> roleCodes) {
        ensure();
        jdbc.update("INSERT INTO scofen_user (username, display_name, password_hash, enabled, builtin) "
                        + "VALUES (?, ?, ?, ?, ?) AS new ON DUPLICATE KEY UPDATE "
                        + "display_name = new.display_name, password_hash = new.password_hash, "
                        + "enabled = new.enabled",
                (ps) -> {
                    ps.setString(1, user.username());
                    ps.setString(2, user.displayName());
                    ps.setString(3, user.passwordHash());
                    ps.setBoolean(4, user.enabled());
                    ps.setBoolean(5, user.builtin());
                });
        jdbc.update("DELETE FROM scofen_user_role WHERE username = ?", user.username());
        for (String role : roleCodes) {
            jdbc.update("INSERT IGNORE INTO scofen_user_role (username, role_code) VALUES (?, ?)",
                    (ps) -> {
                        ps.setString(1, user.username());
                        ps.setString(2, role);
                    });
        }
    }

    @Override
    public void deleteUser(String username) {
        ensure();
        jdbc.update("DELETE FROM scofen_user WHERE username = ?", username);
    }

    @Override
    public List<RoleRecord> roles() {
        ensure();
        List<RoleRecord> roles = new ArrayList<>();
        for (RoleRow row : jdbc.query("SELECT code, name, description, builtin FROM scofen_role ORDER BY code",
                (rs, index) -> new RoleRow(rs.getString("code"), rs.getString("name"),
                        rs.getString("description"), rs.getBoolean("builtin")))) {
            roles.add(new RoleRecord(row.code(), row.name(), row.description(), row.builtin(),
                    permissionsOfRole(row.code())));
        }
        return roles;
    }

    private List<String> permissionsOfRole(String roleCode) {
        return jdbc.query("SELECT permission FROM scofen_role_permission WHERE role_code = ? ORDER BY permission",
                (ps) -> ps.setString(1, roleCode),
                (rs, index) -> rs.getString("permission"));
    }

    @Override
    public Optional<RoleRecord> findRole(String code) {
        return roles().stream().filter(role -> role.code().equals(code)).findFirst();
    }

    @Override
    public void saveRole(RoleRecord role, List<String> permissionCodes) {
        ensure();
        jdbc.update("INSERT INTO scofen_role (code, name, description, builtin) VALUES (?, ?, ?, ?) "
                        + "AS new ON DUPLICATE KEY UPDATE name = new.name, description = new.description",
                (ps) -> {
                    ps.setString(1, role.code());
                    ps.setString(2, role.name());
                    ps.setString(3, role.description());
                    ps.setBoolean(4, role.builtin());
                });
        jdbc.update("DELETE FROM scofen_role_permission WHERE role_code = ?", role.code());
        for (String permission : permissionCodes) {
            jdbc.update("INSERT IGNORE INTO scofen_role_permission (role_code, permission) VALUES (?, ?)",
                    (ps) -> {
                        ps.setString(1, role.code());
                        ps.setString(2, permission);
                    });
        }
    }

    @Override
    public void deleteRole(String code) {
        ensure();
        jdbc.update("DELETE FROM scofen_role WHERE code = ?", code);
    }

    @Override
    public Set<String> permissionsOf(String username) {
        ensure();
        Set<String> result = new LinkedHashSet<>();
        for (String role : rolesOf(username)) {
            result.addAll(permissionsOfRole(role));
        }
        return result;
    }

    private record RoleRow(String code, String name, String description, boolean builtin) {
    }
}
