package com.scofen.model.web.rbac;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 内存模式的用户目录：没有用户表，账号仍由配置的超管清单决定。
 *
 * <p>超管在这里被当作持有 admin 角色的内置用户，因此内存模式下
 * 「谁能干什么」与落库模式完全一致：超管 = 全部权限。</p>
 */
public final class NoopUserDirectory implements UserDirectory {

    @Override
    public boolean enabled() {
        return false;
    }

    @Override
    public List<UserRecord> users() {
        return List.of();
    }

    @Override
    public Optional<UserRecord> find(String username) {
        return Optional.empty();
    }

    @Override
    public List<String> rolesOf(String username) {
        return List.of();
    }

    @Override
    public void saveUser(UserRecord user, List<String> roleCodes) {
        throw new UnsupportedOperationException("内存模式不支持用户管理");
    }

    @Override
    public void deleteUser(String username) {
        throw new UnsupportedOperationException("内存模式不支持用户管理");
    }

    @Override
    public List<RoleRecord> roles() {
        return BuiltinRoles.specs().values().stream()
                .map(spec -> new RoleRecord(spec.code(), spec.name(), spec.description(), true,
                        List.copyOf(spec.permissions())))
                .toList();
    }

    @Override
    public Optional<RoleRecord> findRole(String code) {
        return roles().stream().filter(role -> role.code().equals(code)).findFirst();
    }

    @Override
    public void saveRole(RoleRecord role, List<String> permissionCodes) {
        throw new UnsupportedOperationException("内存模式不支持角色管理");
    }

    @Override
    public void deleteRole(String code) {
        throw new UnsupportedOperationException("内存模式不支持角色管理");
    }

    @Override
    public Set<String> permissionsOf(String username) {
        return Set.of();
    }
}
