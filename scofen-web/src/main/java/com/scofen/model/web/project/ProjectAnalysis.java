package com.scofen.model.web.project;

import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.core.ValidationIssue;
import com.scofen.model.core.RequirementCoverage;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Relationship;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;

public final class ProjectAnalysis {
    record Target(String type, String id, String label) {}
    record Difference(String type, String id, String label, String action, String field, Object before, Object after) {}
    record TraceEdge(String sourceId, String targetId, String type, boolean inferred) {}
    record TraceNode(Target target, int depth, List<TraceEdge> path) {}
    record Trace(List<TraceNode> nodes, boolean truncated) {}

    static Target target(ModelSnapshot model, String type, String id) {
        String label = switch (Objects.toString(type, "")) {
            case "element" -> model.elements().stream().filter(item -> item.id().equals(id)).map(ModelElement::name).findFirst().orElse(null);
            case "diagram" -> model.diagrams().stream().filter(item -> item.id().equals(id)).map(Diagram::name).findFirst().orElse(null);
            case "relationship" -> model.relationships().stream().filter(item -> item.id().equals(id))
                    .map(item -> item.name().isBlank() ? item.type() : item.name()).findFirst().orElse(null);
            default -> null;
        };
        if (label == null) throw new ValidationException("模型对象不存在或已删除");
        return new Target(type, id, label);
    }

    public static Map<String, Object> coverage(ModelSnapshot model, List<ProjectWorkflow.Evidence> evidence) {
        var validation = new ValidationEngine();
        List<ValidationIssue> issues = validation.validateFull(model);
        List<RequirementCoverage> coverage = validation.requirementCoverage(model);
        Map<String, ProjectWorkflow.Evidence> byPair = new HashMap<>();
        for (var result : evidence) {
            if (result.revision() == model.revision()) byPair.put(result.requirementId() + "\u0000" + result.testId(), result);
        }
        Map<String, String> results = new LinkedHashMap<>();
        for (var item : coverage) {
            List<ProjectWorkflow.Evidence> applicable = item.verifiedBy().stream()
                    .map(source -> byPair.get(item.id() + "\u0000" + source.id())).filter(Objects::nonNull).toList();
            String status = applicable.stream().anyMatch(result -> result.result().equals("fail")) ? "fail"
                    : applicable.isEmpty() ? "missing" : "pass";
            results.put(item.id(), status);
        }
        return Map.of("revision", model.revision(), "issues", issues, "coverage", coverage, "results", results,
                "counts", Map.of("error", issueCount(issues, ValidationIssue.ERROR),
                        "warning", issueCount(issues, ValidationIssue.WARNING), "info", issueCount(issues, ValidationIssue.INFO)),
                "coverageSummary", Map.of("total", coverage.size(), "satisfied", coverage.stream().filter(RequirementCoverage::satisfied).count(),
                        "verified", coverage.stream().filter(RequirementCoverage::verified).count(),
                        "fullyCovered", coverage.stream().filter(item -> item.satisfied() && item.verified()).count(),
                        "tested", results.values().stream().filter(value -> !value.equals("missing")).count(),
                        "passed", results.values().stream().filter(value -> value.equals("pass")).count()));
    }

    private static long issueCount(List<ValidationIssue> issues, String severity) {
        return issues.stream().filter(issue -> severity.equals(issue.severity())).count();
    }

    static Trace trace(ModelSnapshot model, String from, String direction, int depth, Set<String> types) {
        if (depth < 1 || depth > 8 || !Set.of("up", "down", "both").contains(direction)) {
            throw new ValidationException("选择 1 至 8 层及有效的追溯方向");
        }
        Target root = target(model, "element", from);
        Map<String, ModelElement> elements = new HashMap<>();
        model.elements().forEach(element -> elements.put(element.id(), element));
        Map<String, TraceEdge> edges = new LinkedHashMap<>();
        for (Relationship relationship : model.relationships()) {
            addEdge(edges, relationship.sourceId(), relationship.targetId(), relationship.type(), false);
        }
        new ValidationEngine().requirementCoverage(model).forEach(item -> {
            item.satisfiedBy().forEach(ref -> addEdge(edges, ref.id(), item.id(), "satisfy", true));
            item.verifiedBy().forEach(ref -> addEdge(edges, ref.id(), item.id(), "verify", true));
        });
        Map<String, List<TraceEdge>> adjacency = new HashMap<>();
        edges.values().stream().filter(edge -> types.isEmpty() || types.contains(edge.type())).forEach(edge -> {
            if (!direction.equals("down")) adjacency.computeIfAbsent(edge.sourceId(), unused -> new ArrayList<>()).add(edge);
            if (!direction.equals("up")) adjacency.computeIfAbsent(edge.targetId(), unused -> new ArrayList<>()).add(edge);
        });
        Set<String> visited = new LinkedHashSet<>();
        visited.add(from);
        ArrayDeque<TraceNode> queue = new ArrayDeque<>();
        queue.add(new TraceNode(root, 0, List.of()));
        List<TraceNode> found = new ArrayList<>();
        while (!queue.isEmpty()) {
            TraceNode cursor = queue.removeFirst();
            if (cursor.depth() == depth) continue;
            for (TraceEdge edge : adjacency.getOrDefault(cursor.target().id(), List.of())) {
                String other = cursor.target().id().equals(edge.sourceId()) ? edge.targetId() : edge.sourceId();
                ModelElement element = elements.get(other);
                if (element == null || !visited.add(other)) continue;
                if (found.size() == 500) return new Trace(found, true);
                var path = new ArrayList<>(cursor.path());
                path.add(edge);
                var node = new TraceNode(new Target("element", other, element.name()), cursor.depth() + 1, path);
                found.add(node);
                queue.add(node);
            }
        }
        return new Trace(found, false);
    }

    private static void addEdge(Map<String, TraceEdge> edges, String source, String target, String type, boolean inferred) {
        edges.putIfAbsent(source + "\u0000" + target + "\u0000" + type, new TraceEdge(source, target, type, inferred));
    }

    static List<Difference> diff(ModelSnapshot before, ModelSnapshot after) {
        List<Difference> result = new ArrayList<>();
        compare(result, "element", before.elements(), after.elements(), ModelElement::id, ModelElement::name,
                element -> fields(element.properties(), "type", element.type(), "name", element.name(),
                        "ownerId", element.ownerId(), "documentation", element.documentation(),
                        "stereotypes", element.stereotypes(), "taggedValues", element.taggedValues(), "xmiId", element.xmiId()));
        compare(result, "relationship", before.relationships(), after.relationships(), Relationship::id, Relationship::type,
                relation -> fields(relation.properties(), "type", relation.type(), "sourceId", relation.sourceId(),
                        "targetId", relation.targetId(), "name", relation.name(), "documentation", relation.documentation(),
                        "ownerId", relation.ownerId(), "stereotypes", relation.stereotypes(), "taggedValues", relation.taggedValues()));
        compare(result, "diagram", before.diagrams(), after.diagrams(), Diagram::id, Diagram::name,
                diagram -> fields(Map.of(), "kind", diagram.kind().code(), "name", diagram.name(),
                        "ownerId", diagram.ownerId(), "elementIds", diagram.elementIds(), "relationshipIds",
                        diagram.relationshipIds(), "style", diagram.style(), "customTypeId", diagram.customTypeId()));
        return result;
    }

    private static Map<String, Object> fields(Map<String, Object> properties, Object... fields) {
        Map<String, Object> result = new LinkedHashMap<>();
        properties.forEach((key, value) -> result.put("properties." + key, value));
        for (int index = 0; index < fields.length; index += 2) result.put((String) fields[index], fields[index + 1]);
        return result;
    }

    private static <T> void compare(List<Difference> result, String kind, List<T> before, List<T> after,
            Function<T, String> id, Function<T, String> label, Function<T, Map<String, Object>> fields) {
        Map<String, T> old = new LinkedHashMap<>();
        before.forEach(item -> old.put(id.apply(item), item));
        for (T item : after) {
            String key = id.apply(item);
            T original = old.remove(key);
            if (original == null) {
                result.add(new Difference(kind, key, label.apply(item), "add", "", null, fields.apply(item)));
            } else if (!original.equals(item)) {
                Map<String, Object> previous = fields.apply(original);
                Map<String, Object> current = fields.apply(item);
                Set<String> keys = new TreeSet<>(previous.keySet());
                keys.addAll(current.keySet());
                keys.stream().filter(field -> !Objects.equals(previous.get(field), current.get(field)))
                        .forEach(field -> result.add(new Difference(kind, key, label.apply(item), "update", field,
                                previous.get(field), current.get(field))));
            }
        }
        old.forEach((key, item) -> result.add(new Difference(kind, key, label.apply(item), "remove", "", fields.apply(item), null)));
    }
}
