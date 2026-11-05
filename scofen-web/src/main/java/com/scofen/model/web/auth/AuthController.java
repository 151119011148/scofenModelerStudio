package com.scofen.model.web.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 账号接口：/login 公开，/me 与 /logout 由 AuthFilter 保护。 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    public static final String PRINCIPAL_ATTRIBUTE = "scofen.auth.principal";

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody(required = false) Credentials body) {
        String username = body == null ? "" : body.username();
        String password = body == null ? "" : body.password();
        try {
            AuthService.Session session = authService.login(username, password);
            return ResponseEntity.ok(Map.of(
                    "token", session.token(),
                    "user", session.user()));
        } catch (SecurityException ex) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                    "error", "unauthorized",
                    "message", ex.getMessage()));
        }
    }

    /** 前端启动时校验本地 token 是否仍然有效。 */
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {
        AuthService.Principal principal = (AuthService.Principal) request.getAttribute(PRINCIPAL_ATTRIBUTE);
        if (principal == null) {
            return Map.of("error", "unauthorized");
        }
        return Map.of(
                "username", principal.username(),
                "displayName", principal.displayName(),
                "admin", principal.admin());
    }

    /** JWT 无状态，服务端只需确认调用者仍持有有效 token；清 token 由前端完成。 */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout() {
        return ResponseEntity.noContent().build();
    }

    public record Credentials(String username, String password) {
    }
}
