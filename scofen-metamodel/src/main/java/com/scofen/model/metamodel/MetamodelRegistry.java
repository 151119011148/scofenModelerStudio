package com.scofen.model.metamodel;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * 表驱动的九图注册表：渲染器与校验器禁止按图类型硬编码。
 *
 * <p>两张表各管一件事：{@link #SPECS} 说「这张图允许出现什么」（校验与工具箱），
 * {@link #PRIMARY_KIND} 说「这个类型本来属于哪张图」（导入无布局信息时的重排依据）。
 * 新增元素类型必须同时进这两张表，{@code MetamodelRegistryTest} 会兜底检查遗漏。</p>
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
     * 一个 Block 既允许出现在需求图也允许出现在模块定义图；而主图归属说的是
     * 「它本来是哪张图的元素」。导入只吃语义、没有布局侧车时，服务端要按主图归属
     * 把元素重新排到九张图上——没有这张表就只能靠硬编码猜。</p>
     */
    private static final Map<ElementType, DiagramKind> PRIMARY_KIND = new EnumMap<>(ElementType.class);

    private static void register(DiagramKind kind, Set<ElementType> elements, Set<RelationshipType> relationships,
                                 String layout, String validationGroup) {
        SPECS.put(kind, new DiagramSpec(kind, elements, relationships, layout, validationGroup));
    }

    private static void primary(DiagramKind kind, ElementType... types) {
        for (ElementType type : types) {
            PRIMARY_KIND.put(type, kind);
        }
    }

    private static Set<ElementType> types(ElementType... values) {
        EnumSet<ElementType> result = EnumSet.noneOf(ElementType.class);
        Collections.addAll(result, values);
        return result;
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
        // ── 包图：命名空间与可打包分类器，剖面应用 / 包合并也在这张图上画 ──
        register(DiagramKind.PKG,
                types(ElementType.PACKAGE, ElementType.MODEL, ElementType.MODEL_LIBRARY,
                        ElementType.PROFILE, ElementType.STEREOTYPE, ElementType.METACLASS,
                        ElementType.CLASS, ElementType.INTERFACE, ElementType.SIGNAL,
                        ElementType.DATA_TYPE, ElementType.PRIMITIVE_TYPE, ElementType.ENUMERATION,
                        ElementType.ASSOCIATION_CLASS, ElementType.COMPONENT, ElementType.COLLABORATION,
                        ElementType.INFORMATION_ITEM, ElementType.INSTANCE_SPECIFICATION,
                        ElementType.NODE, ElementType.DEVICE, ElementType.EXECUTION_ENVIRONMENT,
                        ElementType.ARTIFACT, ElementType.DEPLOYMENT_SPECIFICATION,
                        ElementType.VIEW, ElementType.VIEWPOINT,
                        // §8 观察 / 区间约束与 §13 事件都是可打包元素，包图里也能摆。
                        ElementType.DURATION_OBSERVATION, ElementType.TIME_OBSERVATION,
                        ElementType.INTERVAL_CONSTRAINT, ElementType.DURATION_CONSTRAINT,
                        ElementType.TIME_CONSTRAINT, ElementType.SIGNAL_EVENT,
                        ElementType.CALL_EVENT, ElementType.TIME_EVENT, ElementType.CHANGE_EVENT,
                        ElementType.ANY_RECEIVE_EVENT, ElementType.COMMENT),
                rel("containment", "import", "access", "generalization", "dependency",
                        "packageMerge", "profileApplication", "usage", "abstraction"),
                LAYOUT_ELK, "namespace");

        // ── 需求图：需求 / 测试用例 / 约束块 / 满足与被满足的元素 ──
        register(DiagramKind.REQ,
                types(ElementType.REQUIREMENT, ElementType.TEST_CASE, ElementType.BLOCK,
                        ElementType.CLASS, ElementType.CONSTRAINT_BLOCK,
                        ElementType.VIEW, ElementType.VIEWPOINT, ElementType.COMMENT),
                rel("containment", "satisfy", "verify", "refine", "deriveReqt", "copy", "trace",
                        "allocate"),
                LAYOUT_ELK, "requirement");

        // ── 模块定义图：分类器与类型的主战场，枚举 / 数据类型 / 接口都在这里建 ──
        register(DiagramKind.BDD,
                types(ElementType.BLOCK, ElementType.CLASS, ElementType.INTERFACE, ElementType.SIGNAL,
                        ElementType.VALUE_TYPE, ElementType.DATA_TYPE, ElementType.PRIMITIVE_TYPE,
                        ElementType.ENUMERATION, ElementType.ASSOCIATION_CLASS, ElementType.COMPONENT,
                        ElementType.CONSTRAINT_BLOCK, ElementType.FLOW_SPECIFICATION,
                        ElementType.COLLABORATION, ElementType.COLLABORATION_USE,
                        ElementType.INFORMATION_ITEM,
                        ElementType.INSTANCE_SPECIFICATION, ElementType.NODE, ElementType.DEVICE,
                        ElementType.EXECUTION_ENVIRONMENT, ElementType.ARTIFACT,
                        // §7 模板与 §8 值规格：泛型签名、参数、绑定、槽都在分类器上表达。
                        ElementType.TEMPLATE_SIGNATURE, ElementType.REDEFINABLE_TEMPLATE_SIGNATURE,
                        ElementType.TEMPLATE_PARAMETER, ElementType.CLASSIFIER_TEMPLATE_PARAMETER,
                        ElementType.TEMPLATE_BINDING, ElementType.TEMPLATE_PARAMETER_SUBSTITUTION,
                        ElementType.PROPERTY, ElementType.SLOT,
                        ElementType.OPAQUE_EXPRESSION, ElementType.INSTANCE_VALUE,
                        ElementType.PACKAGE, ElementType.COMMENT),
                rel("generalization", "association", "containment", "dependency",
                        "interfaceRealization", "realization", "abstraction", "substitution",
                        "usage", "manifestation", "informationFlow"),
                LAYOUT_ELK, "structure");

        // ── 内部块图：部件 / 端口 / 连接器 / 值属性 / 流属性 ──
        register(DiagramKind.IBD,
                types(ElementType.PART, ElementType.PORT, ElementType.FLOW_PORT,
                        ElementType.CONNECTOR, ElementType.VALUE_PROPERTY, ElementType.REFERENCE_PROPERTY,
                        ElementType.FLOW_PROPERTY, ElementType.CONSTRAINT_PROPERTY,
                        ElementType.INFORMATION_ITEM, ElementType.COMMENT),
                rel("connector", "itemFlow", "binding", "delegation", "informationFlow"),
                LAYOUT_ELK, "port");

        // ── 参数图：约束块与约束参数 ──
        register(DiagramKind.PAR,
                types(ElementType.CONSTRAINT_BLOCK, ElementType.CONSTRAINT_PROPERTY,
                        ElementType.CONSTRAINT_PARAMETER, ElementType.VALUE_TYPE, ElementType.PART,
                        ElementType.VALUE_PROPERTY,
                        // §8 观察 / 区间 / 区间约束：性能指标与时序约束的落点。
                        ElementType.OPAQUE_EXPRESSION, ElementType.INSTANCE_VALUE,
                        ElementType.DURATION_OBSERVATION, ElementType.TIME_OBSERVATION,
                        ElementType.DURATION_INTERVAL, ElementType.TIME_INTERVAL,
                        ElementType.INTERVAL_CONSTRAINT, ElementType.DURATION_CONSTRAINT,
                        ElementType.TIME_CONSTRAINT, ElementType.COMMENT),
                rel("binding", "constraintParameter"),
                LAYOUT_ELK, "constraint");

        // ── 活动图：控制节点、对象节点与 §16 全部具体动作 ──
        register(DiagramKind.ACT,
                types(ElementType.ACTIVITY, ElementType.ACTION,
                        ElementType.CONTROL_NODE, ElementType.INITIAL_NODE, ElementType.ACTIVITY_FINAL_NODE,
                        ElementType.FLOW_FINAL_NODE, ElementType.DECISION_NODE, ElementType.MERGE_NODE,
                        ElementType.FORK_NODE, ElementType.JOIN_NODE,
                        ElementType.OBJECT_NODE, ElementType.DATA_STORE_NODE,
                        ElementType.CENTRAL_BUFFER_NODE, ElementType.ACTIVITY_PARAMETER_NODE,
                        ElementType.ACTIVITY_PARTITION, ElementType.STRUCTURED_ACTIVITY_NODE,
                        ElementType.EXPANSION_REGION, ElementType.INTERRUPTIBLE_ACTIVITY_REGION,
                        ElementType.VALUE_PIN, ElementType.ACTION_INPUT_PIN, ElementType.OUTPUT_PIN,
                        // §16 的不透明动作是最常用的兜底动作；变量与异常处理器属于活动内容。
                        ElementType.OPAQUE_ACTION, ElementType.VARIABLE,
                        ElementType.EXCEPTION_HANDLER, ElementType.TRIGGER,
                        ElementType.OPAQUE_EXPRESSION, ElementType.INSTANCE_VALUE,
                        ElementType.CALL_BEHAVIOR_ACTION, ElementType.CALL_OPERATION_ACTION,
                        ElementType.SEND_SIGNAL_ACTION, ElementType.BROADCAST_SIGNAL_ACTION,
                        ElementType.SEND_OBJECT_ACTION, ElementType.ACCEPT_EVENT_ACTION,
                        ElementType.ACCEPT_CALL_ACTION, ElementType.REPLY_ACTION,
                        ElementType.CREATE_OBJECT_ACTION, ElementType.DESTROY_OBJECT_ACTION,
                        ElementType.READ_SELF_ACTION, ElementType.READ_STRUCTURAL_FEATURE_ACTION,
                        ElementType.WRITE_STRUCTURAL_FEATURE_ACTION,
                        ElementType.ADD_STRUCTURAL_FEATURE_VALUE_ACTION,
                        ElementType.REMOVE_STRUCTURAL_FEATURE_VALUE_ACTION,
                        ElementType.CLEAR_STRUCTURAL_FEATURE_ACTION,
                        ElementType.READ_VARIABLE_ACTION, ElementType.WRITE_VARIABLE_ACTION,
                        ElementType.ADD_VARIABLE_VALUE_ACTION, ElementType.REMOVE_VARIABLE_VALUE_ACTION,
                        ElementType.CLEAR_VARIABLE_ACTION, ElementType.CREATE_LINK_ACTION,
                        ElementType.DESTROY_LINK_ACTION, ElementType.READ_LINK_ACTION,
                        ElementType.CLEAR_ASSOCIATION_ACTION, ElementType.READ_EXTENT_ACTION,
                        ElementType.READ_IS_CLASSIFIED_OBJECT_ACTION,
                        ElementType.RECLASSIFY_OBJECT_ACTION, ElementType.REDUCE_ACTION,
                        ElementType.RAISE_EXCEPTION_ACTION, ElementType.UNMARSHALL_ACTION,
                        ElementType.TEST_IDENTITY_ACTION, ElementType.VALUE_SPECIFICATION_ACTION,
                        ElementType.START_CLASSIFIER_BEHAVIOR_ACTION,
                        ElementType.START_OBJECT_BEHAVIOR_ACTION,
                        ElementType.COMMENT),
                rel("controlFlow", "objectFlow", "partition"),
                LAYOUT_ELK, "activity");

        // ── 序列图：生命线、消息与交互片段 ──
        register(DiagramKind.SEQ,
                types(ElementType.INTERACTION, ElementType.LIFELINE, ElementType.MESSAGE,
                        ElementType.COMBINED_FRAGMENT, ElementType.INTERACTION_USE,
                        ElementType.STATE_INVARIANT, ElementType.CONTINUATION, ElementType.GATE,
                        ElementType.CONSIDER_IGNORE_FRAGMENT,
                        ElementType.DESTRUCTION_OCCURRENCE_SPECIFICATION,
                        ElementType.ACTION_EXECUTION_SPECIFICATION,
                        ElementType.BEHAVIOR_EXECUTION_SPECIFICATION,
                        // §17 交互细节：发生规格、操作数、部件分解、交互约束、通用顺序。
                        ElementType.MESSAGE_OCCURRENCE_SPECIFICATION,
                        ElementType.EXECUTION_OCCURRENCE_SPECIFICATION,
                        ElementType.INTERACTION_OPERAND, ElementType.PART_DECOMPOSITION,
                        ElementType.INTERACTION_CONSTRAINT, ElementType.GENERAL_ORDERING,
                        ElementType.COMMENT),
                rel("message", "orderedFragment", "guard"),
                LAYOUT_SEQUENCE, "sequence");

        // ── 状态机图 ──
        register(DiagramKind.STM,
                types(ElementType.STATE_MACHINE, ElementType.PROTOCOL_STATE_MACHINE,
                        ElementType.STATE, ElementType.FINAL_STATE, ElementType.PSEUDOSTATE,
                        ElementType.CONNECTION_POINT_REFERENCE, ElementType.TRANSITION,
                        // 区域与触发事件：状态机里的层次与事件驱动表达。
                        ElementType.REGION, ElementType.TRIGGER,
                        ElementType.SIGNAL_EVENT, ElementType.CALL_EVENT, ElementType.TIME_EVENT,
                        ElementType.CHANGE_EVENT, ElementType.ANY_RECEIVE_EVENT,
                        ElementType.COMMENT),
                rel("transition", "guard", "region"),
                LAYOUT_ELK, "state");

        // ── 用例图 ──
        register(DiagramKind.UC,
                types(ElementType.USE_CASE, ElementType.ACTOR, ElementType.PACKAGE,
                        ElementType.CLASS, ElementType.COMMENT),
                rel("association", "include", "extend", "generalization"),
                LAYOUT_ELK, "usecase");

        // 主图归属：导入只吃语义时的服务端重排依据。
        // 每种类型只归一张图——一个元素不会同时铺在九张图上。
        primary(DiagramKind.PKG,
                ElementType.MODEL, ElementType.MODEL_LIBRARY, ElementType.PROFILE,
                ElementType.PACKAGE, ElementType.METACLASS, ElementType.STEREOTYPE,
                ElementType.COMMENT, ElementType.VIEW, ElementType.VIEWPOINT,
                ElementType.INSTANCE_SPECIFICATION, ElementType.NODE, ElementType.DEVICE,
                ElementType.EXECUTION_ENVIRONMENT, ElementType.ARTIFACT,
                ElementType.DEPLOYMENT_SPECIFICATION);

        primary(DiagramKind.REQ,
                ElementType.REQUIREMENT, ElementType.TEST_CASE,
                ElementType.RATIONALE, ElementType.PROBLEM);

        primary(DiagramKind.BDD,
                ElementType.BLOCK, ElementType.CLASS, ElementType.INTERFACE, ElementType.SIGNAL,
                ElementType.DATA_TYPE, ElementType.PRIMITIVE_TYPE, ElementType.ENUMERATION,
                ElementType.ENUMERATION_LITERAL, ElementType.ASSOCIATION_CLASS,
                ElementType.COMPONENT, ElementType.COLLABORATION, ElementType.COLLABORATION_USE,
                ElementType.INFORMATION_ITEM,
                ElementType.OPERATION, ElementType.PARAMETER, ElementType.RECEPTION,
                ElementType.VALUE_TYPE, ElementType.CONSTRAINT_BLOCK, ElementType.FLOW_SPECIFICATION,
                ElementType.PROPERTY, ElementType.SLOT,
                ElementType.TEMPLATE_SIGNATURE, ElementType.REDEFINABLE_TEMPLATE_SIGNATURE,
                ElementType.TEMPLATE_PARAMETER, ElementType.CLASSIFIER_TEMPLATE_PARAMETER,
                ElementType.TEMPLATE_BINDING, ElementType.TEMPLATE_PARAMETER_SUBSTITUTION);

        primary(DiagramKind.IBD,
                ElementType.PART, ElementType.PORT, ElementType.FLOW_PORT, ElementType.CONNECTOR,
                ElementType.VALUE_PROPERTY, ElementType.REFERENCE_PROPERTY, ElementType.FLOW_PROPERTY);

        primary(DiagramKind.PAR,
                ElementType.CONSTRAINT_PROPERTY, ElementType.CONSTRAINT_PARAMETER,
                ElementType.OPAQUE_EXPRESSION, ElementType.INSTANCE_VALUE,
                ElementType.DURATION_OBSERVATION, ElementType.TIME_OBSERVATION,
                ElementType.DURATION_INTERVAL, ElementType.TIME_INTERVAL,
                ElementType.INTERVAL_CONSTRAINT, ElementType.DURATION_CONSTRAINT,
                ElementType.TIME_CONSTRAINT);

        primary(DiagramKind.ACT,
                ElementType.ACTIVITY, ElementType.ACTION, ElementType.OPAQUE_ACTION,
                ElementType.CONTROL_NODE,
                ElementType.INITIAL_NODE, ElementType.ACTIVITY_FINAL_NODE, ElementType.FLOW_FINAL_NODE,
                ElementType.DECISION_NODE, ElementType.MERGE_NODE, ElementType.FORK_NODE,
                ElementType.JOIN_NODE, ElementType.OBJECT_NODE, ElementType.DATA_STORE_NODE,
                ElementType.CENTRAL_BUFFER_NODE, ElementType.ACTIVITY_PARAMETER_NODE,
                ElementType.ACTIVITY_PARTITION, ElementType.STRUCTURED_ACTIVITY_NODE,
                ElementType.EXPANSION_REGION, ElementType.INTERRUPTIBLE_ACTIVITY_REGION,
                ElementType.VALUE_PIN, ElementType.ACTION_INPUT_PIN, ElementType.OUTPUT_PIN,
                ElementType.VARIABLE, ElementType.EXCEPTION_HANDLER,
                ElementType.CALL_BEHAVIOR_ACTION, ElementType.CALL_OPERATION_ACTION,
                ElementType.SEND_SIGNAL_ACTION, ElementType.BROADCAST_SIGNAL_ACTION,
                ElementType.SEND_OBJECT_ACTION, ElementType.ACCEPT_EVENT_ACTION,
                ElementType.ACCEPT_CALL_ACTION, ElementType.REPLY_ACTION,
                ElementType.CREATE_OBJECT_ACTION, ElementType.DESTROY_OBJECT_ACTION,
                ElementType.READ_SELF_ACTION, ElementType.READ_STRUCTURAL_FEATURE_ACTION,
                ElementType.WRITE_STRUCTURAL_FEATURE_ACTION,
                ElementType.ADD_STRUCTURAL_FEATURE_VALUE_ACTION,
                ElementType.REMOVE_STRUCTURAL_FEATURE_VALUE_ACTION,
                ElementType.CLEAR_STRUCTURAL_FEATURE_ACTION,
                ElementType.READ_VARIABLE_ACTION, ElementType.WRITE_VARIABLE_ACTION,
                ElementType.ADD_VARIABLE_VALUE_ACTION, ElementType.REMOVE_VARIABLE_VALUE_ACTION,
                ElementType.CLEAR_VARIABLE_ACTION, ElementType.CREATE_LINK_ACTION,
                ElementType.DESTROY_LINK_ACTION, ElementType.READ_LINK_ACTION,
                ElementType.CLEAR_ASSOCIATION_ACTION, ElementType.READ_EXTENT_ACTION,
                ElementType.READ_IS_CLASSIFIED_OBJECT_ACTION, ElementType.RECLASSIFY_OBJECT_ACTION,
                ElementType.REDUCE_ACTION, ElementType.RAISE_EXCEPTION_ACTION,
                ElementType.UNMARSHALL_ACTION, ElementType.TEST_IDENTITY_ACTION,
                ElementType.VALUE_SPECIFICATION_ACTION,
                ElementType.START_CLASSIFIER_BEHAVIOR_ACTION, ElementType.START_OBJECT_BEHAVIOR_ACTION);

        primary(DiagramKind.SEQ,
                ElementType.INTERACTION, ElementType.LIFELINE, ElementType.MESSAGE,
                ElementType.COMBINED_FRAGMENT, ElementType.INTERACTION_USE,
                ElementType.STATE_INVARIANT, ElementType.CONTINUATION, ElementType.GATE,
                ElementType.CONSIDER_IGNORE_FRAGMENT,
                ElementType.DESTRUCTION_OCCURRENCE_SPECIFICATION,
                ElementType.ACTION_EXECUTION_SPECIFICATION,
                ElementType.BEHAVIOR_EXECUTION_SPECIFICATION,
                ElementType.MESSAGE_OCCURRENCE_SPECIFICATION,
                ElementType.EXECUTION_OCCURRENCE_SPECIFICATION,
                ElementType.INTERACTION_OPERAND, ElementType.PART_DECOMPOSITION,
                ElementType.INTERACTION_CONSTRAINT, ElementType.GENERAL_ORDERING);

        primary(DiagramKind.STM,
                ElementType.STATE_MACHINE, ElementType.PROTOCOL_STATE_MACHINE, ElementType.STATE,
                ElementType.FINAL_STATE, ElementType.PSEUDOSTATE,
                ElementType.CONNECTION_POINT_REFERENCE, ElementType.TRANSITION,
                ElementType.REGION, ElementType.TRIGGER,
                ElementType.SIGNAL_EVENT, ElementType.CALL_EVENT, ElementType.TIME_EVENT,
                ElementType.CHANGE_EVENT, ElementType.ANY_RECEIVE_EVENT);

        primary(DiagramKind.UC, ElementType.USE_CASE, ElementType.ACTOR);
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
