package com.scofen.model.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 模型快照的 JSON 编解码。
 *
 * <p>为什么不用 {@code ObjectMapper} 直接读写 record：{@code properties} 的类型是
 * {@code Map<String, Object>}，Jackson 反序列化后会把
 * {@code List<String>} 变成 {@code List<Object>}——元素内容不丢，但类型信息丢了，
 * 下游按 {@code List<String>} 读取时就会出现难以定位的 {@code ClassCastException}。
 * 持久化与 XMI 往返都要过这一关，所以在这里显式把多值属性还原成
 * {@code List<String>}（规范里只有 STRING_LIST / REFERENCE_LIST 两种列表型，
 * 元素都是文本）。</p>
 *
 * <p>另外用 {@link JsonNode} 手工装配，而不是靠 record 的默认构造，
 * 这样字段缺失（旧快照 / 第三方导出）也能安全降级，而不是整份快照读不出来。</p>
 */
public final class SnapshotCodec {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SnapshotCodec() {
    }

    /** 序列化为 JSON 文本。 */
    public static String toJson(ModelSnapshot snapshot) {
        try {
            return MAPPER.writeValueAsString(snapshot);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("序列化模型快照失败", ex);
        }
    }

    /** 序列化任意对象（侧车等普通 Map 用这个）。 */
    public static String toJsonObject(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("序列化 JSON 失败", ex);
        }
    }

    /** 从 JSON 文本还原为普通 Map（侧车解析用）。 */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> fromMap(String json) {
        try {
            Object value = normalize(MAPPER.readTree(json));
            return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("反序列化 JSON 失败", ex);
        }
    }

    /** 从 JSON 文本还原快照。 */
    public static ModelSnapshot fromJson(String json) {
        try {
            JsonNode root = MAPPER.readTree(json);
            List<ModelElement> elements = new ArrayList<>();
            for (JsonNode node : root.path("elements")) {
                elements.add(readElement(node));
            }
            List<Relationship> relationships = new ArrayList<>();
            for (JsonNode node : root.path("relationships")) {
                relationships.add(readRelationship(node));
            }
            List<Diagram> diagrams = new ArrayList<>();
            for (JsonNode node : root.path("diagrams")) {
                diagrams.add(readDiagram(node));
            }
            List<Notation> notations = new ArrayList<>();
            for (JsonNode node : root.path("notations")) {
                notations.add(readNotation(node));
            }
            return new ModelSnapshot(root.path("revision").asLong(),
                    elements, relationships, diagrams, notations);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("反序列化模型快照失败", ex);
        }
    }

    private static ModelElement readElement(JsonNode node) {
        return new ModelElement(
                node.path("id").asText(),
                node.path("type").asText(),
                node.path("name").asText(),
                readStringList(node.path("stereotypes")),
                node.path("ownerId").asText(null),
                node.path("documentation").asText(""),
                readStringMap(node.path("taggedValues")),
                node.path("xmiId").asText(null),
                readValueMap(node.path("properties")));
    }

    private static Relationship readRelationship(JsonNode node) {
        return new Relationship(
                node.path("id").asText(),
                node.path("type").asText(),
                node.path("sourceId").asText(),
                node.path("targetId").asText(),
                node.path("name").asText(""),
                node.path("documentation").asText(""),
                readStringList(node.path("stereotypes")),
                node.path("ownerId").asText(null),
                readStringMap(node.path("taggedValues")),
                readValueMap(node.path("properties")));
    }

    private static Diagram readDiagram(JsonNode node) {
        return new Diagram(
                node.path("id").asText(),
                DiagramKind.fromCode(node.path("kind").asText()),
                node.path("name").asText(""),
                node.path("ownerId").asText(null),
                readStringList(node.path("elementIds")),
                readStringList(node.path("relationshipIds")));
    }

    private static Notation readNotation(JsonNode node) {
        return new Notation(
                node.path("id").asText(),
                node.path("diagramId").asText(),
                node.path("elementId").asText(),
                node.path("x").asDouble(),
                node.path("y").asDouble(),
                node.path("width").asDouble(),
                node.path("height").asDouble(),
                readStringMap(node.path("style")));
    }

    private static List<String> readStringList(JsonNode node) {
        if (!node.isArray()) {
            return List.of();
        }
        List<String> result = new ArrayList<>(node.size());
        for (JsonNode item : node) {
            result.add(item.asText());
        }
        return List.copyOf(result);
    }

    private static Map<String, String> readStringMap(JsonNode node) {
        if (!node.isObject()) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        node.fields().forEachRemaining(entry -> result.put(entry.getKey(), entry.getValue().asText()));
        return Map.copyOf(result);
    }

    /** 属性包：按值形态还原，文本数组一律还原成 {@code List<String>}。 */
    private static Map<String, Object> readValueMap(JsonNode node) {
        if (!node.isObject()) {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        node.fields().forEachRemaining(entry -> result.put(entry.getKey(), normalize(entry.getValue())));
        // 不能用 Map.copyOf：它拒绝 null 值，而 JSON 里 null 是合法值。
        return java.util.Collections.unmodifiableMap(result);
    }

    private static Object normalize(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        if (node.isArray()) {
            boolean allText = true;
            for (JsonNode item : node) {
                if (!item.isTextual()) {
                    allText = false;
                    break;
                }
            }
            if (allText) {
                List<String> texts = new ArrayList<>(node.size());
                for (JsonNode item : node) {
                    texts.add(item.asText());
                }
                return List.copyOf(texts);
            }
            List<Object> values = new ArrayList<>(node.size());
            for (JsonNode item : node) {
                values.add(normalize(item));
            }
            return List.copyOf(values);
        }
        if (node.isTextual()) {
            return node.asText();
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isIntegralNumber()) {
            return node.asInt();
        }
        if (node.isFloatingPointNumber()) {
            return node.asDouble();
        }
        if (node.isObject()) {
            Map<String, Object> result = new LinkedHashMap<>();
            node.fields().forEachRemaining(entry -> result.put(entry.getKey(), normalize(entry.getValue())));
            return java.util.Collections.unmodifiableMap(result);
        }
        return node.asText();
    }
}
