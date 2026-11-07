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
    CONTAINMENT("containment", "包含", "Containment", "namespace"),
    IMPORT("import", "包导入", "Package Import", "namespace"),
    ACCESS("access", "包访问", "Package Access", "namespace"),
    PACKAGE_MERGE("packageMerge", "包合并", "Package Merge", "namespace"),
    PROFILE_APPLICATION("profileApplication", "剖面应用", "Profile Application", "namespace"),
    GENERALIZATION("generalization", "泛化", "Generalization", "structure"),
    // 关联 / 连接器 / 绑定本身没有固有方向：模型树会在两端元素下各挂一个「关系」虚拟节点。
    ASSOCIATION("association", "关联", "Association", "structure", false),
    DEPENDENCY("dependency", "依赖", "Dependency", "structure"),
    ABSTRACTION("abstraction", "抽象", "Abstraction", "structure"),
    REALIZATION("realization", "实现", "Realization", "structure"),
    INTERFACE_REALIZATION("interfaceRealization", "接口实现", "Interface Realization", "structure"),
    SUBSTITUTION("substitution", "替换", "Substitution", "structure"),
    USAGE("usage", "使用", "Usage", "structure"),
    INFORMATION_FLOW("informationFlow", "信息流", "Information Flow", "structure"),
    MANIFESTATION("manifestation", "体现", "Manifestation", "structure"),

    // 需求追溯
    SATISFY("satisfy", "满足", "Satisfy", "requirement"),
    VERIFY("verify", "验证", "Verify", "requirement"),
    REFINE("refine", "精化", "Refine", "requirement"),
    DERIVE_REQT("deriveReqt", "派生需求", "Derive Requirement", "requirement"),
    COPY("copy", "复制", "Copy", "requirement"),
    TRACE("trace", "追溯", "Trace", "requirement"),
    ALLOCATE("allocate", "分配", "Allocate", "requirement"),

    // 内部块 / 参数
    CONNECTOR("connector", "连接器", "Connector", "structure", false),
    ITEM_FLOW("itemFlow", "项目流", "Item Flow", "structure"),
    BINDING("binding", "绑定", "Binding", "constraint", false),
    DELEGATION("delegation", "委托", "Delegation", "structure"),
    CONSTRAINT_PARAMETER("constraintParameter", "约束参数", "Constraint Parameter", "constraint"),

    // 活动 / 交互 / 状态机
    CONTROL_FLOW("controlFlow", "控制流", "Control Flow", "activity"),
    OBJECT_FLOW("objectFlow", "对象流", "Object Flow", "activity"),
    PARTITION("partition", "活动分区", "Activity Partition", "activity"),
    MESSAGE("message", "消息", "Message", "interaction"),
    ORDERED_FRAGMENT("orderedFragment", "顺序片段", "Ordered Fragment", "interaction"),
    GUARD("guard", "守卫", "Guard", "interaction"),
    TRANSITION("transition", "状态迁移", "Transition", "state"),
    REGION("region", "状态区域", "Region", "state"),

    // 用例
    INCLUDE("include", "包含用例", "Include", "usecase"),
    EXTEND("extend", "扩展用例", "Extend", "usecase");

    private final String code;
    private final String label;
    private final String labelEn;
    private final String family;
    /** true = 有方向的单向关系（只挂载到源端）；false = 双向 / 无向关系（两端都挂载）。 */
    private final boolean directed;

    RelationshipType(String code, String label, String labelEn, String family) {
        this(code, label, labelEn, family, true);
    }

    RelationshipType(String code, String label, String labelEn, String family, boolean directed) {
        this.code = code;
        this.label = label;
        this.labelEn = labelEn;
        this.family = family;
        this.directed = directed;
    }

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

    /** 构造型名与 code 一致，前端显示为 «code»。 */
    public String stereotype() {
        return code;
    }

    public String family() {
        return family;
    }

    /**
     * 关系方向（元模型权威）：单向关系在模型树里只挂到源端元素的「关系」虚拟节点下，
     * 双向 / 无向关系同时挂到源端与目标端。前端不得自行硬编码这张方向表。
     */
    public boolean directed() {
        return directed;
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
