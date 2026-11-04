package com.scofen.model.metamodel;

/** SysML 1.6 九大图。UML 核心图复用同一记法引擎，不另立内核。 */
public enum DiagramKind {
    PKG("pkg", "包图"),
    REQ("req", "需求图"),
    BDD("bdd", "模块定义图"),
    IBD("ibd", "内部块图"),
    PAR("par", "参数图"),
    ACT("act", "活动图"),
    SEQ("seq", "序列图"),
    STM("stm", "状态机图"),
    UC("uc", "用例图");

    private final String code;
    private final String label;

    DiagramKind(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    public static DiagramKind fromCode(String code) {
        for (DiagramKind kind : values()) {
            if (kind.code.equals(code)) {
                return kind;
            }
        }
        throw new IllegalArgumentException("Unknown diagram kind: " + code);
    }
}
