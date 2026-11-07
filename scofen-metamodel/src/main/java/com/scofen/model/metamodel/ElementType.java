package com.scofen.model.metamodel;

import java.util.Set;

/**
 * 可建元素类型目录（UML 2.5.1 + SysML 1.6 全量）。
 *
 * <p>每个常量同时承担三件事：</p>
 * <ul>
 *   <li>{@code umlName} —— 规范原名，属性目录按它找元类；</li>
 *   <li>{@code label} —— 界面中文名，避免前端硬编码规范词汇；</li>
 *   <li>{@code stereotype} —— 新建时默认携带的构造型名。UML 原生类型留空，
 *       只有规范里真实存在的 SysML / UML 构造型才填值，界面关键词不再冒充构造型
 *       （见 {@link #specStereotype()}）。</li>
 * </ul>
 *
 * <p>{@link Tier#ADVANCED} 的类型仍然可建、可校验、可导入导出，只是默认收在
 * 工具箱的「更多规范类型」分组里——UML 2.5.1 §16 有四十余个具体动作，
 * 全平铺会把活动图工具箱淹掉。</p>
 */
public enum ElementType {

    /* ── 命名空间：包 / 模型 / 剖面 / 扩展机制 ── */
    PACKAGE("Package", "包", "package"),
    MODEL("Model", "模型", "model"),
    MODEL_LIBRARY("ModelLibrary", "模型库", "modelLibrary"),
    PROFILE("Profile", "剖面", "profile"),
    STEREOTYPE("Stereotype", "构造型", "stereotype"),
    /**
     * 元类：UML 规范里的 Metaclass（Class 的实例）。
     *
     * <p>通用扩展包用它把 SysML / UML 的元类物化成模型元素，
     * 于是「元素扩展自哪个元类」「构造型特化哪个元类」都是可指向、可定位的引用。</p>
     */
    METACLASS("Metaclass", "元类", "metaclass"),

    /* ── 分类器（结构） ── */
    CLASS("Class", "类", ""),
    INTERFACE("Interface", "接口", ""),
    SIGNAL("Signal", "信号", ""),
    DATA_TYPE("DataType", "数据类型", ""),
    PRIMITIVE_TYPE("PrimitiveType", "原始类型", ""),
    ENUMERATION("Enumeration", "枚举", ""),
    ENUMERATION_LITERAL("EnumerationLiteral", "枚举字面量", ""),
    ASSOCIATION_CLASS("AssociationClass", "关联类", ""),
    COMPONENT("Component", "组件", ""),
    COLLABORATION("Collaboration", "协作", ""),
    COLLABORATION_USE("CollaborationUse", "协作使用", ""),
    INFORMATION_ITEM("InformationItem", "信息项", ""),
    INSTANCE_SPECIFICATION("InstanceSpecification", "实例规格", ""),

    /* ── 特征：操作 / 参数 / 接收 ── */
    OPERATION("Operation", "操作", ""),
    PARAMETER("Parameter", "参数", ""),
    RECEPTION("Reception", "接收", ""),
    PROPERTY("Property", "属性", "", Tier.ADVANCED),
    SLOT("Slot", "槽", "", Tier.ADVANCED),

    /* ── 部署 ── */
    NODE("Node", "节点", ""),
    DEVICE("Device", "设备", ""),
    EXECUTION_ENVIRONMENT("ExecutionEnvironment", "执行环境", ""),
    ARTIFACT("Artifact", "工件", ""),
    DEPLOYMENT_SPECIFICATION("DeploymentSpecification", "部署规格", ""),

    /* ── SysML 结构 ── */
    BLOCK("Block", "块", "block"),
    VALUE_TYPE("ValueType", "值类型", "valueType"),
    CONSTRAINT_BLOCK("ConstraintBlock", "约束块", "constraintBlock"),
    PART("PartProperty", "部件属性", "partProperty"),
    PORT("Port", "端口", "port"),
    FLOW_PORT("FlowPort", "流端口", "flowPort"),
    CONNECTOR("Connector", "连接器", "connector"),
    CONSTRAINT_PROPERTY("ConstraintProperty", "约束属性", "constraintProperty"),
    CONSTRAINT_PARAMETER("ConstraintParameter", "约束参数", "constraintParameter"),
    VALUE_PROPERTY("ValueProperty", "值属性", "valueProperty"),
    REFERENCE_PROPERTY("ReferenceProperty", "引用属性", "referenceProperty"),
    FLOW_PROPERTY("FlowProperty", "流属性", "flowProperty"),
    FLOW_SPECIFICATION("FlowSpecification", "流规格", "flowSpecification"),

    /* ── SysML 需求 / 视图 ── */
    REQUIREMENT("Requirement", "需求", "requirement"),
    TEST_CASE("TestCase", "测试用例", "testCase"),
    VIEW("View", "视图", "view"),
    VIEWPOINT("Viewpoint", "视点", "viewpoint"),
    RATIONALE("Rationale", "理由", "rationale"),
    PROBLEM("Problem", "问题", "problem"),

    /* ── §7 模板 / 泛型（ADVANCED） ── */
    TEMPLATE_SIGNATURE("TemplateSignature", "模板签名", "", Tier.ADVANCED),
    REDEFINABLE_TEMPLATE_SIGNATURE("RedefinableTemplateSignature", "可重定义模板签名", "", Tier.ADVANCED),
    TEMPLATE_PARAMETER("TemplateParameter", "模板参数", "", Tier.ADVANCED),
    CLASSIFIER_TEMPLATE_PARAMETER("ClassifierTemplateParameter", "分类器模板参数", "", Tier.ADVANCED),
    TEMPLATE_BINDING("TemplateBinding", "模板绑定", "", Tier.ADVANCED),
    TEMPLATE_PARAMETER_SUBSTITUTION("TemplateParameterSubstitution", "模板参数替换", "", Tier.ADVANCED),

    /* ── §8 值规格 / 观察 / 区间约束（ADVANCED） ── */
    OPAQUE_EXPRESSION("OpaqueExpression", "不透明表达式", "", Tier.ADVANCED),
    INSTANCE_VALUE("InstanceValue", "实例值", "", Tier.ADVANCED),
    DURATION_OBSERVATION("DurationObservation", "持续时间观察", "", Tier.ADVANCED),
    TIME_OBSERVATION("TimeObservation", "时间观察", "", Tier.ADVANCED),
    DURATION_INTERVAL("DurationInterval", "持续时间区间", "", Tier.ADVANCED),
    TIME_INTERVAL("TimeInterval", "时间区间", "", Tier.ADVANCED),
    INTERVAL_CONSTRAINT("IntervalConstraint", "区间约束", "", Tier.ADVANCED),
    DURATION_CONSTRAINT("DurationConstraint", "持续时间约束", "", Tier.ADVANCED),
    TIME_CONSTRAINT("TimeConstraint", "时间约束", "", Tier.ADVANCED),

    /* ── 活动：容器 / 控制节点 / 对象节点 ── */
    ACTIVITY("Activity", "活动", "activity"),
    ACTION("Action", "动作", "action"),
    OPAQUE_ACTION("OpaqueAction", "不透明动作", ""),
    CONTROL_NODE("ControlNode", "控制节点", "controlNode"),
    INITIAL_NODE("InitialNode", "初始节点", ""),
    ACTIVITY_FINAL_NODE("ActivityFinalNode", "活动终点", ""),
    FLOW_FINAL_NODE("FlowFinalNode", "流终点", ""),
    DECISION_NODE("DecisionNode", "判断节点", ""),
    MERGE_NODE("MergeNode", "合并节点", ""),
    FORK_NODE("ForkNode", "分叉节点", ""),
    JOIN_NODE("JoinNode", "汇合节点", ""),
    OBJECT_NODE("ObjectNode", "对象节点", "objectNode"),
    DATA_STORE_NODE("DataStoreNode", "数据存储节点", ""),
    CENTRAL_BUFFER_NODE("CentralBufferNode", "中央缓冲节点", ""),
    ACTIVITY_PARAMETER_NODE("ActivityParameterNode", "活动参数节点", ""),
    ACTIVITY_PARTITION("ActivityPartition", "活动分区", "partition"),
    STRUCTURED_ACTIVITY_NODE("StructuredActivityNode", "结构化活动节点", ""),
    EXPANSION_REGION("ExpansionRegion", "扩展区域", ""),
    INTERRUPTIBLE_ACTIVITY_REGION("InterruptibleActivityRegion", "可中断区域", ""),
    VALUE_PIN("ValuePin", "值引脚", ""),
    ACTION_INPUT_PIN("ActionInputPin", "动作输入引脚", ""),
    OUTPUT_PIN("OutputPin", "输出引脚", "", Tier.ADVANCED),
    VARIABLE("Variable", "变量", "", Tier.ADVANCED),
    EXCEPTION_HANDLER("ExceptionHandler", "异常处理器", "", Tier.ADVANCED),

    /* ── §16 具体动作（ADVANCED：默认收在「更多规范类型」里） ── */
    CALL_BEHAVIOR_ACTION("CallBehaviorAction", "调用行为动作", "", Tier.ADVANCED),
    CALL_OPERATION_ACTION("CallOperationAction", "调用操作动作", "", Tier.ADVANCED),
    SEND_SIGNAL_ACTION("SendSignalAction", "发送信号动作", "", Tier.ADVANCED),
    BROADCAST_SIGNAL_ACTION("BroadcastSignalAction", "广播信号动作", "", Tier.ADVANCED),
    SEND_OBJECT_ACTION("SendObjectAction", "发送对象动作", "", Tier.ADVANCED),
    ACCEPT_EVENT_ACTION("AcceptEventAction", "接受事件动作", "", Tier.ADVANCED),
    ACCEPT_CALL_ACTION("AcceptCallAction", "接受调用动作", "", Tier.ADVANCED),
    REPLY_ACTION("ReplyAction", "回复动作", "", Tier.ADVANCED),
    CREATE_OBJECT_ACTION("CreateObjectAction", "创建对象动作", "", Tier.ADVANCED),
    DESTROY_OBJECT_ACTION("DestroyObjectAction", "销毁对象动作", "", Tier.ADVANCED),
    READ_SELF_ACTION("ReadSelfAction", "读取自身动作", "", Tier.ADVANCED),
    READ_STRUCTURAL_FEATURE_ACTION("ReadStructuralFeatureAction", "读取结构特征动作", "", Tier.ADVANCED),
    WRITE_STRUCTURAL_FEATURE_ACTION("WriteStructuralFeatureAction", "写入结构特征动作", "", Tier.ADVANCED),
    ADD_STRUCTURAL_FEATURE_VALUE_ACTION("AddStructuralFeatureValueAction", "添加结构特征值动作", "", Tier.ADVANCED),
    REMOVE_STRUCTURAL_FEATURE_VALUE_ACTION("RemoveStructuralFeatureValueAction", "移除结构特征值动作", "", Tier.ADVANCED),
    CLEAR_STRUCTURAL_FEATURE_ACTION("ClearStructuralFeatureAction", "清除结构特征动作", "", Tier.ADVANCED),
    READ_VARIABLE_ACTION("ReadVariableAction", "读取变量动作", "", Tier.ADVANCED),
    WRITE_VARIABLE_ACTION("WriteVariableAction", "写入变量动作", "", Tier.ADVANCED),
    ADD_VARIABLE_VALUE_ACTION("AddVariableValueAction", "添加变量值动作", "", Tier.ADVANCED),
    REMOVE_VARIABLE_VALUE_ACTION("RemoveVariableValueAction", "移除变量值动作", "", Tier.ADVANCED),
    CLEAR_VARIABLE_ACTION("ClearVariableAction", "清除变量动作", "", Tier.ADVANCED),
    CREATE_LINK_ACTION("CreateLinkAction", "创建链接动作", "", Tier.ADVANCED),
    DESTROY_LINK_ACTION("DestroyLinkAction", "销毁链接动作", "", Tier.ADVANCED),
    READ_LINK_ACTION("ReadLinkAction", "读取链接动作", "", Tier.ADVANCED),
    CLEAR_ASSOCIATION_ACTION("ClearAssociationAction", "清除关联动作", "", Tier.ADVANCED),
    READ_EXTENT_ACTION("ReadExtentAction", "读取范围动作", "", Tier.ADVANCED),
    READ_IS_CLASSIFIED_OBJECT_ACTION("ReadIsClassifiedObjectAction", "判断分类动作", "", Tier.ADVANCED),
    RECLASSIFY_OBJECT_ACTION("ReclassifyObjectAction", "重分类对象动作", "", Tier.ADVANCED),
    REDUCE_ACTION("ReduceAction", "归约动作", "", Tier.ADVANCED),
    RAISE_EXCEPTION_ACTION("RaiseExceptionAction", "抛出异常动作", "", Tier.ADVANCED),
    UNMARSHALL_ACTION("UnmarshallAction", "解组动作", "", Tier.ADVANCED),
    TEST_IDENTITY_ACTION("TestIdentityAction", "同一性测试动作", "", Tier.ADVANCED),
    VALUE_SPECIFICATION_ACTION("ValueSpecificationAction", "值规格动作", "", Tier.ADVANCED),
    START_CLASSIFIER_BEHAVIOR_ACTION("StartClassifierBehaviorAction", "启动分类器行为动作", "", Tier.ADVANCED),
    START_OBJECT_BEHAVIOR_ACTION("StartObjectBehaviorAction", "启动对象行为动作", "", Tier.ADVANCED),

    /* ── 交互 ── */
    INTERACTION("Interaction", "交互", "interaction"),
    LIFELINE("Lifeline", "生命线", "lifeline"),
    MESSAGE("Message", "消息", "message"),
    COMBINED_FRAGMENT("CombinedFragment", "组合片段", "combinedFragment"),
    CONSIDER_IGNORE_FRAGMENT("ConsiderIgnoreFragment", "考虑 / 忽略片段", ""),
    INTERACTION_USE("InteractionUse", "交互使用", ""),
    STATE_INVARIANT("StateInvariant", "状态不变式", ""),
    CONTINUATION("Continuation", "延续", ""),
    DESTRUCTION_OCCURRENCE_SPECIFICATION("DestructionOccurrenceSpecification", "销毁发生规格", ""),
    ACTION_EXECUTION_SPECIFICATION("ActionExecutionSpecification", "动作执行规格", ""),
    BEHAVIOR_EXECUTION_SPECIFICATION("BehaviorExecutionSpecification", "行为执行规格", ""),
    GATE("Gate", "门", ""),
    MESSAGE_OCCURRENCE_SPECIFICATION("MessageOccurrenceSpecification", "消息发生规格", "", Tier.ADVANCED),
    EXECUTION_OCCURRENCE_SPECIFICATION("ExecutionOccurrenceSpecification", "执行发生规格", "", Tier.ADVANCED),
    INTERACTION_OPERAND("InteractionOperand", "交互操作数", "", Tier.ADVANCED),
    PART_DECOMPOSITION("PartDecomposition", "部件分解", "", Tier.ADVANCED),
    INTERACTION_CONSTRAINT("InteractionConstraint", "交互约束", "", Tier.ADVANCED),
    GENERAL_ORDERING("GeneralOrdering", "通用顺序", "", Tier.ADVANCED),

    /* ── 状态机 ── */
    STATE_MACHINE("StateMachine", "状态机", "stateMachine"),
    PROTOCOL_STATE_MACHINE("ProtocolStateMachine", "协议状态机", ""),
    STATE("State", "状态", "state"),
    FINAL_STATE("FinalState", "终态", ""),
    PSEUDOSTATE("Pseudostate", "伪状态", "pseudoState"),
    CONNECTION_POINT_REFERENCE("ConnectionPointReference", "连接点引用", ""),
    TRANSITION("Transition", "转换", "transition"),
    REGION("Region", "区域", "", Tier.ADVANCED),
    TRIGGER("Trigger", "触发器", "", Tier.ADVANCED),
    SIGNAL_EVENT("SignalEvent", "信号事件", "", Tier.ADVANCED),
    CALL_EVENT("CallEvent", "调用事件", "", Tier.ADVANCED),
    TIME_EVENT("TimeEvent", "时间事件", "", Tier.ADVANCED),
    CHANGE_EVENT("ChangeEvent", "变化事件", "", Tier.ADVANCED),
    ANY_RECEIVE_EVENT("AnyReceiveEvent", "任意接收事件", "", Tier.ADVANCED),

    /* ── 用例 / 注释 ── */
    USE_CASE("UseCase", "用例", "useCase"),
    ACTOR("Actor", "参与者", "actor"),
    COMMENT("Comment", "注释", "comment");

    /** 类型档次：核心类型进工具箱主分组，规范全量类型收在「更多」里。 */
    public enum Tier { CORE, ADVANCED }

    /**
     * 规范里真实存在的构造型名（SysML 1.6 + UML 2.5.1 扩展机制）。
     *
     * <p>界面为了提示「这个类型在图上显示成什么」也给 UML 原生类型配了关键词
     * （package / comment / controlNode…），但那些不是规范构造型，
     * 不能进扩展包的构造型清单——否则用户会以为 UML 定义了 «comment»。</p>
     */
    private static final Set<String> SPEC_STEREOTYPES = Set.of(
            "stereotype", "profile", "modelLibrary",
            "block", "constraintBlock", "valueType", "interfaceBlock",
            "requirement", "testCase",
            "partProperty", "valueProperty", "referenceProperty", "constraintProperty",
            "constraintParameter", "flowPort", "flowSpecification", "flowProperty", "itemFlow",
            "proxyPort", "fullPort",
            "allocate", "view", "viewpoint", "rationale", "problem");

    private final String umlName;
    private final String label;
    private final String stereotype;
    private final Tier tier;

    ElementType(String umlName, String label, String stereotype) {
        this(umlName, label, stereotype, Tier.CORE);
    }

    ElementType(String umlName, String label, String stereotype, Tier tier) {
        this.umlName = umlName;
        this.label = label;
        this.stereotype = stereotype;
        this.tier = tier;
    }

    public String umlName() {
        return umlName;
    }

    /** 中文显示名，供界面菜单使用，避免前端硬编码规范词汇。 */
    public String label() {
        return label;
    }

    /** 英文显示名：UML 规范名本身即英文，按驼峰还原为可读形式。 */
    public String labelEn() {
        return LabelUtil.humanize(umlName);
    }

    /** SysML 1.6 默认构造型，新建元素时自动带上；UML 原生类型为空。 */
    public String stereotype() {
        return stereotype;
    }

    /** 是否规范里真实存在的构造型（决定是否进扩展包的构造型清单）。 */
    public boolean specStereotype() {
        return stereotype != null && !stereotype.isBlank() && SPEC_STEREOTYPES.contains(stereotype);
    }

    /** 类型档次：ADVANCED 默认折叠，避免工具箱被四十余个动作淹没。 */
    public Tier tier() {
        return tier;
    }

    public boolean advanced() {
        return tier == Tier.ADVANCED;
    }

    public static java.util.Optional<ElementType> fromAny(String value) {
        if (value == null) {
            return java.util.Optional.empty();
        }
        for (ElementType type : values()) {
            if (type.name().equalsIgnoreCase(value) || type.umlName().equalsIgnoreCase(value)) {
                return java.util.Optional.of(type);
            }
        }
        return java.util.Optional.empty();
    }
}
