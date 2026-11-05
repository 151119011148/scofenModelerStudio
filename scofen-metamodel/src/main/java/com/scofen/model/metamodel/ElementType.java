package com.scofen.model.metamodel;

/** M0 元模型注册表覆盖的核心元素类型；后续按九图规格扩充到约 110 种。 */
public enum ElementType {
    PACKAGE("Package", "包", "package"),
    MODEL("Model", "模型", "model"),
    MODEL_LIBRARY("ModelLibrary", "模型库", "modelLibrary"),
    PROFILE("Profile", "剖面", "profile"),
    STEREOTYPE("Stereotype", "构造型", "stereotype"),
    REQUIREMENT("Requirement", "需求", "requirement"),
    TEST_CASE("TestCase", "测试用例", "testCase"),
    BLOCK("Block", "块", "block"),
    VALUE_TYPE("ValueType", "值类型", "valueType"),
    PART("PartProperty", "部件属性", "part"),
    PORT("Port", "端口", "port"),
    FLOW_PORT("FlowPort", "流端口", "flowPort"),
    CONNECTOR("Connector", "连接器", "connector"),
    CONSTRAINT_BLOCK("ConstraintBlock", "约束块", "constraintBlock"),
    CONSTRAINT_PROPERTY("ConstraintProperty", "约束属性", "constraintProperty"),
    CONSTRAINT_PARAMETER("ConstraintParameter", "约束参数", "constraintParameter"),
    ACTIVITY("Activity", "活动", "activity"),
    ACTION("Action", "动作", "action"),
    CONTROL_NODE("ControlNode", "控制节点", "controlNode"),
    OBJECT_NODE("ObjectNode", "对象节点", "objectNode"),
    ACTIVITY_PARTITION("ActivityPartition", "活动分区", "partition"),
    INTERACTION("Interaction", "交互", "interaction"),
    LIFELINE("Lifeline", "生命线", "lifeline"),
    MESSAGE("Message", "消息", "message"),
    COMBINED_FRAGMENT("CombinedFragment", "组合片段", "combinedFragment"),
    STATE_MACHINE("StateMachine", "状态机", "stateMachine"),
    STATE("State", "状态", "state"),
    TRANSITION("Transition", "转换", "transition"),
    PSEUDOSTATE("Pseudostate", "伪状态", "pseudoState"),
    USE_CASE("UseCase", "用例", "useCase"),
    ACTOR("Actor", "参与者", "actor"),
    COMMENT("Comment", "注释", "comment");

    private final String umlName;
    private final String label;
    private final String stereotype;

    ElementType(String umlName, String label, String stereotype) {
        this.umlName = umlName;
        this.label = label;
        this.stereotype = stereotype;
    }

    public String umlName() {
        return umlName;
    }

    /** 中文显示名，供界面菜单使用，避免前端硬编码规范词汇。 */
    public String label() {
        return label;
    }

    /** SysML 1.6 默认构造型，新建元素时自动带上。 */
    public String stereotype() {
        return stereotype;
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
