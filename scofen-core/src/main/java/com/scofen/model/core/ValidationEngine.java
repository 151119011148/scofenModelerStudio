package com.scofen.model.core;

import com.scofen.model.metamodel.ContainmentRules;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;

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
            case "UPDATE_DOCUMENTATION", "DELETE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                if (!repository.elementExists(cmd.str("id"))) {
                    throw new ValidationException("Unknown element: " + cmd.str("id"));
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
                if ("generalization".equals(cmd.str("type"))
                        && createsCycle(target, source, repository.relationships())) {
                    throw new ValidationException("Generalization cycle is not allowed");
                }
            }
            case "DELETE_RELATIONSHIP", "DELETE_DIAGRAM" -> require(cmd.str("id"), "id");
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
            return;
        }
        ModelElement parent = repository.findElement(ownerId)
                .orElseThrow(() -> new ValidationException("Owner element not found: " + ownerId));
        ElementType parentType = ElementType.fromAny(parent.type())
                .orElseThrow(() -> new ValidationException("Unknown owner element type: " + parent.type()));
        if (!ContainmentRules.allows(parentType, child)) {
            throw new ValidationException("Containment rule violation: " + parentType.label()
                    + " (" + parentType + ") cannot own " + child.label() + " (" + child + ")");
        }
    }

    private void assertDiagramAllows(DiagramKind kind, ElementType type) {
        if (!MetamodelRegistry.allows(kind, type)) {
            throw new ValidationException("Element type " + type
                    + " is not allowed on " + kind.label());
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
