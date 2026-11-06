package com.scofen.model.metamodel;

import java.util.Collections;
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
            Set<RelationshipType> relationships,
            String layout,
            String validationGroup) {
    }

    private static final Map<DiagramKind, DiagramSpec> SPECS = new EnumMap<>(DiagramKind.class);

    /**
     * 元素类型的「主图归属」：一个元素类型在九图里最应该出现的那一张。
     *
     * <p>与 {@link #allows} 的区别：{@code allows} 说的是「允许出现」，
     * 一�� Block 既允许出现在需求图也允许出现在模块定义图；而主图归属说的是
     * 「它本来是哪张图的元素」。导入只吃语义、没有布局侧车时，服务端要按主图归属
     * 把元素重新排到九张图上——没有这张表就只能靠硬编码猜。</p>
     */
    private static final Map<ElementType, DiagramKind> PRIMARY_KIND = new EnumMap<>(ElementType.class);

    private static void register(DiagramKind kind, Set<ElementType> elements, Set<RelationshipType> relationships,
                                 String layout, String validationGroup) {
        SPECS.put(kind, new DiagramSpec(kind, elements, relationships, layout, validationGroup));
    }

    private static void primary(ElementType type, DiagramKind kind) {
        PRIMARY_KIND.put(type, kind);
    }

    private static Set<RelationshipType> rel(String... values) {
        EnumSet<RelationshipType> result = EnumSet.noneOf(RelationshipType.class);
        for (String value : values) {
            result.add(RelationshipType.fromAny(value)
                    .orElseThrow(() -> new IllegalArgumentException("Unregistered relationship type: " + value)));
        }
        return Collections.unmodifiableSet(result);
    }

    static {
        register(DiagramKind.PKG,
                EnumSet.of(ElementType.PACKAGE, ElementType.MODEL, ElementType.MODEL_LIBRARY,
                        ElementType.PROFILE, ElementType.STEREOTYPE, ElementType.METACLASS,
                        ElementType.COMMENT),
                rel("containment", "import", "access", "generalization"),
                LAYOUT_ELK, "namespace");
        register(DiagramKind.REQ,
                EnumSet.of(ElementType.REQUIREMENT, ElementType.TEST_CASE, ElementType.BLOCK,
                        ElementType.COMMENT),
                rel("containment", "satisfy", "verify", "refine", "deriveReqt", "copy", "trace", "allocate"),
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

        // 主图归属：导入只吃语义时的服务端重排依据。
        // 每种类型只归一张图——一个元素不会同时铺在九张图上。
        primary(ElementType.MODEL, DiagramKind.PKG);
        primary(ElementType.MODEL_LIBRARY, DiagramKind.PKG);
        primary(ElementType.PROFILE, DiagramKind.PKG);
        primary(ElementType.PACKAGE, DiagramKind.PKG);
        primary(ElementType.METACLASS, DiagramKind.PKG);
        primary(ElementType.STEREOTYPE, DiagramKind.PKG);
        primary(ElementType.COMMENT, DiagramKind.PKG);

        primary(ElementType.REQUIREMENT, DiagramKind.REQ);
        primary(ElementType.TEST_CASE, DiagramKind.REQ);

        primary(ElementType.BLOCK, DiagramKind.BDD);
        primary(ElementType.VALUE_TYPE, DiagramKind.BDD);

        primary(ElementType.PART, DiagramKind.IBD);
        primary(ElementType.PORT, DiagramKind.IBD);
        primary(ElementType.FLOW_PORT, DiagramKind.IBD);
        primary(ElementType.CONNECTOR, DiagramKind.IBD);

        primary(ElementType.CONSTRAINT_BLOCK, DiagramKind.PAR);
        primary(ElementType.CONSTRAINT_PROPERTY, DiagramKind.PAR);
        primary(ElementType.CONSTRAINT_PARAMETER, DiagramKind.PAR);

        primary(ElementType.ACTIVITY, DiagramKind.ACT);
        primary(ElementType.ACTION, DiagramKind.ACT);
        primary(ElementType.CONTROL_NODE, DiagramKind.ACT);
        primary(ElementType.OBJECT_NODE, DiagramKind.ACT);
        primary(ElementType.ACTIVITY_PARTITION, DiagramKind.ACT);

        primary(ElementType.INTERACTION, DiagramKind.SEQ);
        primary(ElementType.LIFELINE, DiagramKind.SEQ);
        primary(ElementType.MESSAGE, DiagramKind.SEQ);
        primary(ElementType.COMBINED_FRAGMENT, DiagramKind.SEQ);

        primary(ElementType.STATE_MACHINE, DiagramKind.STM);
        primary(ElementType.STATE, DiagramKind.STM);
        primary(ElementType.TRANSITION, DiagramKind.STM);
        primary(ElementType.PSEUDOSTATE, DiagramKind.STM);

        primary(ElementType.USE_CASE, DiagramKind.UC);
        primary(ElementType.ACTOR, DiagramKind.UC);
    }

    private MetamodelRegistry() {
    }

    public static Set<DiagramKind> diagrams() {
        return Set.copyOf(SPECS.keySet());
    }

    /** 元素类型的主图归属；未登记的类型返回空。 */
    public static java.util.Optional<DiagramKind> primaryKind(ElementType type) {
        return java.util.Optional.ofNullable(PRIMARY_KIND.get(type));
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

    /** 图与关系的规范约束：组件工具箱的「关系」分组与服务端命令校验共用这一张表。 */
    public static boolean allowsRelationship(DiagramKind kind, RelationshipType type) {
        return spec(kind).relationships().contains(type);
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
