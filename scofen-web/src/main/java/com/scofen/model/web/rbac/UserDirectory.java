package com.scofen.model.web.rbac;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 用户与角色的目录存储。
 *
 * <p>落库模式（MySQL）下用户与角色都是数据库里的行；内存模式下没有用户表，
 * 账号仍来自配置的超管清单——两种模式下超管都持有 admin 角色的全部权限，
 * 因此前端的权限门控逻辑只有一套。</p>
 */
public interface UserDirectory {

    /** 是否为落库模式（内存模式为 false）。 */
    boolean enabled();

    /** 全部用户。 */
    List<UserRecord> users();

    /** 查用户。 */
    Optional<UserRecord> find(String username);

    /** 用户拥有的角色码。 */
    List<String> rolesOf(String username);

    /** 新增或更新用户（同时整体覆盖其角色分配）。 */
    void saveUser(UserRecord user, List<String> roleCodes);

    /** 删除用户。 */
    void deleteUser(String username);

    /** 全部角色。 */
    List<RoleRecord> roles();

    /** 查角色。 */
    Optional<RoleRecord> findRole(String code);

    /** 新增或更新角色（同时整体覆盖其权限分配）。 */
    void saveRole(RoleRecord role, List<String> permissionCodes);

    /** 删除角色。 */
    void deleteRole(String code);

    /** 展开某用户最终拥有的权限码（各角色权限的并集）。 */
    Set<String> permissionsOf(String username);

    /** 用户记录；口令只存哈希。 */
    record UserRecord(String username, String displayName, String passwordHash,
                      boolean enabled, boolean builtin) {
    }

    /** 角色记录；权限码取自 {@link Permission}。 */
    record RoleRecord(String code, String name, String description,
                      boolean builtin, List<String> permissions) {
        public RoleRecord {
            permissions = permissions == null ? List.of() : List.copyOf(permissions);
        }
    }
}
