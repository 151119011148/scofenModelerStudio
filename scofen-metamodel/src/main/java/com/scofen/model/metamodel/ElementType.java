package com.scofen.model.metamodel;

/** M0 元模型注册表覆盖的核心元素类型；后续按九图规格扩充到约 110 种。 */
public enum ElementType {
    PACKAGE("Package"),
    MODEL("Model"),
    MODEL_LIBRARY("ModelLibrary"),
    PROFILE("Profile"),
    STEREOTYPE("Stereotype"),
    REQUIREMENT("Requirement"),
    TEST_CASE("TestCase"),
    BLOCK("Block"),
    VALUE_TYPE("ValueType"),
    PART("PartProperty"),
    PORT("Port"),
    FLOW_PORT("FlowPort"),
    CONNECTOR("Connector"),
    CONSTRAINT_BLOCK("ConstraintBlock"),
    CONSTRAINT_PROPERTY("ConstraintProperty"),
    CONSTRAINT_PARAMETER("ConstraintParameter"),
    ACTIVITY("Activity"),
    ACTION("Action"),
    CONTROL_NODE("ControlNode"),
    OBJECT_NODE("ObjectNode"),
    ACTIVITY_PARTITION("ActivityPartition"),
    INTERACTION("Interaction"),
    LIFELINE("Lifeline"),
    MESSAGE("Message"),
    COMBINED_FRAGMENT("CombinedFragment"),
    STATE_MACHINE("StateMachine"),
    STATE("State"),
    TRANSITION("Transition"),
    PSEUDOSTATE("Pseudostate"),
    USE_CASE("UseCase"),
    ACTOR("Actor"),
    COMMENT("Comment");

    private final String umlName;

    ElementType(String umlName) {
        this.umlName = umlName;
    }

    public String umlName() {
        return umlName;
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
