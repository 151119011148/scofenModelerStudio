package com.scofen.model.web.auth;

import com.scofen.model.web.rbac.BuiltinRoles;
import com.scofen.model.web.rbac.PasswordHash;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.rbac.UserDirectory;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 登录态（JWT + 口令哈希）。
 *
 * <p><b>账号来源有两处</b>：落库模式下以 {@code scofen_user} 表为准；
 * 配置的超管清单（{@code scofen.auth.admin-usernames}，默认 {@code scofen,gaofeng}）
 * 作为兜底，两种模式下都保留——这样即便误删了库里的超管，也还有一条进得去的路。
 * 所有超管共用同一口令。</p>
 *
 * <p><b>权限随令牌下发</b>：JWT 里直接带角色码与展开后的权限码，
 * 服务端鉴权与前端按钮显隐读的是同一份数据，不会出现「界面藏了但接口还能调」。</p>
 *
 * <p>口令在源码里只保存 PBKDF2-HMAC-SHA256 哈希，明文绝不进 Git；
 * 部署时可用 {@code SCOFEN_AUTH_ADMIN_PASSWORD} 覆盖，或直接替换
 * {@code SCOFEN_AUTH_ADMIN_PASSWORD_HASH}。未配置 JWT 密钥时每次启动随机生成
 * （重启后需重新登录）；线上通过 {@code /etc/scofen/modeler.env} 注入固定密钥。</p>
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    public static final String TYP_AUTH = "auth";

    /** 初始超管口令的 PBKDF2 哈希；口令明文不写入源码，运维可用环境变量覆盖。 */
    public static final String DEFAULT_PASSWORD_HASH =
            "pbkdf2$120000$FyYB352zZu761LvHz45RAQ==$gnT0cyiVWou/+gm3KNEFWYcts+PsXomh9bbyOiIB56A=";

    /** 登录者：用户名、展示名、是否超管、角色码、权限码。 */
    public record User(String username, String displayName, boolean admin,
                       Set<String> roles, Set<String> permissions) {
        public User {
            roles = roles == null ? Set.of() : Set.copyOf(roles);
            permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
        }
    }

    public record Session(String token, User user) {
    }

    /** 服务端鉴权用的身份；权限码来自令牌，不查库。 */
    public record Principal(String username, String displayName, boolean admin,
                            Set<String> roles, Set<String> permissions) {
        public Principal {
            roles = roles == null ? Set.of() : Set.copyOf(roles);
            permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
        }

        public boolean hasPermission(String permissionCode) {
            return permissions.contains(permissionCode);
        }
    }

    private final Set<String> usernames;
    private final String passwordHash;
    private final SecretKey key;
    private final long ttlSeconds;
    private final UserDirectory userDirectory;

    public AuthService(
            // 复数优先；未设置时回退到旧的单数变量；两者都未设置才是默认的两个超管。
            @Value("${scofen.auth.admin-usernames:${scofen.auth.admin-username:scofen,gaofeng}}") String usernames,
            @Value("${scofen.auth.admin-password:}") String plainPassword,
            @Value("${scofen.auth.admin-password-hash:" + DEFAULT_PASSWORD_HASH + "}") String passwordHash,
            @Value("${scofen.auth.jwt-secret:}") String secret,
            @Value("${scofen.auth.jwt-ttl-seconds:604800}") long ttlSeconds,
            UserDirectory userDirectory) {
        this.usernames = parseUsernames(usernames);
        this.userDirectory = userDirectory;
        log.info("[scofen] 超管账号：{}", String.join(", ", this.usernames));
        this.passwordHash = plainPassword == null || plainPassword.isBlank()
                ? passwordHash : PasswordHash.hash(plainPassword);
        this.ttlSeconds = ttlSeconds > 0 ? ttlSeconds : 604800L;

        byte[] secretBytes;
        if (secret == null || secret.isBlank()) {
            secretBytes = new byte[32];
            new SecureRandom().nextBytes(secretBytes);
            log.warn("[scofen] 未配置 scofen.auth.jwt-secret，本次启动使用随机密钥；重启后需重新登录");
        } else {
            secretBytes = PasswordHash.sha256(secret);
        }
        this.key = Keys.hmacShaKeyFor(secretBytes);
    }

    /** 账号密码不匹配时抛 SecurityException，由 AuthController 统一转 401。 */
    public Session login(String rawUsername, String rawPassword) {
        String candidate = rawUsername == null ? "" : rawUsername.trim();
        if (candidate.isEmpty() || rawPassword == null) {
            throw new SecurityException("用户名或密码不正确");
        }

        // 落库模式：先查用户表
        if (userDirectory != null && userDirectory.enabled()) {
            Optional<UserDirectory.UserRecord> record = userDirectory.find(candidate);
            if (record.isPresent()) {
                UserDirectory.UserRecord user = record.get();
                if (!user.enabled() || !PasswordHash.matches(rawPassword, user.passwordHash())) {
                    throw new SecurityException("用户名或密码不正确");
                }
                Set<String> roles = new LinkedHashSet<>(userDirectory.rolesOf(candidate));
                Set<String> permissions = new LinkedHashSet<>(userDirectory.permissionsOf(candidate));
                User principal = new User(candidate,
                        user.displayName() == null || user.displayName().isBlank()
                                ? candidate : user.displayName(),
                        roles.contains(BuiltinRoles.ADMIN), roles, permissions);
                return new Session(issue(principal), principal);
            }
        }

        // 兜底：配置里的超管账号（落库模式下同样有效）
        if (usernames.contains(candidate) && PasswordHash.matches(rawPassword, passwordHash)) {
            User user = new User(candidate, "超级管理员", true,
                    Set.of(BuiltinRoles.ADMIN), allPermissions());
            return new Session(issue(user), user);
        }
        throw new SecurityException("用户名或密码不正确");
    }

    public boolean validToken(String token) {
        return parseOrNull(token) != null;
    }

    public Principal parseOrNull(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
            if (!TYP_AUTH.equals(claims.get("typ", String.class))) {
                return null;
            }
            String subject = claims.getSubject();
            if (subject == null) {
                return null;
            }
            boolean admin = Boolean.TRUE.equals(claims.get("admin", Boolean.class));
            // 配置超管即使不在库里也要能继续用；库里用户则必须仍然存在且启用。
            if (!admin && !usernames.contains(subject)) {
                if (userDirectory == null || !userDirectory.enabled()) {
                    return null;
                }
                Optional<UserDirectory.UserRecord> record = userDirectory.find(subject);
                if (record.isEmpty() || !record.get().enabled()) {
                    return null;
                }
            }
            Set<String> roles = new LinkedHashSet<>(stringList(claims.get("roles")));
            Set<String> permissions = new LinkedHashSet<>(stringList(claims.get("perms")));
            return new Principal(subject,
                    claims.get("dn", String.class) == null ? subject : claims.get("dn", String.class),
                    admin, roles, permissions);
        } catch (JwtException | IllegalArgumentException ex) {
            return null;
        }
    }

    private String issue(User user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(user.username())
                .claim("typ", TYP_AUTH)
                .claim("dn", user.displayName())
                .claim("admin", user.admin())
                .claim("roles", List.copyOf(user.roles()))
                .claim("perms", List.copyOf(user.permissions()))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlSeconds)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** 全部权限码：超管与 admin 角色共用。 */
    public static Set<String> allPermissions() {
        Set<String> result = new LinkedHashSet<>();
        Arrays.stream(Permission.values()).map(Permission::code).forEach(result::add);
        return Set.copyOf(result);
    }

    /** 逗号分隔的超管清单；配置为空时回退到 scofen，避免写错配置导致无人可登录。 */
    private static Set<String> parseUsernames(String raw) {
        Set<String> result = new LinkedHashSet<>();
        if (raw != null) {
            for (String part : raw.split(",")) {
                String name = part.trim();
                if (!name.isEmpty()) {
                    result.add(name);
                }
            }
        }
        if (result.isEmpty()) {
            result.add("scofen");
        }
        return Set.copyOf(result);
    }

    @SuppressWarnings("unchecked")
    private static List<String> stringList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}
