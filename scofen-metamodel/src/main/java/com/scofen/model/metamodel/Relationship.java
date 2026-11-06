package com.scofen.model.metamodel;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 关系独立于元素存储，端点用 id 引用，不内嵌对象。
 *
 * <p>关系同样是模型对象：与 {@link ModelElement} 一样带名称、文档、构造型、标记值与
 * 规范元属性包。{@code properties} 承载 {@link PropertyCatalog} 中该关系类型登记的
 * 可编辑元属性（按规范原名作键），计算 / 派生属性不落库。</p>
 */
public record Relationship(
        String id,
        String type,
        String sourceId,
        String targetId,
        String name,
        String documentation,
        List<String> stereotypes,
        String ownerId,
        Map<String, String> taggedValues,
        Map<String, Object> properties) {

    public Relationship {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(sourceId, "sourceId");
        Objects.requireNonNull(targetId, "targetId");
        stereotypes = stereotypes == null ? List.of() : List.copyOf(stereotypes);
        taggedValues = taggedValues == null ? Map.of() : Map.copyOf(taggedValues);
        properties = properties == null ? Map.of() : Map.copyOf(properties);
    }

    /** 兼容 M0 既有调用：仅端点 + 可选的拥有者与标记值。 */
    public Relationship(String id, String type, String sourceId, String targetId,
                        String ownerId, Map<String, String> taggedValues) {
        this(id, type, sourceId, targetId, "", "", List.of(), ownerId, taggedValues, Map.of());
    }

    public static Relationship of(String id, String type, String sourceId, String targetId) {
        return new Relationship(id, type, sourceId, targetId, null, Map.of());
    }

    /** 显示名：未命名时回退为 «type» 端点，由界面按需拼接。 */
    public String displayName() {
        return name == null || name.isBlank() ? "«" + type + "»" : name;
    }

    public Relationship withName(String newName) {
        return new Relationship(id, type, sourceId, targetId, newName, documentation,
                stereotypes, ownerId, taggedValues, properties);
    }

    public Relationship withDocumentation(String text) {
        return new Relationship(id, type, sourceId, targetId, name, text,
                stereotypes, ownerId, taggedValues, properties);
    }

    public Relationship withStereotypes(List<String> values) {
        return new Relationship(id, type, sourceId, targetId, name, documentation,
                values, ownerId, taggedValues, properties);
    }

    public Relationship withTaggedValues(Map<String, String> values) {
        return new Relationship(id, type, sourceId, targetId, name, documentation,
                stereotypes, ownerId, values, properties);
    }

    /** 通用属性写入：核心字段落到专用成员，其余进扩展属性包；value 为 null 表示清空。 */
    public Relationship withProperty(String key, Object value) {
        return switch (key) {
            case "name" -> withName(value == null ? "" : String.valueOf(value));
            case "documentation" -> withDocumentation(value == null ? "" : String.valueOf(value));
            case "stereotypes" -> withStereotypes(toList(value));
            case "taggedValues" -> withTaggedValues(toStringMap(value));
            default -> {
                Map<String, Object> next = new LinkedHashMap<>(properties);
                if (value == null) {
                    next.remove(key);
                } else {
                    next.put(key, value);
                }
                yield new Relationship(id, type, sourceId, targetId, name, documentation,
                        stereotypes, ownerId, taggedValues, Map.copyOf(next));
            }
        };
    }

    /** 读取当前属性值，供 UPDATE_PROPERTY 生成逆命令使用。 */
    public Object property(String key) {
        return switch (key) {
            case "id" -> id;
            case "name" -> name;
            case "documentation" -> documentation;
            case "stereotypes" -> stereotypes;
            case "taggedValues" -> taggedValues;
            case "sourceId" -> sourceId;
            case "targetId" -> targetId;
            case "ownerId" -> ownerId;
            case "relationshipType", "type" -> type;
            default -> properties.get(key);
        };
    }

    private static List<String> toList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        if (value instanceof String text && !text.isBlank()) {
            return List.of(text.split("\\s*,\\s*"));
        }
        return List.of();
    }

    private static Map<String, String> toStringMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException("taggedValues must be an object");
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
        }
        return Map.copyOf(result);
    }
}
