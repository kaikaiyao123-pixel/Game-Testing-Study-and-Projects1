package com.example.blog.web;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.service.HomeService;

/** F1 主页聚合端点（§4.2）。公开读。 */
@RestController
@RequestMapping("/api")
public class HomeController {

    private final HomeService home;

    public HomeController(HomeService home) {
        this.home = home;
    }

    @GetMapping("/home/summary")
    public Map<String, Object> summary(@RequestParam(value = "limit", defaultValue = "8") int limit) {
        int safe = Math.max(1, Math.min(limit, 30));
        return ApiResponse.success(home.summary(safe));
    }
}
