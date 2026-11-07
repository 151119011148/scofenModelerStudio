package com.scofen.model.metamodel;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static com.scofen.model.metamodel.ElementType.*;

/**
 * UML 2.5.1 / SysML 1.6 的所有权（ownership / containment）规则表。
 *
 * <p>模型树不是任意文件夹：元素能否挂在某个父元素下由元模型决定，
 * 例如 Port 只能属于 Block / PartProperty，Lifeline 只能属于 Interaction。
 * 规则由服务端下发给前端右键菜单，前端不得自行硬编码或放宽。</p>
 *
 * <p>本表覆盖 {@link ElementType} 全量类型：新增类型必须在这里登记父子规则，
 * 否则它只能挂在模型根上（{@link #ROOT_TYPES}）而无法成为任何元素的子节点。</p>
 */
public final class ContainmentRules {

    /** 可直接挂在模型根（ownerId 为空）的类型：UML 的 PackageableElement 顶层容器。 */
    public static final Set<ElementType> ROOT_TYPES =
            Collections.unmodifiableSet(set(MODEL, MODEL_LIBRARY, PACKAGE, PROFILE));

    private static final Map<ElementType, Set<ElementType>> CHILDREN = new EnumMap<>(ElementType.class);

    static {
        // 命名空间容器：包 / 模型 / 模型库可以容纳全部可打包元素。
        Set<ElementType> namespace = set(
                MODEL, MODEL_LIBRARY, PACKAGE, PROFILE, STEREOTYPE, METACLASS,
                CLASS, INTERFACE, SIGNAL, DATA_TYPE, PRIMITIVE_TYPE, ENUMERATION,
                ASSOCIATION_CLASS, COMPONENT, COLLABORATION, INFORMATION_ITEM, INSTANCE_SPECIFICATION,
                NODE, DEVICE, EXECUTION_ENVIRONMENT, ARTIFACT, DEPLOYMENT_SPECIFICATION,
                BLOCK, VALUE_TYPE, CONSTRAINT_BLOCK, REQUIREMENT, TEST_CASE, FLOW_SPECIFICATION,
                VIEW, VIEWPOINT, RATIONALE, PROBLEM,
                ACTIVITY, STATE_MACHINE, PROTOCOL_STATE_MACHINE, INTERACTION, USE_CASE, ACTOR,
                // §8 观察与区间约束、§13 事件：规范上都是 PackageableElement，可独立放进包里。
                DURATION_OBSERVATION, TIME_OBSERVATION,
                INTERVAL_CONSTRAINT, DURATION_CONSTRAINT, TIME_CONSTRAINT,
                SIGNAL_EVENT, CALL_EVENT, TIME_EVENT, CHANGE_EVENT, ANY_RECEIVE_EVENT,
                COMMENT);
        allow(MODEL, namespace);
        allow(MODEL_LIBRARY, namespace);
        allow(PACKAGE, namespace);
        // 剖面（扩展包）容纳元类与构造型：通用扩展包即由此结构落地。
        allow(PROFILE, METACLASS, STEREOTYPE, PACKAGE, COMMENT);

        // ── 分类器成员：操作 / 接收 / 属性 / 端口 / 连接器 / 嵌套分类器 ──
        Set<ElementType> classifierMembers = set(
                VALUE_PROPERTY, REFERENCE_PROPERTY, FLOW_PROPERTY, OPERATION, RECEPTION,
                PROPERTY, TEMPLATE_SIGNATURE, REDEFINABLE_TEMPLATE_SIGNATURE,
                PART, PORT, FLOW_PORT, CONNECTOR, INSTANCE_SPECIFICATION, COMMENT);
        allow(CLASS, union(classifierMembers, set(CLASS, INTERFACE, DATA_TYPE, ENUMERATION)));
        allow(INTERFACE, union(classifierMembers, set(INTERFACE, SIGNAL, ENUMERATION)));
        allow(ASSOCIATION_CLASS, union(classifierMembers, set(ASSOCIATION_CLASS, CLASS, INTERFACE)));
        allow(COMPONENT, union(classifierMembers, set(COMPONENT, CLASS, INTERFACE, ARTIFACT, NODE)));
        allow(COLLABORATION, PART, CONNECTOR, COLLABORATION_USE, COMMENT);
        // 信号只有属性，没有操作与端口。
        allow(SIGNAL, VALUE_PROPERTY, REFERENCE_PROPERTY, PROPERTY, COMMENT);
        // 数据类型：属性 + 操作（值类型同构，另加单位/量纲引用）。
        allow(DATA_TYPE, VALUE_PROPERTY, REFERENCE_PROPERTY, PROPERTY, OPERATION,
                TEMPLATE_SIGNATURE, COMMENT);
        allow(PRIMITIVE_TYPE, COMMENT);
        // 枚举只含字面量——这是「枚举建不出字面量」的根因，必须显式开放。
        allow(ENUMERATION, ENUMERATION_LITERAL, COMMENT);
        allow(ENUMERATION_LITERAL, COMMENT);
        // 操作 → 参数；参数是叶子。
        allow(OPERATION, PARAMETER, COMMENT);
        allow(PARAMETER, COMMENT);

        // ── §7 模板：签名挂参数，绑定挂参数替换 ──
        Set<ElementType> templateParams = set(TEMPLATE_PARAMETER, CLASSIFIER_TEMPLATE_PARAMETER);
        allow(TEMPLATE_SIGNATURE, union(templateParams, set(TEMPLATE_BINDING, COMMENT)));
        allow(REDEFINABLE_TEMPLATE_SIGNATURE, union(templateParams, set(TEMPLATE_BINDING, COMMENT)));
        allow(TEMPLATE_PARAMETER, COMMENT);
        allow(CLASSIFIER_TEMPLATE_PARAMETER, COMMENT);
        allow(TEMPLATE_BINDING, TEMPLATE_PARAMETER_SUBSTITUTION, COMMENT);
        allow(TEMPLATE_PARAMETER_SUBSTITUTION, COMMENT);

        // ── §8 值规格 / 观察 / 区间约束：约束含区间，区间含注释 ──
        allow(OPAQUE_EXPRESSION, COMMENT);
        allow(INSTANCE_VALUE, COMMENT);
        allow(DURATION_OBSERVATION, COMMENT);
        allow(TIME_OBSERVATION, COMMENT);
        allow(DURATION_INTERVAL, COMMENT);
        allow(TIME_INTERVAL, COMMENT);
        allow(INTERVAL_CONSTRAINT, DURATION_INTERVAL, TIME_INTERVAL, COMMENT);
        allow(DURATION_CONSTRAINT, DURATION_INTERVAL, COMMENT);
        allow(TIME_CONSTRAINT, TIME_INTERVAL, COMMENT);

        // ── §13 事件：触发器指向事件，接收事件动作可带触发器 ──
        allow(SIGNAL_EVENT, COMMENT);
        allow(CALL_EVENT, COMMENT);
        allow(TIME_EVENT, COMMENT);
        allow(CHANGE_EVENT, COMMENT);
        allow(ANY_RECEIVE_EVENT, COMMENT);
        allow(TRIGGER, COMMENT);

        // ── 部署 ──
        allow(NODE, PART, NODE, DEVICE, EXECUTION_ENVIRONMENT, DEPLOYMENT_SPECIFICATION, COMMENT);
        allow(DEVICE, PART, NODE, DEVICE, EXECUTION_ENVIRONMENT, DEPLOYMENT_SPECIFICATION, COMMENT);
        allow(EXECUTION_ENVIRONMENT, PART, NODE, DEVICE, EXECUTION_ENVIRONMENT,
                DEPLOYMENT_SPECIFICATION, COMMENT);
        allow(ARTIFACT, VALUE_PROPERTY, REFERENCE_PROPERTY, OPERATION, ARTIFACT, COMMENT);
        allow(DEPLOYMENT_SPECIFICATION, VALUE_PROPERTY, REFERENCE_PROPERTY, ARTIFACT, COMMENT);

        // ── SysML 结构 ──
        allow(BLOCK,
                BLOCK, CLASS, INTERFACE, ENUMERATION, DATA_TYPE,
                PART, PORT, FLOW_PORT, CONNECTOR, VALUE_TYPE, FLOW_SPECIFICATION,
                VALUE_PROPERTY, REFERENCE_PROPERTY, FLOW_PROPERTY, PROPERTY,
                OPERATION, RECEPTION, TEMPLATE_SIGNATURE,
                CONSTRAINT_BLOCK, CONSTRAINT_PROPERTY, CONSTRAINT_PARAMETER,
                ACTIVITY, STATE_MACHINE, INTERACTION, INSTANCE_SPECIFICATION, COMMENT);
        allow(VALUE_TYPE, VALUE_PROPERTY, REFERENCE_PROPERTY, PROPERTY, OPERATION,
                TEMPLATE_SIGNATURE, COMMENT);
        allow(FLOW_SPECIFICATION, FLOW_PROPERTY, VALUE_PROPERTY, REFERENCE_PROPERTY, COMMENT);
        allow(CONSTRAINT_BLOCK, CONSTRAINT_PARAMETER, CONSTRAINT_PROPERTY, VALUE_TYPE, COMMENT);
        allow(CONSTRAINT_PROPERTY, CONSTRAINT_PARAMETER, COMMENT);
        allow(CONSTRAINT_PARAMETER, COMMENT);
        allow(PART, PART, PORT, FLOW_PORT, COMMENT);
        allow(CONNECTOR, COMMENT);
        allow(PORT, COMMENT);
        allow(FLOW_PORT, COMMENT);
        allow(VALUE_PROPERTY, COMMENT);
        allow(REFERENCE_PROPERTY, COMMENT);
        allow(FLOW_PROPERTY, COMMENT);
        allow(INFORMATION_ITEM, VALUE_PROPERTY, REFERENCE_PROPERTY, COMMENT);
        // 槽只属于实例规格：它给出某个结构特征在该实例上的取值。
        allow(INSTANCE_SPECIFICATION, SLOT, COMMENT);
        allow(SLOT, COMMENT);

        // ── 扩展机制 ──
        allow(STEREOTYPE, COMMENT);
        // 元类可容纳其特化的构造型：UML 里 Stereotype 是 Metaclass 的子类。
        allow(METACLASS, STEREOTYPE, COMMENT);

        // ── SysML 需求 / 视图 ──
        allow(REQUIREMENT, REQUIREMENT, TEST_CASE, COMMENT);
        allow(TEST_CASE, COMMENT);
        allow(VIEW, VIEW, COMMENT);
        allow(VIEWPOINT, COMMENT);
        allow(RATIONALE, COMMENT);
        allow(PROBLEM, COMMENT);

        // ── 活动：容器 / 控制节点 / 对象节点 / 具体动作 ──
        Set<ElementType> controlNodes = set(CONTROL_NODE, INITIAL_NODE, ACTIVITY_FINAL_NODE,
                FLOW_FINAL_NODE, DECISION_NODE, MERGE_NODE, FORK_NODE, JOIN_NODE);
        Set<ElementType> objectNodes = set(OBJECT_NODE, DATA_STORE_NODE, CENTRAL_BUFFER_NODE,
                ACTIVITY_PARAMETER_NODE);
        Set<ElementType> concreteActions = set(ACTION, OPAQUE_ACTION,
                CALL_BEHAVIOR_ACTION, CALL_OPERATION_ACTION, START_OBJECT_BEHAVIOR_ACTION,
                SEND_SIGNAL_ACTION, BROADCAST_SIGNAL_ACTION, SEND_OBJECT_ACTION,
                ACCEPT_EVENT_ACTION, ACCEPT_CALL_ACTION, REPLY_ACTION,
                CREATE_OBJECT_ACTION, DESTROY_OBJECT_ACTION, READ_SELF_ACTION,
                TEST_IDENTITY_ACTION, VALUE_SPECIFICATION_ACTION, START_CLASSIFIER_BEHAVIOR_ACTION,
                READ_STRUCTURAL_FEATURE_ACTION, WRITE_STRUCTURAL_FEATURE_ACTION,
                ADD_STRUCTURAL_FEATURE_VALUE_ACTION, REMOVE_STRUCTURAL_FEATURE_VALUE_ACTION,
                CLEAR_STRUCTURAL_FEATURE_ACTION,
                READ_VARIABLE_ACTION, WRITE_VARIABLE_ACTION, ADD_VARIABLE_VALUE_ACTION,
                REMOVE_VARIABLE_VALUE_ACTION, CLEAR_VARIABLE_ACTION,
                CREATE_LINK_ACTION, DESTROY_LINK_ACTION, READ_LINK_ACTION, CLEAR_ASSOCIATION_ACTION,
                READ_EXTENT_ACTION, READ_IS_CLASSIFIED_OBJECT_ACTION, RECLASSIFY_OBJECT_ACTION,
                REDUCE_ACTION, RAISE_EXCEPTION_ACTION, UNMARSHALL_ACTION);
        Set<ElementType> activityContent = union(concreteActions, controlNodes, objectNodes,
                set(ACTIVITY_PARTITION, STRUCTURED_ACTIVITY_NODE, EXPANSION_REGION,
                        INTERRUPTIBLE_ACTIVITY_REGION,
                        VARIABLE, EXCEPTION_HANDLER, COMMENT));
        allow(ACTIVITY, activityContent);
        allow(STRUCTURED_ACTIVITY_NODE, activityContent);
        allow(EXPANSION_REGION, activityContent);
        allow(INTERRUPTIBLE_ACTIVITY_REGION, activityContent);
        allow(ACTIVITY_PARTITION, activityContent);
        // 每个动作都能挂引脚：输入/输出引脚是动作的端口，不是活动的直接子节点。
        // 通用动作还允许内嵌子动作（UML 允许 Action 嵌套），具体动作只挂引脚。
        Set<ElementType> actionParts = set(VALUE_PIN, ACTION_INPUT_PIN, OUTPUT_PIN, OBJECT_NODE,
                OPAQUE_EXPRESSION, INSTANCE_VALUE, TRIGGER, COMMENT);
        allow(ACTION, union(actionParts, set(ACTION)));
        for (ElementType action : concreteActions) {
            if (action != ACTION) {
                allow(action, actionParts);
            }
        }
        allow(CONTROL_NODE, COMMENT);
        allow(INITIAL_NODE, COMMENT);
        allow(ACTIVITY_FINAL_NODE, COMMENT);
        allow(FLOW_FINAL_NODE, COMMENT);
        allow(DECISION_NODE, COMMENT);
        allow(MERGE_NODE, COMMENT);
        allow(FORK_NODE, COMMENT);
        allow(JOIN_NODE, COMMENT);
        allow(OBJECT_NODE, COMMENT);
        allow(DATA_STORE_NODE, COMMENT);
        allow(CENTRAL_BUFFER_NODE, COMMENT);
        allow(ACTIVITY_PARAMETER_NODE, COMMENT);
        allow(VALUE_PIN, COMMENT);
        allow(ACTION_INPUT_PIN, COMMENT);
        allow(OUTPUT_PIN, COMMENT);
        allow(VARIABLE, COMMENT);
        allow(EXCEPTION_HANDLER, COMMENT);

        // ── 序列 / 交互 ──
        Set<ElementType> interactionContent = set(LIFELINE, MESSAGE, COMBINED_FRAGMENT,
                INTERACTION_USE, STATE_INVARIANT, CONTINUATION, GATE,
                DESTRUCTION_OCCURRENCE_SPECIFICATION, MESSAGE_OCCURRENCE_SPECIFICATION,
                ACTION_EXECUTION_SPECIFICATION, BEHAVIOR_EXECUTION_SPECIFICATION,
                EXECUTION_OCCURRENCE_SPECIFICATION, PART_DECOMPOSITION,
                INTERACTION_CONSTRAINT, GENERAL_ORDERING, COMMENT);
        allow(INTERACTION, interactionContent);
        allow(COMBINED_FRAGMENT, union(interactionContent, set(INTERACTION_OPERAND, CONSIDER_IGNORE_FRAGMENT)));
        allow(INTERACTION_OPERAND, interactionContent);
        allow(INTERACTION_USE, CONTINUATION, STATE_INVARIANT, COMMENT);
        allow(LIFELINE, COMMENT);
        allow(MESSAGE, COMMENT);
        allow(STATE_INVARIANT, COMMENT);
        allow(CONTINUATION, COMMENT);
        allow(GATE, COMMENT);
        allow(DESTRUCTION_OCCURRENCE_SPECIFICATION, COMMENT);
        allow(MESSAGE_OCCURRENCE_SPECIFICATION, COMMENT);
        allow(ACTION_EXECUTION_SPECIFICATION, COMMENT);
        allow(BEHAVIOR_EXECUTION_SPECIFICATION, COMMENT);
        allow(EXECUTION_OCCURRENCE_SPECIFICATION, COMMENT);
        allow(PART_DECOMPOSITION, COMMENT);
        allow(INTERACTION_CONSTRAINT, COMMENT);
        allow(GENERAL_ORDERING, COMMENT);

        // ── 状态机：区域（Region）是显式类型，状态机 / 状态 / 区域内部内容一致 ──
        Set<ElementType> stateContent = set(STATE, FINAL_STATE, PSEUDOSTATE, TRANSITION,
                CONNECTION_POINT_REFERENCE, REGION, COMMENT);
        allow(STATE_MACHINE, stateContent);
        allow(PROTOCOL_STATE_MACHINE, stateContent);
        allow(STATE, stateContent);
        allow(REGION, stateContent);
        allow(FINAL_STATE, COMMENT);
        allow(PSEUDOSTATE, COMMENT);
        allow(CONNECTION_POINT_REFERENCE, COMMENT);
        // 转换带触发器：事件建模的落点是 Transition.trigger，而不是只写文本。
        allow(TRANSITION, TRIGGER, COMMENT);

        // ── 用例 / 注释 ──
        allow(USE_CASE, COMMENT);
        allow(ACTOR, COMMENT);
        allow(COMMENT);
    }

    private ContainmentRules() {
    }

    public static boolean allows(ElementType parent, ElementType child) {
        return CHILDREN.getOrDefault(parent, Set.of()).contains(child);
    }

    public static boolean isRootAllowed(ElementType child) {
        return ROOT_TYPES.contains(child);
    }

    /** 按枚举声明顺序返回，保证菜单顺序稳定。 */
    public static Set<ElementType> childrenOf(ElementType parent) {
        Set<ElementType> children = CHILDREN.get(parent);
        if (children == null) {
            return Set.of();
        }
        EnumSet<ElementType> ordered = EnumSet.noneOf(ElementType.class);
        for (ElementType type : ElementType.values()) {
            if (children.contains(type)) {
                ordered.add(type);
            }
        }
        return Collections.unmodifiableSet(ordered);
    }

    private static void allow(ElementType parent, Set<ElementType> children) {
        CHILDREN.put(parent, Collections.unmodifiableSet(children));
    }

    private static void allow(ElementType parent, ElementType... children) {
        CHILDREN.put(parent, set(children));
    }

    private static Set<ElementType> set(ElementType... values) {
        EnumSet<ElementType> result = EnumSet.noneOf(ElementType.class);
        Collections.addAll(result, values);
        return result;
    }

    /**
     * 合并多个类型集合。
     *
     * <p>UML 里同一组规则要挂在多个父类上（活动、结构化节点、扩展区域内容一致），
     * 逐个手抄容易漏项，这里显式合并，规则只写一遍。</p>
     */
    @SafeVarargs
    private static Set<ElementType> union(Set<ElementType> first, Set<ElementType>... rest) {
        EnumSet<ElementType> result = EnumSet.copyOf(first);
        for (Set<ElementType> other : rest) {
            result.addAll(other);
        }
        return result;
    }
}
