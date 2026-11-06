package com.scofen.model.web.rbac;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 声明端点所需的权限。多个权限是「与」关系：必须全部满足。
 *
 * <p>方法上的注解优先于类上的；两者都没有则该端点只要求「已登录」。</p>
 */
@Documented
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {

    Permission[] value();
}
