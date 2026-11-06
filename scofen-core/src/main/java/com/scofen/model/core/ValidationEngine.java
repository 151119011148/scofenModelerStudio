package com.scofen.model.core;

import com.scofen.model.metamodel.ContainmentRules;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.metamodel.Relationship;
import com.scofen.model.metamodel.RelationshipType;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 服务端规则引擎。命名唯一性用规范化字符串比较，
 * 对应 MySQL 8.4 默认 utf8mb4_0900_ai_ci 不区分大小写/重音，不能只靠 UNIQUE 约束。
 *
 * <p>新建元素必须同时满足：类型在元模型注册表内、父元素存在且包含关系合规、
 * 同命名空间命名唯一、名称格式合法、若加入图则该图允许此类型。</p>
 */
public final class ValidationEngine {

    /** 画布上限与节点尺寸：服务端下发，前端拖拽用同一组常量做边界约束。 */
    public static final double CANVAS_MAX_X = 480.0;
    public static final double CANVAS_MAX_Y = 340.0;
    public static final double NODE_WIDTH = InMemoryModelRepository.NODE_WIDTH;
    public static final double NODE_HEIGHT = InMemoryModelRepository.NODE_HEIGHT;

    public void validate(Command cmd, InMemoryModelRepository repository) {
        switch (cmd.type()) {
            case "CREATE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("type"), "type");
                require(cmd.str("name"), "name");
                ElementType child = ElementType.fromAny(cmd.str("type"))
                        .orElseThrow(() -> new ValidationException("Unknown element type: " + cmd.str("type")));
                assertNameFormat(cmd.str("name"));
                assertContainment(repository, cmd.str("ownerId"), child);
                assertNameIsUnique(repository, cmd.str("ownerId"), cmd.str("name"), null);
                assertOptionalPosition(cmd);
                String diagramId = cmd.str("diagramId");
                if (diagramId != null && !diagramId.isBlank()) {
                    Diagram diagram = repository.findDiagram(diagramId)
                            .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                    assertDiagramAllows(diagram.kind(), child);
                }
            }
            case "RENAME_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                assertNameFormat(cmd.str("name"));
                ModelElement current = repository.findElement(cmd.str("id"))
                        .orElseThrow(() -> new ValidationException("Unknown element: " + cmd.str("id")));
                assertNameIsUnique(repository, current.ownerId(), cmd.str("name"), current.id());
            }
            case "UPDATE_DOCUMENTATION" -> {
                require(cmd.str("id"), "id");
                if (!repository.elementExists(cmd.str("id"))) {
                    throw new ValidationException("Unknown element: " + cmd.str("id"));
                }
            }
            case "UPDATE_PROPERTY" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("key"), "key");
                String targetId = cmd.str("id");
                String key = cmd.str("key");
                boolean remove = Boolean.TRUE.equals(cmd.payload().get("remove"));
                Object value = cmd.payload().get("value");

                ModelElement element = repository.findElement(targetId).orElse(null);
                if (element != null) {
                    ElementType type = ElementType.fromAny(element.type())
                            .orElseThrow(() -> new ValidationException("Unknown element type: " + element.type()));
                    PropertyCatalog.PropertySpec spec = PropertyCatalog.find(type, key);
                    if (spec == null) {
                        throw new ValidationException("属性不在 " + type.umlName() + " 的 UML/SysML 规范清单中: " + key);
                    }
                    if (!spec.editable()) {
                        throw new ValidationException("计算属性 / 派生属性不可修改（UML 规范只读）: " + key);
                    }
                    assertPropertyValue(repository, spec, value, remove);
                    if ("name".equals(key) && !remove) {
                        assertNameFormat(String.valueOf(value));
                        assertNameIsUnique(repository, element.ownerId(), String.valueOf(value), element.id());
                    }
                    return;
                }

                // 关系同样是模型对象：属性窗口按关系类型的元类链校验，端点与标识只读。
                Relationship relationship = repository.findRelationship(targetId)
                        .orElseThrow(() -> new ValidationException("Unknown model object: " + targetId));
                RelationshipType relType = RelationshipType.fromAny(relationship.type())
                        .orElseThrow(() -> new ValidationException(
                                "Unknown relationship type: " + relationship.type()));
                PropertyCatalog.PropertySpec relSpec = PropertyCatalog.find(relType, key);
                if (relSpec == null) {
                    throw new ValidationException("属性不在关系 «" + relType.code()
                            + "» 的 UML/SysML 规范清单中: " + key);
                }
                if (!relSpec.editable()) {
                    throw new ValidationException("计算属性 / 派生属性不可修改（UML 规范只读）: " + key);
                }
                assertPropertyValue(repository, relSpec, value, remove);
                if ("name".equals(key) && !remove) {
                    assertNameFormat(String.valueOf(value));
                }
            }
            case "DELETE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                ModelElement target = repository.findElement(cmd.str("id"))
                        .orElseThrow(() -> new ValidationException("Unknown element: " + cmd.str("id")));
                if (isProjectRoot(target)) {
                    throw new ValidationException(
                            "项目根节点模型不可删除：Model 是模型树的唯一项目根；"
                                    + "如需清空项目请删除其下的子元素。");
                }
            }
            case "RESTORE_SUBTREE" -> {
                require(cmd.str("rootId"), "rootId");
                if (cmd.mapList("elements").isEmpty()) {
                    throw new ValidationException("Nothing to restore");
                }
            }
            case "MOVE_NOTATION" -> {
                String diagramId = cmd.str("diagramId");
                String elementId = cmd.str("elementId");
                require(diagramId, "diagramId");
                require(elementId, "elementId");
                Diagram diagram = repository.findDiagram(diagramId)
                        .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                if (!diagram.elementIds().contains(elementId)) {
                    throw new ValidationException("Element " + elementId + " is not on diagram " + diagramId);
                }
                double x = cmd.decimal("x");
                double y = cmd.decimal("y");
                if (!Double.isFinite(x) || !Double.isFinite(y)
                        || x < 0 || y < 0 || x > CANVAS_MAX_X || y > CANVAS_MAX_Y) {
                    throw new ValidationException("Notation position out of canvas: " + x + "," + y);
                }
            }
            case "DELETE_NOTATION" -> require(cmd.str("id"), "id");
            case "CREATE_RELATIONSHIP" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("type"), "type");
                String source = cmd.str("sourceId");
                String target = cmd.str("targetId");
                if (!repository.elementExists(source) || !repository.elementExists(target)) {
                    throw new ValidationException("Relationship endpoints must exist: " + source + " -> " + target);
                }
                RelationshipType relType = RelationshipType.fromAny(cmd.str("type"))
                        .orElseThrow(() -> new ValidationException(
                                "Unknown relationship type: " + cmd.str("type")));
                // 带上 diagramId 时按图规范校验：组件工具箱只显示当前图允许的关系，服务端不信任前端过滤。
                String diagramId = cmd.str("diagramId");
                if (diagramId != null && !diagramId.isBlank()) {
                    Diagram diagram = repository.findDiagram(diagramId)
                            .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                    if (!MetamodelRegistry.allowsRelationship(diagram.kind(), relType)) {
                        throw new ValidationException("Relationship «" + relType.code()
                                + "» is not allowed on " + diagram.kind().label());
                    }
                }
                if ("generalization".equals(cmd.str("type"))
                        && createsCycle(target, source, repository.relationships())) {
                    throw new ValidationException("Generalization cycle is not allowed");
                }
            }
            case "DELETE_RELATIONSHIP", "DELETE_DIAGRAM" -> require(cmd.str("id"), "id");
            case "RENAME_DIAGRAM" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                if (repository.findDiagram(cmd.str("id")).isEmpty()) {
                    throw new ValidationException("Unknown diagram: " + cmd.str("id"));
                }
            }
            case "CREATE_DIAGRAM" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                require(cmd.str("kind"), "kind");
                DiagramKind kind;
                try {
                    kind = DiagramKind.fromCode(cmd.str("kind"));
                } catch (IllegalArgumentException ex) {
                    throw new ValidationException("Unknown diagram kind: " + cmd.str("kind"));
                }
                for (String ref : cmd.strList("elementIds")) {
                    ModelElement element = repository.findElement(ref)
                            .orElseThrow(() -> new ValidationException("Diagram references missing element: " + ref));
                    ElementType.fromAny(element.type()).ifPresent(type -> assertDiagramAllows(kind, type));
                }
            }
            case "ADD_TO_DIAGRAM" -> {
                String diagramId = cmd.str("diagramId");
                String elementId = cmd.str("elementId");
                Diagram diagram = repository.findDiagram(diagramId)
                        .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                ModelElement element = repository.findElement(elementId)
                        .orElseThrow(() -> new ValidationException("Unknown element: " + elementId));
                ElementType.fromAny(element.type()).ifPresent(type -> assertDiagramAllows(diagram.kind(), type));
                assertOptionalPosition(cmd);
            }
            case "REMOVE_FROM_DIAGRAM" -> require(cmd.str("diagramId"), "diagramId");
            default -> throw new ValidationException("Unknown command type: " + cmd.type());
        }
    }

    /** 只按 affectedIds 涉及的分组做增量校验，结果随 Patch 广播。 */
    public String validateIncremental(ModelSnapshot snapshot, List<String> affectedIds) {
        List<String> issues = new ArrayList<>();
        Set<String> elementIds = new HashSet<>();
        for (ModelElement element : snapshot.elements()) {
            elementIds.add(element.id());
        }
        Set<String> diagramIds = new HashSet<>();
        for (Diagram diagram : snapshot.diagrams()) {
            diagramIds.add(diagram.id());
            for (String ref : diagram.elementIds()) {
                if (!elementIds.contains(ref)) {
                    issues.add("diagram " + diagram.id() + " references missing element " + ref);
                }
            }
        }
        for (Notation notation : snapshot.notations()) {
            if (!elementIds.contains(notation.elementId())
                    && (affectedIds.contains(notation.elementId()) || affectedIds.contains(notation.id()))) {
                issues.add("notation " + notation.id() + " has dangling element");
            }
            if (!diagramIds.contains(notation.diagramId()) && affectedIds.contains(notation.id())) {
                issues.add("notation " + notation.id() + " has dangling diagram");
            }
        }
        for (Relationship relationship : snapshot.relationships()) {
            if (!elementIds.contains(relationship.sourceId()) && affectedIds.contains(relationship.sourceId())) {
                issues.add("relationship " + relationship.id() + " has dangling source");
            }
            if (!elementIds.contains(relationship.targetId()) && affectedIds.contains(relationship.targetId())) {
                issues.add("relationship " + relationship.id() + " has dangling target");
            }
        }
        for (ModelElement element : snapshot.elements()) {
            if (!affectedIds.contains(element.id())) {
                continue;
            }
            for (ModelElement other : snapshot.elements()) {
                if (!element.id().equals(other.id())
                        && normalizeOwner(element.ownerId()).equals(normalizeOwner(other.ownerId()))
                        && normalize(element.name()).equals(normalize(other.name()))) {
                    issues.add("duplicate name in namespace " + normalizeOwner(element.ownerId())
                            + ": " + element.name());
                    break;
                }
            }
        }
        return issues.isEmpty() ? "ok" : String.join("; ", issues);
    }

    /** 所有权规则：根节点只能是顶层容器；非根节点必须挂在允许包含该类型的父元素下。 */
    private void assertContainment(InMemoryModelRepository repository, String ownerId, ElementType child) {
        if (ownerId == null || ownerId.isBlank()) {
            if (!ContainmentRules.isRootAllowed(child)) {
                throw new ValidationException("Root element must be one of "
                        + ContainmentRules.ROOT_TYPES + "; got " + child);
            }
            // 单项目单根：项目根 Model 是模型树的唯一顶层节点，不允许再建第二个顶层 Model。
            if (child == ElementType.MODEL
                    && repository.elements().stream().anyMatch(ValidationEngine::isProjectRoot)) {
                throw new ValidationException("一个项目只能有一个根 Model；请在已有项目根下新建子元素");
            }
            return;
        }
        ModelElement parent = repository.findElement(ownerId)
                .orElseThrow(() -> {
                    if (repository.findDiagram(ownerId).isPresent()) {
                        throw new ValidationException(
                                "Containment violation (SysML 规范): 不能在「图」下创建模型元素；"
                                        + "元素必须挂在包/块等模型元素下，图仅通过引用承载元素。");
                    }
                    throw new ValidationException("Owner element not found: " + ownerId);
                });
        ElementType parentType = ElementType.fromAny(parent.type())
                .orElseThrow(() -> new ValidationException("Unknown owner element type: " + parent.type()));
        if (!ContainmentRules.allows(parentType, child)) {
            throw new ValidationException("Containment rule violation: " + parentType.label()
                    + " (" + parentType + ") cannot own " + child.label() + " (" + child + ")");
        }
    }

    /** 项目根判定：顶层（ownerId 为空）且类型为 Model。供「唯一根」与「根不可删除」共用。 */
    private static boolean isProjectRoot(ModelElement element) {
        return (element.ownerId() == null || element.ownerId().isBlank())
                && ElementType.fromAny(element.type())
                        .filter(type -> type == ElementType.MODEL)
                        .isPresent();
    }

    /**
     * CREATE_ELEMENT / ADD_TO_DIAGRAM 可携带 x、y（拖放落点）。
     * 未提供时走默认格点布局；提供时必须与 MOVE_NOTATION 使用同一套画布边界。
     */
    private void assertOptionalPosition(Command cmd) {
        if (cmd.payload().get("x") == null && cmd.payload().get("y") == null) {
            return;
        }
        double x = cmd.decimal("x");
        double y = cmd.decimal("y");
        if (!Double.isFinite(x) || !Double.isFinite(y)
                || x < 0 || y < 0 || x > CANVAS_MAX_X || y > CANVAS_MAX_Y) {
            throw new ValidationException("Notation position out of canvas: " + x + "," + y);
        }
    }

    private void assertDiagramAllows(DiagramKind kind, ElementType type) {
        if (!MetamodelRegistry.allows(kind, type)) {
            throw new ValidationException("Element type " + type
                    + " is not allowed on " + kind.label());
        }
    }

    /**
     * 通用属性写入的值类型校验：与 PropertyCatalog 声明的 ValueKind 一致。
     *
     * <p>引用型属性额外要求被引用的元素真实存在——界面上引用以「缩略图 + 名称」呈现，
     * 指向不存在的 id 只会显示成「未引用的元素」，属于脏数据。</p>
     */
    private void assertPropertyValue(InMemoryModelRepository repository,
            PropertyCatalog.PropertySpec spec, Object value, boolean remove) {
        if (remove) {
            return;
        }
        if (value == null) {
            throw new ValidationException("Missing property value: " + spec.key());
        }
        if ("taggedValues".equals(spec.key())) {
            if (!(value instanceof Map<?, ?>)) {
                throw new ValidationException("taggedValues 必须是 JSON 对象");
            }
            return;
        }
        switch (spec.kind()) {
            case BOOLEAN -> {
                if (!(value instanceof Boolean)) {
                    throw new ValidationException("Boolean property expects true/false: " + spec.key());
                }
            }
            case INTEGER, REAL -> {
                if (!(value instanceof Number)) {
                    throw new ValidationException("Numeric property expects a number: " + spec.key());
                }
            }
            case UNLIMITED_NATURAL -> {
                if (!(value instanceof Number) && !"*".equals(String.valueOf(value))) {
                    throw new ValidationException("UnlimitedNatural expects a number or '*': " + spec.key());
                }
            }
            case ENUM -> {
                if (!spec.options().contains(String.valueOf(value))) {
                    throw new ValidationException("Invalid enumeration value for " + spec.key()
                            + ": " + value + " (allowed: " + spec.options() + ")");
                }
            }
            case REFERENCE_LIST -> {
                if (!(value instanceof List<?>)) {
                    throw new ValidationException("List property expects an array: " + spec.key());
                }
                for (Object item : (List<?>) value) {
                    assertReferenceExists(repository, spec, item);
                }
            }
            case STRING_LIST -> {
                if (!(value instanceof List<?>)) {
                    throw new ValidationException("List property expects an array: " + spec.key());
                }
            }
            case REFERENCE -> {
                if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
                    throw new ValidationException("Text property expects a scalar: " + spec.key());
                }
                assertReferenceExists(repository, spec, value);
            }
            case STRING, TEXT -> {
                if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
                    throw new ValidationException("Text property expects a scalar: " + spec.key());
                }
            }
        }
    }

    /** 引用型属性的目标元素必须存在于当前模型，否则拒绝写入。 */
    private void assertReferenceExists(InMemoryModelRepository repository,
            PropertyCatalog.PropertySpec spec, Object value) {
        if (!PropertyCatalog.referencesElement(spec)) {
            // 少数引用型属性指向的是元模型或表达式文本，不做存在性校验。
            return;
        }
        String id = String.valueOf(value).trim();
        if (id.isEmpty()) {
            throw new ValidationException("引用属性不能为空: " + spec.key());
        }
        if (!repository.elementExists(id)) {
            throw new ValidationException("引用的元素不存在: " + spec.key() + " → " + id);
        }
    }

    private void assertNameFormat(String name) {
        if (name.length() > 120) {
            throw new ValidationException("Element name is too long (max 120 characters)");
        }
        for (int i = 0; i < name.length(); i++) {
            if (Character.isISOControl(name.charAt(i))) {
                throw new ValidationException("Element name must not contain control characters");
            }
        }
    }

    private void assertNameIsUnique(InMemoryModelRepository repository, String ownerId, String name, String selfId) {
        String owner = normalizeOwner(ownerId);
        String normalized = normalize(name);
        for (ModelElement element : repository.elements()) {
            if (Objects.equals(element.id(), selfId)) {
                continue;
            }
            if (normalizeOwner(element.ownerId()).equals(owner) && normalize(element.name()).equals(normalized)) {
                throw new ValidationException("Duplicate element name in namespace " + owner + ": " + name);
            }
        }
    }

    private boolean createsCycle(String start, String target, Collection<Relationship> existing) {
        Map<String, List<String>> parents = new HashMap<>();
        for (Relationship relationship : existing) {
            if ("generalization".equals(relationship.type())) {
                parents.computeIfAbsent(relationship.sourceId(), key -> new ArrayList<>()).add(relationship.targetId());
            }
        }
        return reaches(start, target, parents, new HashSet<>());
    }

    private boolean reaches(String node, String target, Map<String, List<String>> parents, Set<String> seen) {
        if (node.equals(target)) {
            return true;
        }
        if (!seen.add(node)) {
            return false;
        }
        for (String parent : parents.getOrDefault(node, List.of())) {
            if (reaches(parent, target, parents, seen)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeOwner(String ownerId) {
        return ownerId == null ? "" : ownerId.trim();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static void require(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ValidationException("Missing required field: " + field);
        }
    }
}
