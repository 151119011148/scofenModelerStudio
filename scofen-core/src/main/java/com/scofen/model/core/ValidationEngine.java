package com.scofen.model.core;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Relationship;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 服务端规则引擎。命名唯一性用规范化字符串比较，
 * 对应 MySQL 8.4 默认 utf8mb4_0900_ai_ci 不区分大小写/重音，不能只靠 UNIQUE 约束。
 */
public final class ValidationEngine {

    public void validate(Command cmd, InMemoryModelRepository repository) {
        switch (cmd.type()) {
            case "CREATE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("type"), "type");
                require(cmd.str("name"), "name");
                assertNameIsUnique(repository, cmd.str("ownerId"), cmd.str("name"), null);
            }
            case "RENAME_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
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
                try {
                    DiagramKind.fromCode(cmd.str("kind"));
                } catch (IllegalArgumentException ex) {
                    throw new ValidationException("Unknown diagram kind: " + cmd.str("kind"));
                }
                for (String ref : cmd.strList("elementIds")) {
                    if (!repository.elementExists(ref)) {
                        throw new ValidationException("Diagram references missing element: " + ref);
                    }
                }
            }
            case "ADD_TO_DIAGRAM" -> {
                String diagramId = cmd.str("diagramId");
                String elementId = cmd.str("elementId");
                Diagram diagram = repository.findDiagram(diagramId)
                        .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                ModelElement element = repository.findElement(elementId)
                        .orElseThrow(() -> new ValidationException("Unknown element: " + elementId));
                ElementType.fromAny(element.type()).ifPresent(type -> {
                    if (!MetamodelRegistry.allows(diagram.kind(), type)) {
                        throw new ValidationException("Element type " + type
                                + " is not allowed on " + diagram.kind().label());
                    }
                });
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
        for (Diagram diagram : snapshot.diagrams()) {
            for (String ref : diagram.elementIds()) {
                if (!elementIds.contains(ref)) {
                    issues.add("diagram " + diagram.id() + " references missing element " + ref);
                }
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
