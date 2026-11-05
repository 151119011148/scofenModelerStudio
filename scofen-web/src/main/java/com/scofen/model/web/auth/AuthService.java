package com.scofen.model.web.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 登录态（仿 scofenDoc 的 JWT + 口令哈希方案，但保持本产品 M0 的无数据库依赖）。
 *
 * <p>超管账号清单来自 {@code scofen.auth.admin-usernames}（逗号分隔，默认 {@code scofen,gaofeng}），
 * 兼容旧的单数变量 {@code scofen.auth.admin-username}；所有超管共用同一口令。
 * 口令在源码里只保存 PBKDF2-HMAC-SHA256 哈希，明文绝不进 Git；部署时可用
 * {@code SCOFEN_AUTH_ADMIN_PASSWORD} 覆盖，或直接替换
 * {@code SCOFEN_AUTH_ADMIN_PASSWORD_HASH}。</p>
 *
 * <p>未配置 JWT 密钥时每次启动随机生成（重启后需重新登录）；线上部署通过
 * {@code /etc/scofen/modeler.env} 注入 {@code SCOFEN_AUTH_JWT_SECRET} 固定密钥，避免重启踢人。</p>
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    public static final String TYP_AUTH = "auth";

    /** 初始超管口令的 PBKDF2 哈希；口令明文不写入源码，运维可用环境变量覆盖。 */
    public static final String DEFAULT_PASSWORD_HASH =
            "pbkdf2$120000$FyYB352zZu761LvHz45RAQ==$gnT0cyiVWou/+gm3KNEFWYcts+PsXomh9bbyOiIB56A=";

    public record User(String username, String displayName, boolean admin) {
    }

    public record Session(String token, User user) {
    }

    public record Principal(String username, String displayName, boolean admin) {
    }

    private final Set<String> usernames;
    private final String passwordHash;
    private final SecretKey key;
    private final long ttlSeconds;

    public AuthService(
            // 复数优先；未设置时回退到旧的单数变量；两者都未设置才是默认的两个超管。
            @Value("${scofen.auth.admin-usernames:${scofen.auth.admin-username:scofen,gaofeng}}") String usernames,
            @Value("${scofen.auth.admin-password:}") String plainPassword,
            @Value("${scofen.auth.admin-password-hash:" + DEFAULT_PASSWORD_HASH + "}") String passwordHash,
            @Value("${scofen.auth.jwt-secret:}") String secret,
            @Value("${scofen.auth.jwt-ttl-seconds:604800}") long ttlSeconds) {
        this.usernames = parseUsernames(usernames);
        log.info("[scofen] 超管账号：{}", String.join(", ", this.usernames));
        this.passwordHash = plainPassword == null || plainPassword.isBlank()
                ? passwordHash : hash(plainPassword, new SecureRandom().generateSeed(16), 120_000);
        this.ttlSeconds = ttlSeconds > 0 ? ttlSeconds : 604800L;

        byte[] secretBytes;
        if (secret == null || secret.isBlank()) {
            secretBytes = new byte[32];
            new SecureRandom().nextBytes(secretBytes);
            log.warn("[scofen] 未配置 scofen.auth.jwt-secret，本次启动使用随机密钥；重启后需重新登录");
        } else {
            secretBytes = sha256(secret);
        }
        this.key = Keys.hmacShaKeyFor(secretBytes);
    }

    /** 账号密码不匹配时抛 SecurityException，由 AuthController 统一转 401。 */
    public Session login(String rawUsername, String rawPassword) {
        String candidate = rawUsername == null ? "" : rawUsername.trim();
        if (!usernames.contains(candidate) || rawPassword == null || !matches(rawPassword, passwordHash)) {
            throw new SecurityException("用户名或密码不正确");
        }
        User user = new User(candidate, "超级管理员", true);
        return new Session(issue(user), user);
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
            if (subject == null || !usernames.contains(subject)) {
                return null;
            }
            return new Principal(subject, "超级管理员", Boolean.TRUE.equals(claims.get("admin", Boolean.class)));
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
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlSeconds)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
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

    /* ---------------- PBKDF2-HMAC-SHA256 ---------------- */

    private static boolean matches(String raw, String stored) {
        try {
            String[] parts = stored.split("\\$", -1);
            if (parts.length != 4 || !"pbkdf2".equals(parts[0])) {
                return false;
            }
            int iterations = Integer.parseInt(parts[1]);
            byte[] salt = Base64.getDecoder().decode(parts[2]);
            byte[] expected = Base64.getDecoder().decode(parts[3]);
            byte[] actual = pbkdf2(raw, salt, iterations, expected.length * 8);
            return MessageDigest.isEqual(expected, actual);
        } catch (RuntimeException | InvalidKeySpecException | NoSuchAlgorithmException ex) {
            return false;
        }
    }

    private static String hash(String raw, byte[] salt, int iterations) {
        try {
            byte[] derived = pbkdf2(raw, salt, iterations, 256);
            return "pbkdf2$" + iterations + "$" + Base64.getEncoder().encodeToString(salt)
                    + "$" + Base64.getEncoder().encodeToString(derived);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new IllegalStateException("无法生成口令哈希", ex);
        }
    }

    private static byte[] pbkdf2(String raw, byte[] salt, int iterations, int bits)
            throws NoSuchAlgorithmException, InvalidKeySpecException {
        PBEKeySpec spec = new PBEKeySpec(raw.toCharArray(), salt, iterations, bits);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("JVM 不支持 SHA-256", ex);
        }
    }
}
