package com.example.blog.web;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.ProfileService;

import javax.imageio.ImageIO;

/** F6 个人资料端点（§4.2）。本人读写、公开只读、头像上传（重采样至 320×320）。 */
@RestController
@RequestMapping("/api")
public class ProfileController {

    private static final Map<String, String> ALLOWED = Map.of(
            "jpg", "image/jpeg", "jpeg", "image/jpeg",
            "png", "image/png", "webp", "image/webp", "gif", "image/gif");

    private final ProfileService profiles;
    private final Path avatarDir;

    public ProfileController(ProfileService profiles,
                            @Value("${blog.upload.dir:data/uploads}") String dir) {
        this.profiles = profiles;
        this.avatarDir = Paths.get(dir).toAbsolutePath().normalize().resolve("avatar");
    }

    @GetMapping("/profile")
    public Map<String, Object> self() {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(profiles.getSelf(uid));
    }

    @PutMapping("/profile")
    public Map<String, Object> update(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(profiles.update(uid, body));
    }

    @GetMapping("/profile/{id}")
    public Map<String, Object> publicProfile(@PathVariable("id") String id) {
        return ApiResponse.success(profiles.getPublic(id));
    }

    @PostMapping("/profile/avatar")
    public Map<String, Object> avatar(@RequestParam("file") MultipartFile file) {
        String uid = AuthContext.requireLogin();
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "上传文件不能为空");
        }
        if (file.getSize() > 2 * 1024 * 1024) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "头像不超过 2 MB");
        }
        String ext = extension(file.getOriginalFilename());
        if (ext == null) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "仅支持 jpg / png / webp / gif");
        }
        String expectedMime = ALLOWED.get(ext);
        String declared = file.getContentType();
        if (declared == null || !declared.equalsIgnoreCase(expectedMime)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "文件 MIME 与扩展名不匹配");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "无法读取上传文件");
        }
        if (!magicMatches(ext, bytes)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "文件内容不是合法图片");
        }

        byte[] stored = resampleIfPossible(ext, bytes);
        String key = UUID.randomUUID().toString() + (stored == bytes ? "." + ext : ".png");
        String url = "/uploads/avatar/" + key;
        try {
            Files.createDirectories(avatarDir);
            Path target = avatarDir.resolve(key).normalize();
            if (!avatarDir.equals(target.getParent())) {
                throw new BizException(ErrorCode.VALIDATION_ERROR, "非法存储路径");
            }
            Files.write(target, stored);
        } catch (BizException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new BizException(ErrorCode.INTERNAL_ERROR, "文件写入失败");
        }
        profiles.setAvatar(uid, url);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("avatarUrl", url);
        return ApiResponse.success(data);
    }

    /** JPG/PNG 重采样为 320×320 正方形 PNG；WebP/GIF 等无法解码时保留原字节。 */
    private static byte[] resampleIfPossible(String ext, byte[] bytes) {
        if (!("jpg".equals(ext) || "jpeg".equals(ext) || "png".equals(ext))) {
            return bytes;
        }
        try (ByteArrayInputStream in = new ByteArrayInputStream(bytes)) {
            BufferedImage src = ImageIO.read(in);
            if (src == null) return bytes;
            int side = Math.min(src.getWidth(), src.getHeight());
            int x = (src.getWidth() - side) / 2;
            int y = (src.getHeight() - side) / 2;
            BufferedImage square = src.getSubimage(x, y, side, side);
            BufferedImage out = new BufferedImage(320, 320, BufferedImage.TYPE_INT_RGB);
            Graphics2D g = out.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.drawImage(square, 0, 0, 320, 320, null);
            g.dispose();
            ByteArrayOutputStream os = new ByteArrayOutputStream();
            ImageIO.write(out, "png", os);
            return os.toByteArray();
        } catch (Exception ex) {
            return bytes;
        }
    }

    private static String extension(String name) {
        if (name == null) return null;
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return null;
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ALLOWED.containsKey(ext) ? ext : null;
    }

    private static boolean magicMatches(String ext, byte[] bytes) {
        if (bytes == null) return false;
        switch (ext) {
            case "jpg":
            case "jpeg":
                return bytes.length >= 3 && (bytes[0] & 0xff) == 0xff
                        && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff;
            case "png":
                return bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P'
                        && bytes[2] == 'N' && bytes[3] == 'G' && (bytes[4] & 0xff) == 0x0d
                        && (bytes[5] & 0xff) == 0x0a && (bytes[6] & 0xff) == 0x1a && (bytes[7] & 0xff) == 0x0a;
            case "gif":
                return bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F'
                        && bytes[3] == '8' && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a';
            case "webp":
                return bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F'
                        && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P';
            default:
                return false;
        }
    }
}
