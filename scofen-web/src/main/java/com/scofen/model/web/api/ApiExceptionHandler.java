package com.scofen.model.web.api;

import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(RevisionConflictException.class)
    public ResponseEntity<Map<String, Object>> conflict(RevisionConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "error", "revision_conflict",
                "message", ex.getMessage(),
                "clientRevision", ex.expected(),
                "serverRevision", ex.actual()));
    }

    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<Map<String, Object>> invalid(ValidationException ex) {
        return ResponseEntity.badRequest().body(Map.of(
                "error", "validation_failed",
                "message", ex.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> illegalState(IllegalStateException ex) {
        return ResponseEntity.badRequest().body(Map.of(
                "error", "illegal_state",
                "message", ex.getMessage()));
    }

    /**
     * ResponseStatusException（用户管理/角色管理等接口的参数校验）默认由 Spring 转成空体或隐藏 message 的错误页，
     * 前端只能看到「HTTP 400」而不知道哪里错了。这里统一带出 reason，匹配 PermissionInterceptor 的错误格式。
     */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> status(ResponseStatusException ex) {
        String reason = ex.getReason() == null ? ex.getStatusCode().toString() : ex.getReason();
        return ResponseEntity.status(ex.getStatusCode()).body(Map.of(
                "error", "request_rejected",
                "message", reason));
    }
}
