package com.scofen.model.metamodel;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static com.scofen.model.metamodel.ElementType.*;

/**
 * SysML 1.6 / UML 2.5.1 的所有权（ownership / containment）规则表。
 *
 * <p>模型树不是任意文件夹：元素能否挂在某个父元素下由元模型决定，
 * 例如 Port 只能属于 Block / PartProperty，Lifeline 只能属于 Interaction。
 * 规则由服务端下发给前端右键菜单，前端不得自行硬编码或放宽。</p>
 *
 * <p>M0 只覆盖注册表内的核心类型；后续扩充元素类型时在此登记即可，
 * 校验器与界面自动跟随。</p>
 */
public final class ContainmentRules {

    /** 可直接挂在模型根（ownerId 为空）的类型：UML 的 PackageableElement 顶层容器。 */
    public static final Set<ElementType> ROOT_TYPES =
            Collections.unmodifiableSet(set(MODEL, MODEL_LIBRARY, PACKAGE, PROFILE));

    private static final Map<ElementType, Set<ElementType>> CHILDREN = new EnumMap<>(ElementType.class);

    static {
        // 命名空间容器：包 / 模型 / 模型库可以容纳可打包元素
        Set<ElementType> namespace = set(MODEL, MODEL_LIBRARY, PACKAGE, PROFILE, STEREOTYPE, METACLASS,
                BLOCK, VALUE_TYPE, CONSTRAINT_BLOCK, REQUIREMENT, TEST_CASE,
                ACTIVITY, STATE_MACHINE, INTERACTION, USE_CASE, ACTOR, COMMENT);
        allow(MODEL, namespace);
        allow(MODEL_LIBRARY, namespace);
        allow(PACKAGE, namespace);
        // 剖面（扩展包）容纳元类与构造型：通用扩展包即由此结构落地。
        allow(PROFILE, METACLASS, STEREOTYPE, PACKAGE, COMMENT);

        // SysML 需求：需求可嵌套、可挂测试用例
        allow(REQUIREMENT, REQUIREMENT, TEST_CASE, COMMENT);
        allow(TEST_CASE, COMMENT);

        // 结构：Block 的内部结构与行为归属
        allow(BLOCK, BLOCK, PART, PORT, FLOW_PORT, CONNECTOR, VALUE_TYPE,
                CONSTRAINT_BLOCK, CONSTRAINT_PROPERTY, ACTIVITY, STATE_MACHINE, INTERACTION, COMMENT);
        allow(PART, PART, PORT, FLOW_PORT, COMMENT);
        allow(CONSTRAINT_BLOCK, CONSTRAINT_PARAMETER, CONSTRAINT_PROPERTY, VALUE_TYPE, COMMENT);
        allow(CONSTRAINT_PROPERTY, CONSTRAINT_PARAMETER, COMMENT);
        allow(CONSTRAINT_PARAMETER, COMMENT);
        allow(VALUE_TYPE, COMMENT);
        allow(CONNECTOR, COMMENT);
        allow(PORT, COMMENT);
        allow(FLOW_PORT, COMMENT);
        allow(STEREOTYPE, COMMENT);
        // 元类可容纳其特化的构造型：UML 里 Stereotype 是 Metaclass 的子类。
        allow(METACLASS, STEREOTYPE, COMMENT);

        // 行为 / 活动
        allow(ACTIVITY, ACTION, CONTROL_NODE, OBJECT_NODE, ACTIVITY_PARTITION, COMMENT);
        allow(ACTIVITY_PARTITION, ACTION, CONTROL_NODE, OBJECT_NODE, COMMENT);
        allow(ACTION, ACTION, OBJECT_NODE, COMMENT);
        allow(CONTROL_NODE, COMMENT);
        allow(OBJECT_NODE, COMMENT);

        // 序列 / 交互
        allow(INTERACTION, LIFELINE, MESSAGE, COMBINED_FRAGMENT, COMMENT);
        allow(COMBINED_FRAGMENT, MESSAGE, COMMENT);
        allow(LIFELINE, COMMENT);
        allow(MESSAGE, COMMENT);

        // 状态机（Region 尚未进入 M0 类型表，直接以 State 作为 region 内容的宿主）
        allow(STATE_MACHINE, STATE, PSEUDOSTATE, TRANSITION, COMMENT);
        allow(STATE, STATE, PSEUDOSTATE, TRANSITION, COMMENT);
        allow(PSEUDOSTATE, COMMENT);
        allow(TRANSITION, COMMENT);

        // 用例
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
}
