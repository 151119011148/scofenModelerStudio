package com.scofen.model.metamodel;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * SysML 1.6 / UML 2.5.1 关系类型目录。
 *
 * <p>与 {@link ElementType} 一样由服务端作为元模型权威下发：组件工具箱的「关系」分组、
 * 关系弹窗的可选项、以及命令校验都只能使用本目录中的类型。每张图允许哪些关系由
 * {@link MetamodelRegistry} 表驱动定义，前端不得硬编码。</p>
 *
 * <p>code 保持 SysML 构造型写法（如 deriveReqt），label 为界面中文名，
 * family 用于工具箱内按语义族分组与图标着色。</p>
 */
public enum RelationshipType {

    // 命名空间 / 结构
    CONTAINMENT("containment", "包含", "namespace"),
    IMPORT("import", "包导入", "namespace"),
    ACCESS("access", "包访问", "namespace"),
    GENERALIZATION("generalization", "泛化", "structure"),
    ASSOCIATION("association", "关联", "structure"),
    DEPENDENCY("dependency", "依赖", "structure"),

    // 需求追溯
    SATISFY("satisfy", "满足", "requirement"),
    VERIFY("verify", "验证", "requirement"),
    REFINE("refine", "精化", "requirement"),
    DERIVE_REQT("deriveReqt", "派生需求", "requirement"),
    COPY("copy", "复制", "requirement"),
    TRACE("trace", "追溯", "requirement"),
    ALLOCATE("allocate", "分配", "requirement"),

    // 内部块 / 参数
    CONNECTOR("connector", "连接器", "structure"),
    ITEM_FLOW("itemFlow", "项目流", "structure"),
    BINDING("binding", "绑定", "constraint"),
    DELEGATION("delegation", "委托", "structure"),
    CONSTRAINT_PARAMETER("constraintParameter", "约束参数", "constraint"),

    // 活动 / 交互 / 状态机
    CONTROL_FLOW("controlFlow", "控制流", "activity"),
    OBJECT_FLOW("objectFlow", "对象流", "activity"),
    PARTITION("partition", "活动分区", "activity"),
    MESSAGE("message", "消息", "interaction"),
    ORDERED_FRAGMENT("orderedFragment", "顺序片段", "interaction"),
    GUARD("guard", "守卫", "interaction"),
    TRANSITION("transition", "状态迁移", "state"),
    REGION("region", "状态区域", "state"),

    // 用例
    INCLUDE("include", "包含用例", "usecase"),
    EXTEND("extend", "扩展用例", "usecase");

    private final String code;
    private final String label;
    private final String family;

    RelationshipType(String code, String label, String family) {
        this.code = code;
        this.label = label;
        this.family = family;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    /** 构造型名与 code 一致，前端显示为 «code»。 */
    public String stereotype() {
        return code;
    }

    public String family() {
        return family;
    }

    /** 忽略大小写与连字符/下划线，兼容 deriveReqt / derive_reqt / derive-reqt 等写法。 */
    public static Optional<RelationshipType> fromAny(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        String key = normalize(value);
        return Arrays.stream(values())
                .filter(type -> normalize(type.code).equals(key) || normalize(type.name()).equals(key))
                .findFirst();
    }

    public static String normalize(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }
}
