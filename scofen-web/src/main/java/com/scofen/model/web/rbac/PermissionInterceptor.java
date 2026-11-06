package com.scofen.model.web.rbac;

import com.scofen.model.web.auth.AuthController;
import com.scofen.model.web.auth.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 权限门控：按 {@link RequiresPermission} 注解核对调用者权限。
 *
 * <p>认证（AuthFilter）回答「你是谁」，这里回答「你能做什么」。
 * 权限码直接取自令牌里的 perms 声明，服务端不再查库——
 * 权限变更在下一次登录生效，这个取舍是为了让鉴权不落在数据库的可用性上。</p>
 */
@Component
public class PermissionInterceptor implements HandlerInterceptor {

    private final AuthService authService;

    public PermissionInterceptor(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        RequiresPermission requirement = method.getMethodAnnotation(RequiresPermission.class);
        if (requirement == null) {
            requirement = method.getBeanType().getAnnotation(RequiresPermission.class);
        }
        if (requirement == null) {
            return true;
        }
        AuthService.Principal principal =
                (AuthService.Principal) request.getAttribute(AuthController.PRINCIPAL_ATTRIBUTE);
        if (principal == null) {
            write(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthorized", "登录已失效，请重新登录");
            return false;
        }
        List<String> missing = new ArrayList<>();
        for (Permission permission : requirement.value()) {
            if (!principal.hasPermission(permission.code())) {
                // 带上权限码，便于前端提示与运维排查到底缺哪一项。
                missing.add(permission.label() + "（" + permission.code() + "）");
            }
        }
        if (!missing.isEmpty()) {
            write(response, HttpServletResponse.SC_FORBIDDEN, "forbidden",
                    "当前角色缺少权限：" + String.join("、", missing));
            return false;
        }
        return true;
    }

    private void write(HttpServletResponse response, int status, String error, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        byte[] body = ("{\"error\":\"" + error + "\",\"message\":\"" + message + "\"}")
                .getBytes(StandardCharsets.UTF_8);
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
    }
}
