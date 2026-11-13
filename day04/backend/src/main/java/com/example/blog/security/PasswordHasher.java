package com.example.blog.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

import org.springframework.stereotype.Component;

/**
 * 密码哈希：JDK 内置 PBKDF2WithHmacSHA256 + 16 字节随机盐，恒定时间比较。
 * 存储格式 pbkdf2$&lt;iterations&gt;$&lt;saltHex&gt;$&lt;hashHex&gt;，
 * 与阶段一 Node 版 scrypt$... 同构（都自带算法与参数，便于后续平滑迁移）。
 * 明文密码永不入库、永不出现在响应里。
 */
@Component
public class PasswordHasher {

    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int ITERATIONS = 120_000;
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;
    private static final HexFormat HEX = HexFormat.of();
    private static final SecureRandom RANDOM = new SecureRandom();

    public String hash(String password) {
        byte[] salt = new byte[SALT_BYTES];
        RANDOM.nextBytes(salt);
        byte[] derived = derive(password.toCharArray(), salt, ITERATIONS, KEY_BITS);
        return "pbkdf2$" + ITERATIONS + "$" + HEX.formatHex(salt) + "$" + HEX.formatHex(derived);
    }

    public boolean verify(String password, String stored) {
        if (stored == null) return false;
        String[] parts = stored.split("\\$");
        if (parts.length != 4 || !"pbkdf2".equals(parts[0])) return false;
        try {
            int iterations = Integer.parseInt(parts[1]);
            byte[] salt = HEX.parseHex(parts[2]);
            byte[] expected = HEX.parseHex(parts[3]);
            if (salt.length == 0 || expected.length == 0) return false;
            byte[] actual = derive(password.toCharArray(), salt, iterations, expected.length * 8);
            return MessageDigest.isEqual(expected, actual);
        } catch (RuntimeException ex) {
            return false;
        }
    }

    private static byte[] derive(char[] password, byte[] salt, int iterations, int bits) {
        PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, bits);
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).getEncoded();
        } catch (Exception ex) {
            throw new IllegalStateException("密码派生失败", ex);
        } finally {
            spec.clearPassword();
        }
    }

    /** 仅供测试断言：确认派生结果与编码字符集无关。 */
    public static String bytesToUtf8(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
