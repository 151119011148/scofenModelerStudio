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

/**
 * 登录态（仿 scofenDoc 的 JWT + 口令哈希方案，但保持本产品 M0 的无数据库依赖）。
 *
 * <p>账号只有一个超管：用户名来自 {@code scofen.auth.admin-username}（默认 scofen）。
 * 口令在源码里只保存 PBKDF2-HMAC-SHA256 哈希，明文绝不进 Git；部署时可用
 * {@code SCOFEN_AUTH_ADMIN_PASSWORD} 覆盖，或直接替换
 * {@code SCOFEN_AUTH_ADMIN_PASSWORD_HASH}。</p>
 *
 * <p>JWT 密钥默认每次启动随机生成（重启后需重新登录，这与 M0 内存态模型的复位语义一致）。
 * 生产环境可设置 {@code SCOFEN_AUTH_JWT_SECRET} 固定密钥，避免重启踢人。</p>
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    public static final String TYP_AUTH = "auth";

    /** scofen / Gf651125 的 PBKDF2 哈希，仅作为默认值；运维可用环境变量覆盖。 */
    public static final String DEFAULT_PASSWORD_HASH =
            "pbkdf2$120000$FyYB352zZu761LvHz45RAQ==$gnT0cyiVWou/+gm3KNEFWYcts+PsXomh9bbyOiIB56A=";

    public record User(String username, String displayName, boolean admin) {
    }

    public record Session(String token, User user) {
    }

    public record Principal(String username, String displayName, boolean admin) {
    }

    private final String username;
    private final String passwordHash;
    private final SecretKey key;
    private final long ttlSeconds;

    public AuthService(
            @Value("${scofen.auth.admin-username:scofen}") String username,
            @Value("${scofen.auth.admin-password:}") String plainPassword,
            @Value("${scofen.auth.admin-password-hash:" + DEFAULT_PASSWORD_HASH + "}") String passwordHash,
            @Value("${scofen.auth.jwt-secret:}") String secret,
            @Value("${scofen.auth.jwt-ttl-seconds:604800}") long ttlSeconds) {
        this.username = username == null || username.isBlank() ? "scofen" : username.trim();
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
        if (!candidate.equals(username) || rawPassword == null || !matches(rawPassword, passwordHash)) {
            throw new SecurityException("用户名或密码不正确");
        }
        User user = new User(username, "超级管理员", true);
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
            if (!username.equals(claims.getSubject())) {
                return null;
            }
            return new Principal(username, "超级管理员", Boolean.TRUE.equals(claims.get("admin", Boolean.class)));
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
