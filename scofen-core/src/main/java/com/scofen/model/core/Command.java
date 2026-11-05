package com.scofen.model.core;

import java.util.Map;
import java.util.Objects;

/** 客户端发往服务端的唯一写入通道。 */
public record Command(String type, Map<String, Object> payload, long baseRevision, String clientCmdId) {

    public Command {
        Objects.requireNonNull(type, "type");
        payload = payload == null ? Map.of() : Map.copyOf(payload);
    }

    public static Command of(String type, long baseRevision, String clientCmdId, Map<String, Object> payload) {
        return new Command(type, payload, baseRevision, clientCmdId);
    }

    public String str(String key) {
        Object value = payload.get(key);
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    public java.util.List<String> strList(String key) {
        Object value = payload.get(key);
        if (value == null) {
            return java.util.List.of();
        }
        return ((java.util.List<Object>) value).stream().map(String::valueOf).toList();
    }

    /** RESTORE_SUBTREE 之类的复合命令用：读取嵌套对象列表。 */
    @SuppressWarnings("unchecked")
    public java.util.List<java.util.Map<String, Object>> mapList(String key) {
        Object value = payload.get(key);
        if (value == null) {
            return java.util.List.of();
        }
        return ((java.util.List<Object>) value).stream()
                .map(item -> (java.util.Map<String, Object>) item)
                .toList();
    }

    public double decimal(String key) {
        Object value = payload.get(key);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (RuntimeException ex) {
            throw new ValidationException("Invalid numeric field: " + key);
        }
    }
}
