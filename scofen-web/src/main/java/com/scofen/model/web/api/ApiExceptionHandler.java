package com.scofen.model.web.api;

import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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
}
