package com.scofen.model.metamodel;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * SysML 1.6 九大图 + UML 扩展图（Profile Diagram）。
 *
 * <p>扩展图是第十种规范图：它可视化构造型、元类、标签定义及它们之间的
 * {@code «stereotype»} / {@code «extend»} 关系，是对标 MagicDraw Custom Diagram
 * 与 M-Design「扩展图」的图种。UML 核心图复用同一记法引擎，不另立内核。</p>
 */
public enum DiagramKind {
    PKG("pkg", "包图", "Package Diagram"),
    REQ("req", "需求图", "Requirement Diagram"),
    BDD("bdd", "模块定义图", "Block Definition Diagram"),
    IBD("ibd", "内部块图", "Internal Block Diagram"),
    PAR("par", "参数图", "Parameter Diagram"),
    ACT("act", "活动图", "Activity Diagram"),
    SEQ("seq", "序列图", "Sequence Diagram"),
    STM("stm", "状态机图", "State Machine Diagram"),
    UC("uc", "用例图", "Use Case Diagram"),
    PROFILE("profile", "扩展图", "Profile Diagram");

    private final String code;
    private final String label;
    private final String labelEn;

    DiagramKind(String code, String label, String labelEn) {
        this.code = code;
        this.label = label;
        this.labelEn = labelEn;
    }

    @JsonValue
    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    /** 英文显示名，供中英文切换使用。 */
    public String labelEn() {
        return labelEn;
    }

    @JsonCreator
    public static DiagramKind fromCode(String code) {
        for (DiagramKind kind : values()) {
            if (kind.code.equals(code)) {
                return kind;
            }
        }
        throw new IllegalArgumentException("Unknown diagram kind: " + code);
    }
}
