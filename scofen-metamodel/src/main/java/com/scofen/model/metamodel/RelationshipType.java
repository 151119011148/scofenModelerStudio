package com.scofen.model.metamodel;

import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

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

    /**
     * 每种关系在 UML / SysML 规范里的元类。
     *
     * <p>关系不是「画布上的一条线」就完事：它在规范里有确定的元类归属，
     * 属性面板的元类分组、扩展包里的元类 / 构造型条目、以及「扩展的元类」引用
     * 都由这张表推导。此前关系只有属性链、没有元类归属，扩展包里也就看不到关系模型。</p>
     */
    private static final Map<RelationshipType, UmlMetaclass> METACLASSES =
            new EnumMap<>(RelationshipType.class);

    /**
     * 规范里以构造型（{@code «satisfy»}、{@code «access»} …）表达的关系。
     *
     * <p>其余关系本身就是 UML 元类（Association、Dependency、Generalization…）。
     * 扩展包据此决定条目建为 Stereotype 还是 Metaclass——不是所有关系都是构造型。</p>
     */
    private static final Set<RelationshipType> STEREOTYPED =
            EnumSet.noneOf(RelationshipType.class);

    static {
        // ── UML 元类关系：规范里本身就是元类 ──
        metaclass(CONTAINMENT, UmlMetaclass.ELEMENT);
        metaclass(IMPORT, UmlMetaclass.PACKAGE_IMPORT);
        metaclass(PACKAGE_MERGE, UmlMetaclass.PACKAGE_MERGE);
        metaclass(PROFILE_APPLICATION, UmlMetaclass.PROFILE_APPLICATION);
        metaclass(GENERALIZATION, UmlMetaclass.GENERALIZATION);
        metaclass(ASSOCIATION, UmlMetaclass.ASSOCIATION);
        metaclass(DEPENDENCY, UmlMetaclass.DEPENDENCY);
        metaclass(ABSTRACTION, UmlMetaclass.ABSTRACTION);
        metaclass(REALIZATION, UmlMetaclass.REALIZATION);
        metaclass(INTERFACE_REALIZATION, UmlMetaclass.INTERFACE_REALIZATION);
        metaclass(SUBSTITUTION, UmlMetaclass.SUBSTITUTION);
        metaclass(USAGE, UmlMetaclass.USAGE);
        metaclass(INFORMATION_FLOW, UmlMetaclass.INFORMATION_FLOW);
        metaclass(MANIFESTATION, UmlMetaclass.MANIFESTATION);
        metaclass(CONNECTOR, UmlMetaclass.CONNECTOR);
        metaclass(CONTROL_FLOW, UmlMetaclass.CONTROL_FLOW);
        metaclass(OBJECT_FLOW, UmlMetaclass.OBJECT_FLOW);
        metaclass(PARTITION, UmlMetaclass.ACTIVITY_PARTITION);
        metaclass(MESSAGE, UmlMetaclass.MESSAGE);
        metaclass(GUARD, UmlMetaclass.CONSTRAINT);
        metaclass(TRANSITION, UmlMetaclass.TRANSITION);
        metaclass(REGION, UmlMetaclass.REGION);
        metaclass(INCLUDE, UmlMetaclass.INCLUDE);
        metaclass(EXTEND, UmlMetaclass.EXTEND);
        metaclass(ORDERED_FRAGMENT, UmlMetaclass.COMBINED_FRAGMENT);

        // ── 构造型关系：规范里是扩展自元类的 «stereotype» ──
        stereotyped(ACCESS, UmlMetaclass.PACKAGE_IMPORT);
        stereotyped(SATISFY, UmlMetaclass.DEPENDENCY);
        stereotyped(VERIFY, UmlMetaclass.DEPENDENCY);
        stereotyped(REFINE, UmlMetaclass.DEPENDENCY);
        stereotyped(DERIVE_REQT, UmlMetaclass.DEPENDENCY);
        stereotyped(COPY, UmlMetaclass.DEPENDENCY);
        stereotyped(TRACE, UmlMetaclass.DEPENDENCY);
        stereotyped(ALLOCATE, UmlMetaclass.ABSTRACTION);
        stereotyped(ITEM_FLOW, UmlMetaclass.INFORMATION_FLOW);
        stereotyped(BINDING, UmlMetaclass.CONNECTOR);
        stereotyped(DELEGATION, UmlMetaclass.CONNECTOR);
        stereotyped(CONSTRAINT_PARAMETER, UmlMetaclass.SYSML_CONSTRAINT_PARAMETER);
    }

    private static void metaclass(RelationshipType type, UmlMetaclass metaclass) {
        METACLASSES.put(type, metaclass);
    }

    private static void stereotyped(RelationshipType type, UmlMetaclass metaclass) {
        METACLASSES.put(type, metaclass);
        STEREOTYPED.add(type);
    }

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

    /**
     * 该关系在规范里的元类（扩展包里 {@code mc-*} 元素的来源）。
     *
     * <p>37 种关系全部有确定归属，{@code MetamodelRegistryTest} 会逐项兜底检查，
     * 新增关系类型忘记映射会直接失败。</p>
     */
    public UmlMetaclass metaclass() {
        return METACLASSES.get(this);
    }

    /** 规范出处，沿用元类的章节号。 */
    public String spec() {
        UmlMetaclass metaclass = metaclass();
        return metaclass == null ? "" : metaclass.spec();
    }

    /**
     * 规范里是否以构造型表达这条关系。
     *
     * <p>{@code true} → 扩展包里建为 Stereotype（«satisfy» «trace» «allocate» …）；
     * {@code false} → 本身就是元类（Association、Dependency、Transition …）。</p>
     */
    public boolean stereotypeRelationship() {
        return STEREOTYPED.contains(this);
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
