package com.scofen.model.metamodel;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 通用扩展包与标准库：把 UML / SysML 的元类、构造型、原始类型、值类型、单位量纲
 * 物化成模型元素，随每个项目提供。
 *
 * <pre>
 * 示例项目（Package）
 * ├── SysML 扩展包            （Profile）
 * │   ├── 元类               （Package）
 * │   └── 构造型             （Package）
 * ├── UML 扩展包              （Profile）
 * │   ├── 元类               （Package）
 * │   └── 构造型             （Package）
 * ├── UML 原始类型库          （ModelLibrary）Boolean / Integer / Real / String / UnlimitedNatural
 * ├── SysML 值类型库          （ModelLibrary）ValueType × 6 + 枚举 × 3
 * ├── 单位与量纲库            （ModelLibrary）基本单位 / 基本量纲 / 导出单位
 * └── UML 标准构造型库        （Profile）«entity» «control» «boundary» …
 * </pre>
 *
 * <p>这样做的意义在于：元模型不再是界面里的静态说明，而是模型里可被引用、
 * 可在模型树上定位的对象。属性面板里的「类型」因此能真正指向 {@code String}、
 * {@code Real}、{@code metre}——而不是要求用户自己先造一个同名元素。</p>
 */
public final class ExtensionLibrary {

    /** SysML 扩展包（Profile）元素 id。 */
    public static final String SYSML_PROFILE_ID = "ext-sysml";
    /** UML 扩展包（Profile）元素 id。 */
    public static final String UML_PROFILE_ID = "ext-uml";
    /** UML 原始类型库（ModelLibrary）元素 id。 */
    public static final String PRIMITIVE_LIBRARY_ID = "ext-primitive";
    /** SysML 值类型库（ModelLibrary）元素 id。 */
    public static final String VALUE_LIBRARY_ID = "ext-value";
    /** 单位与量纲库（ModelLibrary）元素 id。 */
    public static final String UNITS_LIBRARY_ID = "ext-qudv";
    /** UML 标准构造型库（Profile）元素 id。 */
    public static final String STANDARD_PROFILE_ID = "ext-standard";

    /** 元类子包 id 后缀。 */
    public static final String METACLASS_PACKAGE_SUFFIX = "-mc";
    /** 构造型子包 id 后缀。 */
    public static final String STEREOTYPE_PACKAGE_SUFFIX = "-st";

    /** 元类元素的 id 前缀。 */
    public static final String METACLASS_ID_PREFIX = "mc-";
    /** 构造型元素的 id 前缀。 */
    public static final String STEREOTYPE_ID_PREFIX = "st-";

    /** 六个顶层扩展包 / 库，按界面展示顺序排列。 */
    public static final List<String> ROOT_IDS = List.of(
            SYSML_PROFILE_ID, UML_PROFILE_ID, PRIMITIVE_LIBRARY_ID,
            VALUE_LIBRARY_ID, UNITS_LIBRARY_ID, STANDARD_PROFILE_ID);

    /**
     * 构造型归入哪个扩展包。
     *
     * <p>UML 自身的构造型（剖面、构造型、模型库…）留在 UML 扩展包；
     * SysML 1.6 定义的构造型（块、需求、值类型、部件属性…）归入 SysML 扩展包。
     * 注意 SysML 的活动、状态、用例等构造型作用在 UML 元类上，
     * 因此它们的「扩展的元类」会指向 UML 扩展包里的元类。</p>
     */
    private static final Set<ElementType> UML_SIDE_STEREOTYPES = EnumSet.of(
            ElementType.PACKAGE,
            ElementType.MODEL,
            ElementType.MODEL_LIBRARY,
            ElementType.PROFILE,
            ElementType.STEREOTYPE,
            ElementType.PORT,
            ElementType.CONNECTOR,
            ElementType.COMMENT);

    /**
     * 一条扩展包元素定义。
     *
     * @param id           元素 id
     * @param type         元素类型（{@link ElementType} 名称）
     * @param name         元素名（元类用规范原名，构造型用构造型名）
     * @param ownerId      所有者 id
     * @param documentation 文档（写规范出处）
     * @param stereotypes  构造型名列表
     * @param properties   规范元属性包
     */
    public record Definition(String id,
                             String type,
                             String name,
                             String ownerId,
                             String documentation,
                             List<String> stereotypes,
                             Map<String, Object> properties) {
    }

    /** UML 原始类型：UMLPrimitiveTypes 库的内容（UML 2.5.1 §21）。 */
    private static final List<String> PRIMITIVE_TYPES =
            List.of("Boolean", "Integer", "Real", "String", "UnlimitedNatural");

    /** SysML 值类型：SysML PrimitiveValueTypes 库的内容（SysML 1.6 §8.3.3）。 */
    private static final List<String> SYSML_VALUE_TYPES =
            List.of("Boolean", "Integer", "Real", "String", "Number", "Complex");

    /** SysML 规范枚举类型（枚举名 → 字面量）。 */
    private static final Map<String, List<String>> SYSML_ENUMERATIONS = new LinkedHashMap<>();

    static {
        SYSML_ENUMERATIONS.put("ControlValueKind", List.of("trigger", "enable", "disable"));
        SYSML_ENUMERATIONS.put("VerdictKind", List.of("pass", "fail", "inconclusive"));
        SYSML_ENUMERATIONS.put("FeatureDirectionKind",
                List.of("provided", "required", "providedRequired"));
    }

    /** 基本量纲（ISO 80000 / QUDV）：id 后缀 → 显示名。 */
    private static final Map<String, String> BASE_DIMENSIONS = new LinkedHashMap<>();

    /** 基本单位：单位 id 后缀 → [显示名, 符号, 所属量纲]。 */
    private static final Map<String, String[]> BASE_UNITS = new LinkedHashMap<>();

    /** 导出单位：单位 id 后缀 → [显示名, 符号, 所属量纲]。 */
    private static final Map<String, String[]> DERIVED_UNITS = new LinkedHashMap<>();

    static {
        BASE_DIMENSIONS.put("length", "长度");
        BASE_DIMENSIONS.put("mass", "质量");
        BASE_DIMENSIONS.put("time", "时间");
        BASE_DIMENSIONS.put("electricCurrent", "电流");
        BASE_DIMENSIONS.put("thermodynamicTemperature", "热力学温度");
        BASE_DIMENSIONS.put("amountOfSubstance", "物质的量");
        BASE_DIMENSIONS.put("luminousIntensity", "发光强度");

        BASE_UNITS.put("metre", new String[]{"metre", "m", "length"});
        BASE_UNITS.put("kilogram", new String[]{"kilogram", "kg", "mass"});
        BASE_UNITS.put("second", new String[]{"second", "s", "time"});
        BASE_UNITS.put("ampere", new String[]{"ampere", "A", "electricCurrent"});
        BASE_UNITS.put("kelvin", new String[]{"kelvin", "K", "thermodynamicTemperature"});
        BASE_UNITS.put("mole", new String[]{"mole", "mol", "amountOfSubstance"});
        BASE_UNITS.put("candela", new String[]{"candela", "cd", "luminousIntensity"});

        DERIVED_UNITS.put("radian", new String[]{"radian", "rad", "length"});
        DERIVED_UNITS.put("steradian", new String[]{"steradian", "sr", "length"});
        DERIVED_UNITS.put("hertz", new String[]{"hertz", "Hz", "time"});
        DERIVED_UNITS.put("newton", new String[]{"newton", "N", "mass"});
        DERIVED_UNITS.put("pascal", new String[]{"pascal", "Pa", "mass"});
        DERIVED_UNITS.put("joule", new String[]{"joule", "J", "mass"});
        DERIVED_UNITS.put("watt", new String[]{"watt", "W", "mass"});
        DERIVED_UNITS.put("coulomb", new String[]{"coulomb", "C", "electricCurrent"});
        DERIVED_UNITS.put("volt", new String[]{"volt", "V", "electricCurrent"});
        DERIVED_UNITS.put("farad", new String[]{"farad", "F", "electricCurrent"});
        DERIVED_UNITS.put("ohm", new String[]{"ohm", "Ω", "electricCurrent"});
        DERIVED_UNITS.put("siemens", new String[]{"siemens", "S", "electricCurrent"});
        DERIVED_UNITS.put("weber", new String[]{"weber", "Wb", "electricCurrent"});
        DERIVED_UNITS.put("tesla", new String[]{"tesla", "T", "electricCurrent"});
        DERIVED_UNITS.put("henry", new String[]{"henry", "H", "electricCurrent"});
        DERIVED_UNITS.put("degreeCelsius", new String[]{"degree Celsius", "°C", "thermodynamicTemperature"});
        DERIVED_UNITS.put("lumen", new String[]{"lumen", "lm", "luminousIntensity"});
        DERIVED_UNITS.put("lux", new String[]{"lux", "lx", "luminousIntensity"});
        DERIVED_UNITS.put("becquerel", new String[]{"becquerel", "Bq", "time"});
        DERIVED_UNITS.put("gray", new String[]{"gray", "Gy", "mass"});
        DERIVED_UNITS.put("sievert", new String[]{"sievert", "Sv", "mass"});
        DERIVED_UNITS.put("katal", new String[]{"katal", "kat", "amountOfSubstance"});
    }

    /**
     * UML StandardProfile L2 / L3 的构造型（构造型名 → 扩展的元类）。
     *
     * <p>只收录规范里真实存在的构造型；{@code stereotype / profile / modelLibrary}
     * 已由 {@link ElementType} 生成，这里不重复。</p>
     */
    private static final Map<String, UmlMetaclass> STANDARD_STEREOTYPES = new LinkedHashMap<>();

    static {
        // L2 —— 类与组件的职责划分
        STANDARD_STEREOTYPES.put("entity", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("control", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("boundary", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("auxiliary", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("focus", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("responsibility", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("specification", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("implementationClass", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("utility", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("metaclass", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("powertype", UmlMetaclass.CLASS);
        STANDARD_STEREOTYPES.put("framework", UmlMetaclass.PACKAGE);
        STANDARD_STEREOTYPES.put("subsystem", UmlMetaclass.COMPONENT);
        STANDARD_STEREOTYPES.put("service", UmlMetaclass.COMPONENT);
        STANDARD_STEREOTYPES.put("process", UmlMetaclass.COMPONENT);
        STANDARD_STEREOTYPES.put("buildComponent", UmlMetaclass.COMPONENT);
        // 工件
        STANDARD_STEREOTYPES.put("executable", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("file", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("document", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("source", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("library", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("table", UmlMetaclass.ARTIFACT);
        STANDARD_STEREOTYPES.put("script", UmlMetaclass.ARTIFACT);
        // L3 —— 行为特征与依赖
        STANDARD_STEREOTYPES.put("create", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("destroy", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("call", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("send", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("receive", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("instantiate", UmlMetaclass.OPERATION);
        STANDARD_STEREOTYPES.put("trace", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("refine", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("derive", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("realize", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("use", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("access", UmlMetaclass.DEPENDENCY);
        STANDARD_STEREOTYPES.put("friend", UmlMetaclass.DEPENDENCY);
    }

    private ExtensionLibrary() {
    }

    /**
     * SysML 1.6 的其余构造型（构造型名 → 扩展的元类）。
     *
     * <p>这些构造型在本产品里没有独立的 {@link ElementType}（它们标注的是「已有元素的某种角色」，
     * 例如 «proxyPort» 标在 Port 上、«rate» 标在流属性上），但仍必须作为剖面里的
     * Stereotype 元素存在——否则用户在扩展包里查不到、也无法把构造型引用到元素上。</p>
     */
    private static final Map<String, UmlMetaclass> SYSML_EXTRA_STEREOTYPES = new LinkedHashMap<>();

    static {
        // 需求 / 追溯
        SYSML_EXTRA_STEREOTYPES.put("conform", UmlMetaclass.SYSML_CONFORM);
        SYSML_EXTRA_STEREOTYPES.put("expose", UmlMetaclass.SYSML_EXPOSE);
        SYSML_EXTRA_STEREOTYPES.put("stakeholder", UmlMetaclass.SYSML_STAKEHOLDER);
        SYSML_EXTRA_STEREOTYPES.put("elementGroup", UmlMetaclass.SYSML_ELEMENT_GROUP);
        SYSML_EXTRA_STEREOTYPES.put("elementPropertyPath", UmlMetaclass.SYSML_ELEMENT_PROPERTY_PATH);
        SYSML_EXTRA_STEREOTYPES.put("directedRelationshipPropertyPath",
                UmlMetaclass.SYSML_DIRECTED_RELATIONSHIP_PROPERTY_PATH);
        // 属性 / 端口
        SYSML_EXTRA_STEREOTYPES.put("adjunctProperty", UmlMetaclass.SYSML_ADJUNCT_PROPERTY);
        SYSML_EXTRA_STEREOTYPES.put("participantProperty", UmlMetaclass.SYSML_PARTICIPANT_PROPERTY);
        SYSML_EXTRA_STEREOTYPES.put("connectorProperty", UmlMetaclass.SYSML_CONNECTOR_PROPERTY);
        SYSML_EXTRA_STEREOTYPES.put("distributedProperty", UmlMetaclass.SYSML_DISTRIBUTED_PROPERTY);
        SYSML_EXTRA_STEREOTYPES.put("boundReference", UmlMetaclass.SYSML_BOUND_REFERENCE);
        SYSML_EXTRA_STEREOTYPES.put("classifierBehaviorProperty",
                UmlMetaclass.SYSML_CLASSIFIER_BEHAVIOR_PROPERTY);
        SYSML_EXTRA_STEREOTYPES.put("optional", UmlMetaclass.SYSML_OPTIONAL);
        SYSML_EXTRA_STEREOTYPES.put("nestedConnectorEnd", UmlMetaclass.SYSML_NESTED_CONNECTOR_END);
        SYSML_EXTRA_STEREOTYPES.put("proxyPort", UmlMetaclass.SYSML_PROXY_PORT);
        SYSML_EXTRA_STEREOTYPES.put("fullPort", UmlMetaclass.SYSML_FULL_PORT);
        SYSML_EXTRA_STEREOTYPES.put("interfaceBlock", UmlMetaclass.SYSML_INTERFACE_BLOCK);
        SYSML_EXTRA_STEREOTYPES.put("propertySpecificType", UmlMetaclass.SYSML_PROPERTY_SPECIFIC_TYPE);
        SYSML_EXTRA_STEREOTYPES.put("endPathMultiplicity", UmlMetaclass.SYSML_END_PATH_MULTIPLICITY);
        SYSML_EXTRA_STEREOTYPES.put("invocationOnNestedPortAction",
                UmlMetaclass.SYSML_INVOCATION_ON_NESTED_PORT_ACTION);
        SYSML_EXTRA_STEREOTYPES.put("triggerOnNestedPort", UmlMetaclass.SYSML_TRIGGER_ON_NESTED_PORT);
        // 量化 / 流特性
        SYSML_EXTRA_STEREOTYPES.put("rate", UmlMetaclass.SYSML_RATE);
        SYSML_EXTRA_STEREOTYPES.put("continuous", UmlMetaclass.SYSML_CONTINUOUS);
        SYSML_EXTRA_STEREOTYPES.put("discrete", UmlMetaclass.SYSML_DISCRETE);
        SYSML_EXTRA_STEREOTYPES.put("noBuffer", UmlMetaclass.SYSML_NO_BUFFER);
        SYSML_EXTRA_STEREOTYPES.put("overwrite", UmlMetaclass.SYSML_OVERWRITE);
        SYSML_EXTRA_STEREOTYPES.put("probability", UmlMetaclass.SYSML_PROBABILITY);
        // 行为
        SYSML_EXTRA_STEREOTYPES.put("controlOperator", UmlMetaclass.SYSML_CONTROL_OPERATOR);
        SYSML_EXTRA_STEREOTYPES.put("changeStructuralFeatureEvent",
                UmlMetaclass.SYSML_CHANGE_STRUCTURAL_FEATURE_EVENT);
        SYSML_EXTRA_STEREOTYPES.put("acceptChangeStructuralFeatureEventAction",
                UmlMetaclass.SYSML_ACCEPT_CHANGE_STRUCTURAL_FEATURE_EVENT_ACTION);
        SYSML_EXTRA_STEREOTYPES.put("allocateActivityPartition",
                UmlMetaclass.SYSML_ALLOCATE_ACTIVITY_PARTITION);
        SYSML_EXTRA_STEREOTYPES.put("bindingConnector", UmlMetaclass.SYSML_BINDING_CONNECTOR);
    }

    /** SysML 剖面里「没有独立元素类型」的构造型数量，测试与文档用它核对覆盖度。 */
    public static int sysmlExtraStereotypeCount() {
        return SYSML_EXTRA_STEREOTYPES.size();
    }

    /** 元类元素的 id：由元类枚举名派生，全局唯一且可读。 */
    public static String metaclassId(UmlMetaclass metaclass) {
        return METACLASS_ID_PREFIX + metaclass.name();
    }

    /** 构造型元素的 id：由构造型名派生。 */
    public static String stereotypeId(String stereotypeName) {
        return STEREOTYPE_ID_PREFIX + stereotypeName;
    }

    /** 原始类型元素 id。 */
    public static String primitiveId(String name) {
        return "prim-" + name;
    }

    /** SysML 值类型元素 id。 */
    public static String valueTypeId(String name) {
        return "val-" + name;
    }

    /** 单位 / 量纲元素 id。 */
    public static String unitId(String name) {
        return "unit-" + name;
    }

    /** 量纲元素 id。 */
    public static String dimensionId(String name) {
        return "dim-" + name;
    }

    /** 标准构造型元素 id。 */
    public static String standardStereotypeId(String name) {
        return "std-" + name;
    }

    /** 某个元素类型默认构造型对应的元类（构造型特化的目标）。 */
    public static UmlMetaclass metaclassOfStereotype(ElementType type) {
        return PropertyCatalog.rootMetaclass(type);
    }

    /**
     * 生成通用扩展包与标准库的完整元素清单。
     *
     * <p>返回顺序即创建顺序：父包在前、子元素在后——批量命令按顺序校验引用，
     * 单位引用量纲、枚举字面量引用枚举，都必须先出现。</p>
     *
     * @param rootOwnerId 项目根元素 id（扩展包挂在它下面）
     */
    public static List<Definition> definitions(String rootOwnerId) {
        List<Definition> result = new ArrayList<>();

        // 六个顶层扩展包 / 库
        result.add(definition(SYSML_PROFILE_ID, "PROFILE", "SysML 扩展包", rootOwnerId,
                "SysML 1.6 通用扩展包：元类与构造型随项目提供。", List.of("profile"), Map.of()));
        result.add(definition(UML_PROFILE_ID, "PROFILE", "UML 扩展包", rootOwnerId,
                "UML 2.5.1 通用扩展包：元类与构造型随项目提供。", List.of("profile"), Map.of()));
        result.add(definition(PRIMITIVE_LIBRARY_ID, "MODEL_LIBRARY", "UML 原始类型库", rootOwnerId,
                "UML 2.5.1 原始类型：值属性的类型直接指向这里。", List.of("modelLibrary"), Map.of()));
        result.add(definition(VALUE_LIBRARY_ID, "MODEL_LIBRARY", "SysML 值类型库", rootOwnerId,
                "SysML 1.6 值类型与规范枚举：值属性按 SysML 规范使用这里的值类型。",
                List.of("modelLibrary"), Map.of()));
        result.add(definition(UNITS_LIBRARY_ID, "MODEL_LIBRARY", "单位与量纲库", rootOwnerId,
                "ISO 80000 / QUDV 基本单位、基本量纲与导出单位。", List.of("modelLibrary"), Map.of()));
        result.add(definition(STANDARD_PROFILE_ID, "PROFILE", "UML 标准构造型库", rootOwnerId,
                "UML 2.5.1 StandardProfile L2 / L3 构造型。", List.of("profile"), Map.of()));

        // 两个 Profile 下的「元类 / 构造型」子包
        result.add(definition(SYSML_PROFILE_ID + METACLASS_PACKAGE_SUFFIX, "PACKAGE", "元类",
                SYSML_PROFILE_ID, "SysML 1.6 元类清单。", List.of("package"), Map.of()));
        result.add(definition(SYSML_PROFILE_ID + STEREOTYPE_PACKAGE_SUFFIX, "PACKAGE", "构造型",
                SYSML_PROFILE_ID, "SysML 1.6 构造型清单。", List.of("package"), Map.of()));
        result.add(definition(UML_PROFILE_ID + METACLASS_PACKAGE_SUFFIX, "PACKAGE", "元类",
                UML_PROFILE_ID, "UML 2.5.1 元类清单。", List.of("package"), Map.of()));
        result.add(definition(UML_PROFILE_ID + STEREOTYPE_PACKAGE_SUFFIX, "PACKAGE", "构造型",
                UML_PROFILE_ID, "UML 2.5.1 构造型清单。", List.of("package"), Map.of()));

        // 元类：SysML 元类在 SysML 扩展包，UML 元类在 UML 扩展包
        for (UmlMetaclass metaclass : UmlMetaclass.values()) {
            if (metaclass == UmlMetaclass.SCOFEN_CORE || metaclass == UmlMetaclass.SCOFEN_RELATION) {
                // 实现层系统属性不是规范元类，不进扩展包。
                continue;
            }
            boolean sysml = isSysML(metaclass);
            String owner = (sysml ? SYSML_PROFILE_ID : UML_PROFILE_ID) + METACLASS_PACKAGE_SUFFIX;
            Map<String, Object> properties = new LinkedHashMap<>();
            List<UmlMetaclass> parents = metaclass.parents();
            if (!parents.isEmpty()) {
                // 元类的继承链用「扩展的元类」表达：SysML 元类指向 UML 扩展包里的父元类。
                properties.put("extendsMetaclass", metaclassId(parents.get(0)));
            }
            // 抽象元类不能实例化：标出来，界面上与可建元类区分。
            properties.put("isAbstract", metaclass.abstractMetaclass());
            result.add(definition(metaclassId(metaclass), "METACLASS", metaclass.umlName(), owner,
                    metaclass.spec(), List.of(), properties));
        }

        // 构造型：只收规范里真实存在的构造型，界面关键词不再冒充构造型
        for (ElementType type : ElementType.values()) {
            if (!type.specStereotype()) {
                continue;
            }
            String stereotype = type.stereotype();
            boolean umlSide = UML_SIDE_STEREOTYPES.contains(type);
            String owner = (umlSide ? UML_PROFILE_ID : SYSML_PROFILE_ID) + STEREOTYPE_PACKAGE_SUFFIX;
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("extendsMetaclass", metaclassId(metaclassOfStereotype(type)));
            result.add(definition(stereotypeId(stereotype), "STEREOTYPE", stereotype, owner,
                    type.label() + " 的默认构造型（" + type.umlName() + "）。",
                    List.of("stereotype"), properties));
        }

        // SysML 剖面补全：没有独立元素类型的构造型（«proxyPort» «rate» «conform» …）
        String sysmlStereotypeOwner = SYSML_PROFILE_ID + STEREOTYPE_PACKAGE_SUFFIX;
        java.util.Set<String> stereotypeIds = new java.util.HashSet<>();
        for (Definition existing : result) {
            if ("STEREOTYPE".equals(existing.type())) {
                stereotypeIds.add(existing.id());
            }
        }
        for (Map.Entry<String, UmlMetaclass> entry : SYSML_EXTRA_STEREOTYPES.entrySet()) {
            String name = entry.getKey();
            if (!stereotypeIds.add(stereotypeId(name))) {
                continue;
            }
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("extendsMetaclass", metaclassId(entry.getValue()));
            result.add(definition(stereotypeId(name), "STEREOTYPE", name, sysmlStereotypeOwner,
                    "SysML 1.6 构造型 «" + name + "»，扩展自 " + entry.getValue().umlName() + "。",
                    List.of("stereotype"), properties));
        }

        // UML 原始类型库
        for (String name : PRIMITIVE_TYPES) {
            result.add(definition(primitiveId(name), "PRIMITIVE_TYPE", name, PRIMITIVE_LIBRARY_ID,
                    "UML 2.5.1 原始类型 " + name + "。", List.of(), Map.of()));
        }

        // SysML 值类型库：值类型 + 规范枚举
        for (String name : SYSML_VALUE_TYPES) {
            result.add(definition(valueTypeId(name), "VALUE_TYPE", name, VALUE_LIBRARY_ID,
                    "SysML 1.6 值类型 " + name + "。", List.of("valueType"), Map.of()));
        }
        for (Map.Entry<String, List<String>> entry : SYSML_ENUMERATIONS.entrySet()) {
            String enumName = entry.getKey();
            result.add(definition(valueTypeId(enumName), "ENUMERATION", enumName, VALUE_LIBRARY_ID,
                    "SysML 1.6 枚举类型 " + enumName + "。", List.of(), Map.of()));
            for (String literal : entry.getValue()) {
                result.add(definition(valueTypeId(enumName) + "-" + literal,
                        "ENUMERATION_LITERAL", literal, valueTypeId(enumName),
                        "枚举字面量 " + literal + "。", List.of(), Map.of()));
            }
        }

        // 单位与量纲库：量纲先建，单位用「量纲」属性指向它
        for (Map.Entry<String, String> entry : BASE_DIMENSIONS.entrySet()) {
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("symbol", entry.getKey());
            result.add(definition(dimensionId(entry.getKey()), "VALUE_TYPE", entry.getValue(),
                    UNITS_LIBRARY_ID, "ISO 80000 基本量纲 " + entry.getKey() + "。",
                    List.of("dimension"), properties));
        }
        addUnits(result, BASE_UNITS, "ISO 80000 基本单位 ");
        addUnits(result, DERIVED_UNITS, "ISO 80000 导出单位 ");

        // UML 标准构造型库
        for (Map.Entry<String, UmlMetaclass> entry : STANDARD_STEREOTYPES.entrySet()) {
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("extendsMetaclass", metaclassId(entry.getValue()));
            result.add(definition(standardStereotypeId(entry.getKey()), "STEREOTYPE", entry.getKey(),
                    STANDARD_PROFILE_ID,
                    "UML 2.5.1 StandardProfile 构造型 «" + entry.getKey() + "»。",
                    List.of("stereotype"), properties));
        }

        return List.copyOf(result);
    }

    private static void addUnits(List<Definition> result, Map<String, String[]> units, String docPrefix) {
        for (Map.Entry<String, String[]> entry : units.entrySet()) {
            String[] meta = entry.getValue();
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("symbol", meta[1]);
            properties.put("dimension", dimensionId(meta[2]));
            result.add(definition(unitId(entry.getKey()), "VALUE_TYPE", meta[0], UNITS_LIBRARY_ID,
                    docPrefix + entry.getKey() + "（" + meta[1] + "）。", List.of("unit"), properties));
        }
    }

    /**
     * 扩展包子树的元素 id 集合（六个顶层库 + 它们的所有后代）。
     *
     * <p>导入时用它区分「系统提供的公共内容」与「用户自己的模型」：
     * 扩展包随每个项目提供，不随模型交换，导入时应当原样保留。</p>
     *
     * @param elements 当前模型的元素集合
     */
    public static Set<String> subtreeIds(Collection<ModelElement> elements) {
        Set<String> result = new LinkedHashSet<>(ROOT_IDS);
        boolean changed = true;
        while (changed) {
            changed = false;
            for (ModelElement element : elements) {
                if (result.contains(element.ownerId()) && result.add(element.id())) {
                    changed = true;
                }
            }
        }
        return result;
    }

    /** 扩展包元素总数，供测试与界面提示使用。 */
    public static int size() {
        return definitions("model-root").size();
    }

    /** UML StandardProfile（L2 / L3）构造型数量，供测试与界面提示使用。 */
    public static int standardStereotypeCount() {
        return STANDARD_STEREOTYPES.size();
    }

    /** 是否为扩展包 / 库的顶层根（整包不可删除）。 */
    public static boolean isRoot(String id) {
        return ROOT_IDS.contains(id);
    }

    /**
     * 通用扩展包清单：供界面识别「哪些是系统提供的公共内容」。
     *
     * <p>模型树默认把扩展包折叠起来——否则几百个元类会淹没用户自己的模型；
     * 需要查规范时再展开。</p>
     */
    public record PackageInfo(String id,
                              String parentId,
                              String kind,
                              String name,
                              String label,
                              String labelEn,
                              int metaclassCount,
                              int stereotypeCount) {
    }

    /**
     * 通用扩展包的清单：六个顶层库 + 两个 Profile 下的「元类 / 构造型」子包。
     */
    public static List<PackageInfo> packages() {
        List<PackageInfo> result = new ArrayList<>();
        for (String id : ROOT_IDS) {
            result.add(new PackageInfo(id, null, kindOf(id), nameOf(id), nameOf(id), labelEnOf(id),
                    countUnder(id, "METACLASS"), countUnder(id, "STEREOTYPE")));
            if (SYSML_PROFILE_ID.equals(id) || UML_PROFILE_ID.equals(id)) {
                for (String suffix : List.of(METACLASS_PACKAGE_SUFFIX, STEREOTYPE_PACKAGE_SUFFIX)) {
                    String childId = id + suffix;
                    boolean metaclasses = METACLASS_PACKAGE_SUFFIX.equals(suffix);
                    result.add(new PackageInfo(childId, id, "PACKAGE",
                            metaclasses ? "元类" : "构造型",
                            metaclasses ? "元类" : "构造型",
                            metaclasses ? "Metaclasses" : "Stereotypes",
                            metaclasses ? countUnder(childId, "METACLASS") : 0,
                            metaclasses ? 0 : countUnder(childId, "STEREOTYPE")));
                }
            }
        }
        return List.copyOf(result);
    }

    private static String kindOf(String id) {
        return switch (id) {
            case PRIMITIVE_LIBRARY_ID, VALUE_LIBRARY_ID, UNITS_LIBRARY_ID -> "MODEL_LIBRARY";
            default -> "PROFILE";
        };
    }

    private static String nameOf(String id) {
        return switch (id) {
            case SYSML_PROFILE_ID -> "SysML 扩展包";
            case UML_PROFILE_ID -> "UML 扩展包";
            case PRIMITIVE_LIBRARY_ID -> "UML 原始类型库";
            case VALUE_LIBRARY_ID -> "SysML 值类型库";
            case UNITS_LIBRARY_ID -> "单位与量纲库";
            case STANDARD_PROFILE_ID -> "UML 标准构造型库";
            default -> id;
        };
    }

    private static String labelEnOf(String id) {
        return switch (id) {
            case SYSML_PROFILE_ID -> "SysML Extension Package";
            case UML_PROFILE_ID -> "UML Extension Package";
            case PRIMITIVE_LIBRARY_ID -> "UML Primitive Types";
            case VALUE_LIBRARY_ID -> "SysML Value Types";
            case UNITS_LIBRARY_ID -> "Units and Dimensions";
            case STANDARD_PROFILE_ID -> "UML Standard Profile";
            default -> id;
        };
    }

    /** 直接挂在某个包下的某类元素数量。 */
    private static int countUnder(String ownerId, String type) {
        int count = 0;
        for (Definition definition : definitions("model-root")) {
            if (ownerId.equals(definition.ownerId()) && type.equals(definition.type())) {
                count++;
            }
        }
        return count;
    }

    /** 元类是否属于 SysML 1.6 规范层。 */
    public static boolean isSysML(UmlMetaclass metaclass) {
        return metaclass.name().startsWith("SYSML_");
    }

    private static Definition definition(String id, String type, String name, String ownerId,
                                         String documentation, List<String> stereotypes,
                                         Map<String, Object> properties) {
        return new Definition(id, type, name, ownerId, documentation,
                Collections.unmodifiableList(new ArrayList<>(stereotypes)),
                Collections.unmodifiableMap(new LinkedHashMap<>(properties)));
    }
}
