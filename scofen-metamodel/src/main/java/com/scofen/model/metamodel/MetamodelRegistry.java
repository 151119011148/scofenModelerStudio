package com.scofen.model.metamodel;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * 表驱动的九图注册表：渲染器与校验器禁止按图类型硬编码。
 * M0 先固化图类型 / 元素集合 / 布局器 / 校验分组，元素类型后续扩充到约 110 种。
 */
public final class MetamodelRegistry {

    public static final String LAYOUT_ELK = "ELK layered (Java)";
    public static final String LAYOUT_SEQUENCE = "Java SequenceLayout";

    public record DiagramSpec(
            DiagramKind kind,
            Set<ElementType> elements,
            Set<String> relationships,
            String layout,
            String validationGroup) {
    }

    private static final Map<DiagramKind, DiagramSpec> SPECS = new EnumMap<>(DiagramKind.class);

    private static void register(DiagramKind kind, Set<ElementType> elements, Set<String> relationships,
                                 String layout, String validationGroup) {
        SPECS.put(kind, new DiagramSpec(kind, elements, relationships, layout, validationGroup));
    }

    private static Set<String> rel(String... values) {
        return Set.of(values);
    }

    static {
        register(DiagramKind.PKG,
                EnumSet.of(ElementType.PACKAGE, ElementType.MODEL, ElementType.MODEL_LIBRARY,
                        ElementType.PROFILE, ElementType.STEREOTYPE, ElementType.COMMENT),
                rel("containment", "import", "access", "generalization"),
                LAYOUT_ELK, "namespace");
        register(DiagramKind.REQ,
                EnumSet.of(ElementType.REQUIREMENT, ElementType.TEST_CASE, ElementType.BLOCK,
                        ElementType.COMMENT),
                rel("containment", "satisfy", "verify", "refine", "deriveReqt", "copy", "trace"),
                LAYOUT_ELK, "requirement");
        register(DiagramKind.BDD,
                EnumSet.of(ElementType.BLOCK, ElementType.VALUE_TYPE, ElementType.PACKAGE,
                        ElementType.CONSTRAINT_BLOCK, ElementType.COMMENT),
                rel("generalization", "association", "containment", "dependency"),
                LAYOUT_ELK, "structure");
        register(DiagramKind.IBD,
                EnumSet.of(ElementType.PART, ElementType.PORT, ElementType.FLOW_PORT,
                        ElementType.CONNECTOR, ElementType.COMMENT),
                rel("connector", "itemFlow", "binding", "delegation"),
                LAYOUT_ELK, "port");
        register(DiagramKind.PAR,
                EnumSet.of(ElementType.CONSTRAINT_BLOCK, ElementType.CONSTRAINT_PROPERTY,
                        ElementType.CONSTRAINT_PARAMETER, ElementType.VALUE_TYPE, ElementType.PART),
                rel("binding", "constraintParameter"),
                LAYOUT_ELK, "constraint");
        register(DiagramKind.ACT,
                EnumSet.of(ElementType.ACTIVITY, ElementType.ACTION, ElementType.CONTROL_NODE,
                        ElementType.OBJECT_NODE, ElementType.ACTIVITY_PARTITION),
                rel("controlFlow", "objectFlow", "partition"),
                LAYOUT_ELK, "activity");
        register(DiagramKind.SEQ,
                EnumSet.of(ElementType.INTERACTION, ElementType.LIFELINE, ElementType.MESSAGE,
                        ElementType.COMBINED_FRAGMENT),
                rel("message", "orderedFragment", "guard"),
                LAYOUT_SEQUENCE, "sequence");
        register(DiagramKind.STM,
                EnumSet.of(ElementType.STATE_MACHINE, ElementType.STATE, ElementType.TRANSITION,
                        ElementType.PSEUDOSTATE),
                rel("transition", "guard", "region"),
                LAYOUT_ELK, "state");
        register(DiagramKind.UC,
                EnumSet.of(ElementType.USE_CASE, ElementType.ACTOR, ElementType.PACKAGE),
                rel("association", "include", "extend", "generalization"),
                LAYOUT_ELK, "usecase");
    }

    private MetamodelRegistry() {
    }

    public static Set<DiagramKind> diagrams() {
        return Set.copyOf(SPECS.keySet());
    }

    public static DiagramSpec spec(DiagramKind kind) {
        DiagramSpec spec = SPECS.get(kind);
        if (spec == null) {
            throw new IllegalArgumentException("Unregistered diagram kind: " + kind);
        }
        return spec;
    }

    public static boolean allows(DiagramKind kind, ElementType type) {
        return spec(kind).elements().contains(type);
    }

    public static String layoutFor(DiagramKind kind) {
        return spec(kind).layout();
    }

    public static Set<String> validationGroups() {
        Set<String> groups = new java.util.LinkedHashSet<>();
        for (DiagramSpec spec : SPECS.values()) {
            groups.add(spec.validationGroup());
        }
        return Set.copyOf(groups);
    }

    public static int diagramCount() {
        return SPECS.size();
    }
}
