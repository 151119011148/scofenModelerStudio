package com.scofen.model.web.rbac;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.util.Base64;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * 口令哈希：PBKDF2-HMAC-SHA256，12 万轮，格式 {@code pbkdf2$轮数$盐$摘要}。
 *
 * <p>单独抽出来是因为建用户（用户管理界面）与校验口令（登录）两处都要用，
 * 哈希格式必须完全一致——否则新建的用户永远登不进去。</p>
 *
 * <p>明文口令任何时候都不落库、不进日志、不进 Git。</p>
 */
public final class PasswordHash {

    public static final int DEFAULT_ITERATIONS = 120_000;

    private PasswordHash() {
    }

    /** 生成随机盐并哈希；新口令一律走这条路。 */
    public static String hash(String raw) {
        return hash(raw, new SecureRandom().generateSeed(16), DEFAULT_ITERATIONS);
    }

    public static String hash(String raw, byte[] salt, int iterations) {
        try {
            byte[] derived = pbkdf2(raw, salt, iterations, 256);
            return "pbkdf2$" + iterations + "$" + Base64.getEncoder().encodeToString(salt)
                    + "$" + Base64.getEncoder().encodeToString(derived);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new IllegalStateException("无法生成口令哈希", ex);
        }
    }

    /** 校验口令；格式不认识或算法不可用一律判不通过。 */
    public static boolean matches(String raw, String stored) {
        if (raw == null || stored == null || stored.isBlank()) {
            return false;
        }
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

    /** SHA-256 摘要，用于把配置里的密钥字符串拉成固定长度的 HMAC 密钥。 */
    public static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("JVM 不支持 SHA-256", ex);
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
}
