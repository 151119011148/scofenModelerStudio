package com.scofen.model.metamodel;

import java.util.Arrays;
import java.util.List;

/**
 * UML 2.5.1 / SysML 1.6 元类继承链（属性目录的骨架）。
 *
 * <p>枚举常量严格按拓扑序声明：父元类必须出现在子元类之前，避免 Java 枚举的
 * forward reference。{@code parents} 允许多继承（UML 的 Classifier 等本就是多继承）。
 * 属性表按「具体元类 → 父元类」展开，因此每个元素类型看到的是完整继承链上的全部元属性。</p>
 */
public enum UmlMetaclass {

    /* ── UML 2.5.1 基础层 ── */
    ELEMENT("Element", "元素", "UML 2.5.1 §7.8"),
    RELATIONSHIP("Relationship", "关系", "UML 2.5.1 §7.3", ELEMENT),
    DIRECTED_RELATIONSHIP("DirectedRelationship", "有向关系", "UML 2.5.1 §7.3", RELATIONSHIP),
    NAMED_ELEMENT("NamedElement", "命名元素", "UML 2.5.1 §7.8", ELEMENT),
    REDEFINABLE_ELEMENT("RedefinableElement", "可重定义元素", "UML 2.5.1 §7.8", NAMED_ELEMENT),
    NAMESPACE("Namespace", "命名空间", "UML 2.5.1 §7.8", NAMED_ELEMENT),
    PACKAGEABLE_ELEMENT("PackageableElement", "可打包元素", "UML 2.5.1 §7.8", NAMED_ELEMENT),
    TYPE("Type", "类型", "UML 2.5.1 §7.5", PACKAGEABLE_ELEMENT),
    TEMPLATEABLE_ELEMENT("TemplateableElement", "可模板化元素", "UML 2.5.1 §7.4", ELEMENT),
    PARAMETERABLE_ELEMENT("ParameterableElement", "可参数化元素", "UML 2.5.1 §7.4", ELEMENT),
    TYPED_ELEMENT("TypedElement", "带类型元素", "UML 2.5.1 §7.5", NAMED_ELEMENT),
    MULTIPLICITY_ELEMENT("MultiplicityElement", "多重性元素", "UML 2.5.1 §7.5", ELEMENT),
    FEATURE("Feature", "特征", "UML 2.5.1 §9.4", REDEFINABLE_ELEMENT),
    STRUCTURAL_FEATURE("StructuralFeature", "结构特征", "UML 2.5.1 §9.4", FEATURE, TYPED_ELEMENT, MULTIPLICITY_ELEMENT),
    BEHAVIORAL_FEATURE("BehavioralFeature", "行为特征", "UML 2.5.1 §9.4", FEATURE, NAMESPACE),
    CONNECTABLE_ELEMENT("ConnectableElement", "可连接元素", "UML 2.5.1 §11.2", TYPED_ELEMENT, PARAMETERABLE_ELEMENT),
    DEPLOYMENT_TARGET("DeploymentTarget", "部署目标", "UML 2.5.1 §19.4", NAMED_ELEMENT),
    CLASSIFIER("Classifier", "分类器", "UML 2.5.1 §9.2", NAMESPACE, TYPE, REDEFINABLE_ELEMENT, TEMPLATEABLE_ELEMENT),
    STRUCTURED_CLASSIFIER("StructuredClassifier", "结构化分类器", "UML 2.5.1 §11.2", CLASSIFIER),
    ENCAPSULATED_CLASSIFIER("EncapsulatedClassifier", "封装分类器", "UML 2.5.1 §11.2", STRUCTURED_CLASSIFIER),
    BEHAVIORED_CLASSIFIER("BehavioredClassifier", "带行为分类器", "UML 2.5.1 §9.2", CLASSIFIER),
    CLASS("Class", "类", "UML 2.5.1 §11.4", BEHAVIORED_CLASSIFIER, ENCAPSULATED_CLASSIFIER),
    DATA_TYPE("DataType", "数据类型", "UML 2.5.1 §10.2", CLASSIFIER),
    PRIMITIVE_TYPE("PrimitiveType", "原始类型", "UML 2.5.1 §10.2", DATA_TYPE),
    ENUMERATION("Enumeration", "枚举", "UML 2.5.1 §10.2", DATA_TYPE),
    INSTANCE_SPECIFICATION("InstanceSpecification", "实例规格", "UML 2.5.1 §9.8", PACKAGEABLE_ELEMENT, DEPLOYMENT_TARGET),
    ENUMERATION_LITERAL("EnumerationLiteral", "枚举字面量", "UML 2.5.1 §10.2", INSTANCE_SPECIFICATION),
    SLOT("Slot", "槽", "UML 2.5.1 §9.8", ELEMENT),
    VALUE_SPECIFICATION("ValueSpecification", "值规格", "UML 2.5.1 §8.2", PACKAGEABLE_ELEMENT, TYPED_ELEMENT),
    LITERAL_SPECIFICATION("LiteralSpecification", "字面量规格", "UML 2.5.1 §8.2", VALUE_SPECIFICATION),
    LITERAL_STRING("LiteralString", "字符串字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    LITERAL_INTEGER("LiteralInteger", "整数字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    LITERAL_BOOLEAN("LiteralBoolean", "布尔字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    LITERAL_REAL("LiteralReal", "实数字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    LITERAL_UNLIMITED_NATURAL("LiteralUnlimitedNatural", "无限自然数字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    LITERAL_NULL("LiteralNull", "空字面量", "UML 2.5.1 §8.2", LITERAL_SPECIFICATION),
    EXPRESSION("Expression", "表达式", "UML 2.5.1 §8.3", VALUE_SPECIFICATION),
    STRING_EXPRESSION("StringExpression", "字符串表达式", "UML 2.5.1 §8.3", EXPRESSION),
    OPAQUE_EXPRESSION("OpaqueExpression", "不透明表达式", "UML 2.5.1 §8.3", VALUE_SPECIFICATION),
    INSTANCE_VALUE("InstanceValue", "实例值", "UML 2.5.1 §8.2", VALUE_SPECIFICATION),
    ELEMENT_VALUE("ElementValue", "元素值", "UML 2.5.1 §8.2", VALUE_SPECIFICATION),
    TIME_EXPRESSION("TimeExpression", "时间表达式", "UML 2.5.1 §8.4", VALUE_SPECIFICATION),
    DURATION("Duration", "持续时间", "UML 2.5.1 §8.4", VALUE_SPECIFICATION),
    INTERVAL("Interval", "区间", "UML 2.5.1 §8.4", VALUE_SPECIFICATION),
    PROPERTY("Property", "属性", "UML 2.5.1 §9.5", STRUCTURAL_FEATURE, CONNECTABLE_ELEMENT, DEPLOYMENT_TARGET),
    PORT("Port", "端口", "UML 2.5.1 §11.2", PROPERTY),
    OPERATION("Operation", "操作", "UML 2.5.1 §9.6", BEHAVIORAL_FEATURE, TEMPLATEABLE_ELEMENT, PARAMETERABLE_ELEMENT),
    PARAMETER("Parameter", "参数", "UML 2.5.1 §9.4", TYPED_ELEMENT, MULTIPLICITY_ELEMENT),
    PARAMETER_SET("ParameterSet", "参数集", "UML 2.5.1 §9.4", NAMED_ELEMENT),
    RECEPTION("Reception", "接收", "UML 2.5.1 §9.6", BEHAVIORAL_FEATURE),
    SIGNAL("Signal", "信号", "UML 2.5.1 §10.3", CLASSIFIER),
    INTERFACE("Interface", "接口", "UML 2.5.1 §11.4", CLASSIFIER),
    COMPONENT("Component", "组件", "UML 2.5.1 §11.6", CLASS),
    NODE("Node", "节点", "UML 2.5.1 §19.4", CLASS),
    ARTIFACT("Artifact", "工件", "UML 2.5.1 §19.4", CLASSIFIER, DEPLOYMENT_TARGET),
    PACKAGE("Package", "包", "UML 2.5.1 §12.2", NAMESPACE, PACKAGEABLE_ELEMENT, TEMPLATEABLE_ELEMENT),
    MODEL("Model", "模型", "UML 2.5.1 §12.2", PACKAGE),
    PROFILE("Profile", "剖面", "UML 2.5.1 §12.3", PACKAGE),
    STEREOTYPE("Stereotype", "构造型", "UML 2.5.1 §12.3", CLASS),
    DEPENDENCY("Dependency", "依赖", "UML 2.5.1 §7.3", DIRECTED_RELATIONSHIP, PACKAGEABLE_ELEMENT),
    ABSTRACTION("Abstraction", "抽象", "UML 2.5.1 §7.3", DEPENDENCY),
    REALIZATION("Realization", "实现", "UML 2.5.1 §7.3", ABSTRACTION),
    USAGE("Usage", "使用", "UML 2.5.1 §7.3", DEPENDENCY),
    SUBSTITUTION("Substitution", "替换", "UML 2.5.1 §9.2", REALIZATION),
    GENERALIZATION("Generalization", "泛化", "UML 2.5.1 §9.2", DIRECTED_RELATIONSHIP),
    GENERALIZATION_SET("GeneralizationSet", "泛化集", "UML 2.5.1 §9.2", PACKAGEABLE_ELEMENT),
    ASSOCIATION("Association", "关联", "UML 2.5.1 §11.5", CLASSIFIER, RELATIONSHIP),
    EXTENSION("Extension", "扩展", "UML 2.5.1 §12.3", ASSOCIATION),
    EXTENSION_END("ExtensionEnd", "扩展端", "UML 2.5.1 §12.3", PROPERTY),
    PROFILE_APPLICATION("ProfileApplication", "剖面应用", "UML 2.5.1 §12.3", DIRECTED_RELATIONSHIP),
    PACKAGE_IMPORT("PackageImport", "包导入", "UML 2.5.1 §12.2", DIRECTED_RELATIONSHIP),
    ELEMENT_IMPORT("ElementImport", "元素导入", "UML 2.5.1 §12.2", DIRECTED_RELATIONSHIP),
    PACKAGE_MERGE("PackageMerge", "包合并", "UML 2.5.1 §12.2", DIRECTED_RELATIONSHIP),
    DEPLOYMENT("Deployment", "部署", "UML 2.5.1 §19.4", DEPENDENCY),
    COMMENT("Comment", "注释", "UML 2.5.1 §7.2", ELEMENT),
    CONSTRAINT("Constraint", "约束", "UML 2.5.1 §7.6", PACKAGEABLE_ELEMENT),
    COLLABORATION("Collaboration", "协作", "UML 2.5.1 §11.7", BEHAVIORED_CLASSIFIER, STRUCTURED_CLASSIFIER),
    COLLABORATION_USE("CollaborationUse", "协作使用", "UML 2.5.1 §11.7", NAMED_ELEMENT),
    CONNECTOR("Connector", "连接器", "UML 2.5.1 §11.2", FEATURE),
    CONNECTOR_END("ConnectorEnd", "连接器端", "UML 2.5.1 §11.2", MULTIPLICITY_ELEMENT),
    BEHAVIOR("Behavior", "行为", "UML 2.5.1 §13.2", CLASS),
    OPAQUE_BEHAVIOR("OpaqueBehavior", "不透明行为", "UML 2.5.1 §13.2", BEHAVIOR),
    FUNCTION_BEHAVIOR("FunctionBehavior", "函数行为", "UML 2.5.1 §13.2", OPAQUE_BEHAVIOR),
    ACTIVITY("Activity", "活动", "UML 2.5.1 §15.2", BEHAVIOR),
    ACTIVITY_NODE("ActivityNode", "活动节点", "UML 2.5.1 §15.2", REDEFINABLE_ELEMENT),
    EXECUTABLE_NODE("ExecutableNode", "可执行节点", "UML 2.5.1 §15.3", ACTIVITY_NODE),
    ACTION("Action", "动作", "UML 2.5.1 §16.2", EXECUTABLE_NODE),
    CONTROL_NODE("ControlNode", "控制节点", "UML 2.5.1 §15.3", ACTIVITY_NODE),
    OBJECT_NODE("ObjectNode", "对象节点", "UML 2.5.1 §15.4", ACTIVITY_NODE, TYPED_ELEMENT),
    DATA_STORE_NODE("DataStoreNode", "数据存储节点", "UML 2.5.1 §15.4", OBJECT_NODE),
    CENTRAL_BUFFER_NODE("CentralBufferNode", "中央缓冲节点", "UML 2.5.1 §15.4", OBJECT_NODE),
    PIN("Pin", "引脚", "UML 2.5.1 §16.2", OBJECT_NODE, MULTIPLICITY_ELEMENT),
    INPUT_PIN("InputPin", "输入引脚", "UML 2.5.1 §16.2", PIN),
    OUTPUT_PIN("OutputPin", "输出引脚", "UML 2.5.1 §16.2", PIN),
    ACTIVITY_EDGE("ActivityEdge", "活动边", "UML 2.5.1 §15.2", REDEFINABLE_ELEMENT),
    CONTROL_FLOW("ControlFlow", "控制流", "UML 2.5.1 §15.2", ACTIVITY_EDGE),
    OBJECT_FLOW("ObjectFlow", "对象流", "UML 2.5.1 §15.3", ACTIVITY_EDGE),
    ACTIVITY_GROUP("ActivityGroup", "活动组", "UML 2.5.1 §15.2", ELEMENT),
    ACTIVITY_PARTITION("ActivityPartition", "活动分区", "UML 2.5.1 §15.2", ACTIVITY_GROUP, NAMED_ELEMENT),
    ACTIVITY_PARAMETER_NODE("ActivityParameterNode", "活动参数节点", "UML 2.5.1 §15.4", OBJECT_NODE),
    VARIABLE("Variable", "变量", "UML 2.5.1 §15.5", MULTIPLICITY_ELEMENT, CONNECTABLE_ELEMENT),
    EXCEPTION_HANDLER("ExceptionHandler", "异常处理器", "UML 2.5.1 §15.5", ELEMENT),
    INTERACTION_FRAGMENT("InteractionFragment", "交互片段", "UML 2.5.1 §17.2", NAMED_ELEMENT),
    INTERACTION("Interaction", "交互", "UML 2.5.1 §17.2", BEHAVIOR, INTERACTION_FRAGMENT),
    OCCURRENCE_SPECIFICATION("OccurrenceSpecification", "发生规格", "UML 2.5.1 §17.3", INTERACTION_FRAGMENT),
    EXECUTION_SPECIFICATION("ExecutionSpecification", "执行规格", "UML 2.5.1 §17.3", INTERACTION_FRAGMENT),
    MESSAGE_END("MessageEnd", "消息端", "UML 2.5.1 §17.3", NAMED_ELEMENT),
    MESSAGE("Message", "消息", "UML 2.5.1 §17.3", NAMED_ELEMENT),
    MESSAGE_OCCURRENCE_SPECIFICATION("MessageOccurrenceSpecification", "消息发生规格", "UML 2.5.1 §17.3", OCCURRENCE_SPECIFICATION, MESSAGE_END),
    LIFELINE("Lifeline", "生命线", "UML 2.5.1 §17.3", NAMED_ELEMENT),
    COMBINED_FRAGMENT("CombinedFragment", "组合片段", "UML 2.5.1 §17.6", INTERACTION_FRAGMENT),
    INTERACTION_OPERAND("InteractionOperand", "交互操作数", "UML 2.5.1 §17.6", INTERACTION_FRAGMENT, NAMESPACE),
    INTERACTION_USE("InteractionUse", "交互使用", "UML 2.5.1 §17.6", INTERACTION_FRAGMENT),
    STATE_INVARIANT("StateInvariant", "状态不变式", "UML 2.5.1 §17.6", INTERACTION_FRAGMENT),
    GATE("Gate", "门", "UML 2.5.1 §17.6", MESSAGE_END),
    GENERAL_ORDERING("GeneralOrdering", "一般排序", "UML 2.5.1 §17.3", NAMED_ELEMENT),
    STATE_MACHINE("StateMachine", "状态机", "UML 2.5.1 §14.2", BEHAVIOR),
    REGION("Region", "区域", "UML 2.5.1 §14.2", NAMESPACE, REDEFINABLE_ELEMENT),
    VERTEX("Vertex", "顶点", "UML 2.5.1 §14.2", REDEFINABLE_ELEMENT),
    PSEUDOSTATE("Pseudostate", "伪状态", "UML 2.5.1 §14.2", VERTEX),
    STATE("State", "状态", "UML 2.5.1 §14.2", VERTEX, NAMESPACE),
    FINAL_STATE("FinalState", "终态", "UML 2.5.1 §14.2", STATE),
    CONNECTION_POINT_REFERENCE("ConnectionPointReference", "连接点引用", "UML 2.5.1 §14.2", VERTEX),
    TRANSITION("Transition", "转换", "UML 2.5.1 §14.2", NAMESPACE, REDEFINABLE_ELEMENT),
    EVENT("Event", "事件", "UML 2.5.1 §13.3", PACKAGEABLE_ELEMENT),
    SIGNAL_EVENT("SignalEvent", "信号事件", "UML 2.5.1 §13.3", EVENT),
    CALL_EVENT("CallEvent", "调用事件", "UML 2.5.1 §13.3", EVENT),
    TIME_EVENT("TimeEvent", "时间事件", "UML 2.5.1 §13.3", EVENT),
    CHANGE_EVENT("ChangeEvent", "改变事件", "UML 2.5.1 §13.3", EVENT),
    TRIGGER("Trigger", "触发器", "UML 2.5.1 §13.3", NAMED_ELEMENT),
    USE_CASE("UseCase", "用例", "UML 2.5.1 §18.2", BEHAVIORED_CLASSIFIER),
    ACTOR("Actor", "参与者", "UML 2.5.1 §18.2", BEHAVIORED_CLASSIFIER),
    EXTENSION_POINT("ExtensionPoint", "扩展点", "UML 2.5.1 §18.2", REDEFINABLE_ELEMENT),
    INCLUDE("Include", "包含", "UML 2.5.1 §18.2", DIRECTED_RELATIONSHIP),
    EXTEND("Extend", "扩展", "UML 2.5.1 §18.2", DIRECTED_RELATIONSHIP),
    TEMPLATE_SIGNATURE("TemplateSignature", "模板签名", "UML 2.5.1 §7.4", ELEMENT),
    TEMPLATE_PARAMETER("TemplateParameter", "模板参数", "UML 2.5.1 §7.4", ELEMENT),

    /* ── SysML 1.6 构造型（扩展 UML 元类） ── */
    SYSML_BLOCK("Block", "块", "SysML 1.6 §8.3.2", CLASS),
    SYSML_CONSTRAINT_BLOCK("ConstraintBlock", "约束块", "SysML 1.6 §10.3.2", SYSML_BLOCK),
    SYSML_VALUE_TYPE("ValueType", "值类型", "SysML 1.6 §8.3.2", DATA_TYPE),
    SYSML_UNIT("Unit", "单位", "SysML 1.6 §8.3.3", SYSML_VALUE_TYPE),
    SYSML_DIMENSION("Dimension", "量纲", "SysML 1.6 §8.3.3", SYSML_VALUE_TYPE),
    SYSML_REQUIREMENT("Requirement", "需求", "SysML 1.6 §16.3.2", CLASS),
    SYSML_TEST_CASE("TestCase", "测试用例", "SysML 1.6 §16.3.2", BEHAVIORED_CLASSIFIER),
    SYSML_PART_PROPERTY("PartProperty", "部件属性", "SysML 1.6 §8.3.2", PROPERTY),
    SYSML_VALUE_PROPERTY("ValueProperty", "值属性", "SysML 1.6 §8.3.2", PROPERTY),
    SYSML_REFERENCE_PROPERTY("ReferenceProperty", "引用属性", "SysML 1.6 §8.3.2", PROPERTY),
    SYSML_CONSTRAINT_PROPERTY("ConstraintProperty", "约束属性", "SysML 1.6 §10.3.2", PROPERTY),
    SYSML_CONSTRAINT_PARAMETER("ConstraintParameter", "约束参数", "SysML 1.6 §10.3.2", PARAMETER),
    SYSML_FLOW_PORT("FlowPort", "流端口", "SysML 1.6 §9.3.2", PORT),
    SYSML_FLOW_SPECIFICATION("FlowSpecification", "流规格", "SysML 1.6 §9.3.2", INTERFACE),
    SYSML_FLOW_PROPERTY("FlowProperty", "流属性", "SysML 1.6 §9.3.2", PROPERTY),
    SYSML_ITEM_FLOW("ItemFlow", "项流", "SysML 1.6 §9.3.2", DIRECTED_RELATIONSHIP),
    SYSML_ALLOCATE("Allocate", "分配", "SysML 1.6 §15.3.2", ABSTRACTION),
    SYSML_VIEW("View", "视图", "SysML 1.6 §8.3.2", CLASS),
    SYSML_VIEWPOINT("Viewpoint", "视点", "SysML 1.6 §8.3.2", CLASS),
    SYSML_RATIONALE("Rationale", "理由", "SysML 1.6 §16.3.2", COMMENT),
    SYSML_PROBLEM("Problem", "问题", "SysML 1.6 §16.3.2", COMMENT),

    /** 本产品实现的系统级元属性：标识、文档、构造型与派生统计量（对应 UML Comment / Element 的工程展开）。 */
    SCOFEN_CORE("Scofen Core Properties", "系统属性", "Scofen 实现层 / UML 2.5.1 §7.2", ELEMENT),

    /**
     * 关系的系统级元属性。关系与元素同为模型对象，但没有包含层级，
     * 端点用 sourceId / targetId 只读引用，故单独一层而不复用 SCOFEN_CORE。
     */
    SCOFEN_RELATION("Scofen Relationship Properties", "关系系统属性", "Scofen 实现层 / UML 2.5.1 §7.3");

    private final String umlName;
    private final String label;
    private final String spec;
    private final List<UmlMetaclass> parents;

    UmlMetaclass(String umlName, String label, String spec, UmlMetaclass... parents) {
        this.umlName = umlName;
        this.label = label;
        this.spec = spec;
        this.parents = List.copyOf(Arrays.asList(parents));
    }

    public String umlName() { return umlName; }
    public String label() { return label; }
    /** 英文显示名：由 UML 规范名还原为可读形式，供中英文切换使用。 */
    public String labelEn() { return LabelUtil.humanize(umlName); }
    public String spec() { return spec; }
    public List<UmlMetaclass> parents() { return parents; }
}
