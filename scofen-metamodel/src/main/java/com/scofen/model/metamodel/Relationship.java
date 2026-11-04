package com.scofen.model.metamodel;

import java.util.Map;
import java.util.Objects;

/** 关系独立于元素存储，端点用 id 引用，不内嵌对象。 */
public record Relationship(
        String id,
        String type,
        String sourceId,
        String targetId,
        String ownerId,
        Map<String, String> taggedValues) {

    public Relationship {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(sourceId, "sourceId");
        Objects.requireNonNull(targetId, "targetId");
        taggedValues = taggedValues == null ? Map.of() : Map.copyOf(taggedValues);
    }

    public static Relationship of(String id, String type, String sourceId, String targetId) {
        return new Relationship(id, type, sourceId, targetId, null, Map.of());
    }
}
