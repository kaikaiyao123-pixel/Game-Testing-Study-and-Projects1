package com.example.blog.foundation.web;

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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.config.MultipartConfig;
import com.example.blog.foundation.repository.UploadRepository;
import com.example.blog.foundation.security.AuthContext;

/**
 * 统一图片上传端点（文档 §6 本地磁盘 + 相对 URL；P9 写操作必须登录）。
 *
 * 上传防护（§5.9）：扩展名白名单 + MIME 白名单 + 文件头魔数三重校验、
 * 大小上限、服务端 UUID 重命名。客户端文件名只用于取扩展名，绝不参与存储路径，
 * 因此天然免疫目录穿越；静态映射只读，不提供脚本执行能力。
 */
@RestController
public class UploadController {

    private static final Map<String, String> ALLOWED = Map.of(
            "jpg", "image/jpeg",
            "jpeg", "image/jpeg",
            "png", "image/png",
            "webp", "image/webp",
            "gif", "image/gif");

    private final UploadRepository uploads;
    private final Path uploadDir;

    public UploadController(UploadRepository uploads,
                            @Value("${blog.upload.dir:data/uploads}") String dir) {
        this.uploads = uploads;
        this.uploadDir = Paths.get(dir).toAbsolutePath().normalize();
    }

    @PostMapping("/api/uploads")
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file) {
        String userId = AuthContext.requireLogin();
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "上传文件不能为空");
        }
        long size = file.getSize();
        if (size > MultipartConfig.MAX_FILE_SIZE) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "文件超过 2 MB 上限");
        }

        String ext = extension(file.getOriginalFilename());
        if (ext == null) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "仅支持 jpg / jpeg / png / webp / gif");
        }
        String expectedMime = ALLOWED.get(ext);
        String declared = file.getContentType();
        if (declared == null || !declared.equalsIgnoreCase(expectedMime)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "文件 MIME 与扩展名不匹配");
        }

        final byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "无法读取上传文件");
        }
        if (!magicMatches(ext, bytes)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "文件内容不是合法图片");
        }

        String objectKey = UUID.randomUUID().toString() + "." + ext;
        String url = "/uploads/" + objectKey;
        try {
            Files.createDirectories(uploadDir);
            Path target = uploadDir.resolve(objectKey).normalize();
            if (!uploadDir.equals(target.getParent())) {
                throw new BizException(ErrorCode.VALIDATION_ERROR, "非法存储路径");
            }
            Files.write(target, bytes);
        } catch (BizException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new BizException(ErrorCode.INTERNAL_ERROR, "文件写入失败");
        }
        uploads.save(new UploadRepository.Record(
                objectKey, userId, url, expectedMime, size, System.currentTimeMillis()));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("url", url);
        data.put("objectKey", objectKey);
        data.put("sizeBytes", size);
        data.put("mime", expectedMime);
        data.put("ownerId", userId);
        return ApiResponse.success("上传成功", data);
    }

    /** 读取上传元数据：仅 owner 可读，越权一律 404（文档 §5.4，避免存在性泄露）。 */
    @GetMapping("/api/uploads/{key}")
    public Map<String, Object> metadata(@PathVariable("key") String key) {
        AuthContext.requireLogin();
        UploadRepository.Record record = uploads.findByKey(key)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "资源不存在"));
        AuthContext.requireOwner(record.ownerId());

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("url", record.url());
        data.put("objectKey", record.objectKey());
        data.put("sizeBytes", record.sizeBytes());
        data.put("mime", record.mime());
        data.put("createdAtMs", record.createdAtMs());
        return ApiResponse.success(data);
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
                return bytes.length >= 8 && (bytes[0] & 0xff) == 0x89
                        && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G'
                        && (bytes[4] & 0xff) == 0x0d && (bytes[5] & 0xff) == 0x0a
                        && (bytes[6] & 0xff) == 0x1a && (bytes[7] & 0xff) == 0x0a;
            case "gif":
                return bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I'
                        && bytes[2] == 'F' && bytes[3] == '8'
                        && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a';
            case "webp":
                return bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I'
                        && bytes[2] == 'F' && bytes[3] == 'F'
                        && bytes[8] == 'W' && bytes[9] == 'E'
                        && bytes[10] == 'B' && bytes[11] == 'P';
            default:
                return false;
        }
    }
}
