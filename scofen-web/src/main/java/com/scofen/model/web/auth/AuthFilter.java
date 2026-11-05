package com.scofen.model.web.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 保护所有 /api/**（登录与 health 探针除外）。
 *
 * <p>无 token / token 过期 / 签名不对一律返回 401 JSON，前端收到后清会话并回登录页。
 * health 保持公开，方便 systemd 启动探针与 Nginx 链路检查。</p>
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    private final AuthService authService;

    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!path.startsWith("/api/")
                || path.equals("/api/auth/login")
                || path.equals("/api/health")) {
            chain.doFilter(request, response);
            return;
        }

        String raw = request.getHeader("Authorization");
        AuthService.Principal principal = raw != null && raw.startsWith("Bearer ")
                ? authService.parseOrNull(raw.substring(7).trim())
                : null;
        if (principal == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            byte[] body = "{\"error\":\"unauthorized\",\"message\":\"登录已失效，请重新登录\"}"
                    .getBytes(StandardCharsets.UTF_8);
            response.setContentLength(body.length);
            response.getOutputStream().write(body);
            return;
        }
        request.setAttribute(AuthController.PRINCIPAL_ATTRIBUTE, principal);
        chain.doFilter(request, response);
    }
}
