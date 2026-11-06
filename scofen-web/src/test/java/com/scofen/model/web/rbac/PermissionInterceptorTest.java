package com.scofen.model.web.rbac;

import com.scofen.model.web.auth.AuthController;
import com.scofen.model.web.auth.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 权限门控：认权限码，不认角色名。
 *
 * <p>拦截器只看令牌里的 perms 声明，因此单元测试直接构造 Principal 即可，
 * 不必依赖数据库或完整登录流程。</p>
 */
class PermissionInterceptorTest {

    /** 假端点：一个带 {@code @RequiresPermission} 的方法。 */
    static class GuardedEndpoint {
        @RequiresPermission(Permission.MODEL_EDIT)
        public void edit() {
        }
    }

    static class OpenEndpoint {
        public void read() {
        }
    }

    private PermissionInterceptor interceptor() {
        return new PermissionInterceptor(null);
    }

    private HandlerMethod handler(Class<?> type, String method) throws Exception {
        return new HandlerMethod(type.getDeclaredConstructor().newInstance(), type.getMethod(method));
    }

    private MockHttpServletRequest requestWith(AuthService.Principal principal) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (principal != null) {
            request.setAttribute(AuthController.PRINCIPAL_ATTRIBUTE, principal);
        }
        return request;
    }

    @Test
    void endpointWithoutRequirementIsOpen() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        boolean proceed = interceptor().preHandle(requestWith(null), response,
                handler(OpenEndpoint.class, "read"));
        assertThat(proceed).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void missingPermissionIsForbidden() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthService.Principal viewer = new AuthService.Principal("bob", "观察者", false,
                Set.of(BuiltinRoles.VIEWER), Set.of(Permission.MODEL_VIEW.code()));
        boolean proceed = interceptor().preHandle(requestWith(viewer), response,
                handler(GuardedEndpoint.class, "edit"));
        assertThat(proceed).isFalse();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("model.edit");
    }

    @Test
    void grantedPermissionPasses() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthService.Principal editor = new AuthService.Principal("ann", "建模者", false,
                Set.of(BuiltinRoles.EDITOR), BuiltinRoles.EDITOR_PERMISSIONS);
        boolean proceed = interceptor().preHandle(requestWith(editor), response,
                handler(GuardedEndpoint.class, "edit"));
        assertThat(proceed).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void anonymousCallerIsUnauthorized() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        boolean proceed = interceptor().preHandle(requestWith(null), response,
                handler(GuardedEndpoint.class, "edit"));
        assertThat(proceed).isFalse();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void builtinRolesCoverTheExpectedGround() {
        assertThat(BuiltinRoles.specs()).containsKeys(BuiltinRoles.ADMIN, BuiltinRoles.EDITOR,
                BuiltinRoles.VIEWER);
        assertThat(BuiltinRoles.EDITOR_PERMISSIONS).contains(Permission.MODEL_EDIT.code(),
                Permission.MODEL_EXPORT.code());
        assertThat(BuiltinRoles.EDITOR_PERMISSIONS).doesNotContain(Permission.USER_MANAGE.code());
        assertThat(BuiltinRoles.VIEWER_PERMISSIONS).contains(Permission.MODEL_VIEW.code());
        assertThat(BuiltinRoles.VIEWER_PERMISSIONS).doesNotContain(Permission.MODEL_EDIT.code());
        // 管理员拥有全部权限码
        assertThat(BuiltinRoles.specs().get(BuiltinRoles.ADMIN).permissions())
                .containsExactlyInAnyOrderElementsOf(AuthService.allPermissions());
    }
}
