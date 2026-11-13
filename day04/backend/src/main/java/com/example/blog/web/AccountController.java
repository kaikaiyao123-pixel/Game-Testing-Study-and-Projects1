package com.example.blog.web;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.service.AccountService;

/** F0/F7 账号设置与安全管理端点（§4.2）。全部需要登录。 */
@RestController
@RequestMapping("/api/account")
public class AccountController {

    private final AccountService account;

    public AccountController(AccountService account) {
        this.account = account;
    }

    @GetMapping("/sessions")
    public Map<String, Object> sessions(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResponse.success(account.listSessions(bearer(authorization)));
    }

    @DeleteMapping("/sessions/{token}")
    public Map<String, Object> revoke(@PathVariable("token") String token) {
        account.revokeSession(token);
        return ApiResponse.success("已退出该设备");
    }

    @PostMapping("/sessions/logout-others")
    public Map<String, Object> logoutOthers(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        account.revokeOthers(bearer(authorization));
        return ApiResponse.success("已退出其他设备");
    }

    @GetMapping("/login-logs")
    public Map<String, Object> loginLogs(
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort) {
        int p = toInt(page);
        int s = toInt(size);
        return ApiResponse.success(account.loginLogs(p, s, sort));
    }

    @PostMapping("/password")
    public Map<String, Object> changePassword(@RequestBody Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        account.changePassword(str(body, "oldPassword"), str(body, "newPassword"), bearer(authorization));
        return ApiResponse.success("密码已修改，其他设备已退出");
    }

    @GetMapping("/preferences")
    public Map<String, Object> getPreferences() {
        return ApiResponse.success(account.getPreferences());
    }

    @PutMapping("/preferences")
    public Map<String, Object> updatePreferences(@RequestBody Map<String, Object> body) {
        return ApiResponse.success(account.updatePreferences(body));
    }

    @PostMapping("/export")
    public Map<String, Object> exportData() {
        return ApiResponse.success(account.exportData());
    }

    @PostMapping("/delete")
    public Map<String, Object> deleteAccount() {
        account.deleteAccount();
        return ApiResponse.success("账号已注销");
    }

    private static String bearer(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) return null;
        return header.substring(7).trim();
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static int toInt(String s) {
        if (s == null || s.isBlank()) return 0;
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException ex) {
            return 0;
        }
    }
}
