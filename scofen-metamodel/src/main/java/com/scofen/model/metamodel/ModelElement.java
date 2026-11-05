package com.scofen.model.metamodel;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 语义层唯一事实源。不可变：改名产生新对象，所有 Diagram 引用同一个 id。
 *
 * <p>除 UML 核心字段外，{@code properties} 承载 {@link PropertyCatalog} 登记的
 * 全部可编辑元属性（按规范原名作键）；计算/派生属性不落库，由界面实时计算。</p>
 */
public record ModelElement(
        String id,
        String type,
        String name,
        List<String> stereotypes,
        String ownerId,
        String documentation,
        Map<String, String> taggedValues,
        String xmiId,
        Map<String, Object> properties) {

    public ModelElement {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(type, "type");
        stereotypes = stereotypes == null ? List.of() : List.copyOf(stereotypes);
        taggedValues = taggedValues == null ? Map.of() : Map.copyOf(taggedValues);
        properties = properties == null ? Map.of() : Map.copyOf(properties);
    }

    /** 兼容 M0 既有调用：默认不带扩展属性。 */
    public ModelElement(String id, String type, String name, List<String> stereotypes,
                        String ownerId, String documentation, Map<String, String> taggedValues,
                        String xmiId) {
        this(id, type, name, stereotypes, ownerId, documentation, taggedValues, xmiId, Map.of());
    }

    public static ModelElement of(String id, String type, String name, String ownerId) {
        return new ModelElement(id, type, name, List.of(), ownerId, "", Map.of(), null);
    }

    public ModelElement withName(String newName) {
        return new ModelElement(id, type, newName, stereotypes, ownerId, documentation,
                taggedValues, xmiId, properties);
    }

    public ModelElement withDocumentation(String text) {
        return new ModelElement(id, type, name, stereotypes, ownerId, text, taggedValues, xmiId, properties);
    }

    public ModelElement withStereotypes(List<String> values) {
        return new ModelElement(id, type, name, values, ownerId, documentation, taggedValues, xmiId, properties);
    }

    public ModelElement withTaggedValues(Map<String, String> values) {
        return new ModelElement(id, type, name, stereotypes, ownerId, documentation, values, xmiId, properties);
    }

    public ModelElement withXmiId(String value) {
        return new ModelElement(id, type, name, stereotypes, ownerId, documentation, taggedValues, value, properties);
    }

    /** 通用属性写入：核心字段落到专用成员，其余进扩展属性包；value 为 null 表示清空。 */
    public ModelElement withProperty(String key, Object value) {
        return switch (key) {
            case "name" -> withName(value == null ? "" : String.valueOf(value));
            case "documentation" -> withDocumentation(value == null ? "" : String.valueOf(value));
            case "stereotypes" -> withStereotypes(toList(value));
            case "taggedValues" -> withTaggedValues(toStringMap(value));
            case "xmiId" -> withXmiId(value == null ? null : String.valueOf(value));
            default -> {
                Map<String, Object> next = new LinkedHashMap<>(properties);
                if (value == null) {
                    next.remove(key);
                } else {
                    next.put(key, value);
                }
                yield new ModelElement(id, type, name, stereotypes, ownerId, documentation,
                        taggedValues, xmiId, Map.copyOf(next));
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
            case "xmiId" -> xmiId;
            case "ownerId" -> ownerId;
            default -> properties.get(key);
        };
    }

    @SuppressWarnings("unchecked")
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
