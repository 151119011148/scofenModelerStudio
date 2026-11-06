package com.scofen.model.web.config;

import com.scofen.model.web.rbac.PermissionInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 把权限拦截器挂到 /api/** 上。
 *
 * <p>认证在 AuthFilter（Servlet 过滤器）里完成，权限在拦截器里完成：
 * 过滤器管「有没有登录」，拦截器管「能不能做这件事」，
 * 后者能读到方法注解，因此门控粒度到端点。</p>
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final PermissionInterceptor permissionInterceptor;

    public WebMvcConfig(PermissionInterceptor permissionInterceptor) {
        this.permissionInterceptor = permissionInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(permissionInterceptor).addPathPatterns("/api/**");
    }
}
