package com.scofen.model.metamodel;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * UML 2.5.1 / SysML 1.6 元属性全集（表驱动）。
 *
 * <p>每个 {@link ElementType} 映射到一组元类，属性按「具体元类 → 父元类」继承链展开；
 * 同名属性由更具体的元类覆盖。属性分三档：{@code STANDARD ⊂ EXPERT ⊂ ALL}，
 * 其中 {@code DERIVED} 级别即规范里的计算属性 / 派生属性（UML 中以 {@code /} 前缀标注），
 * 一律 {@code editable=false}，服务端拒绝写入。</p>
 *
 * <p>规范出处随元类下发，界面可逐条显示；键名用规范原名，值统一存于
 * {@link ModelElement#properties()}，核心字段（name/documentation/stereotypes 等）由 Repository 映射。</p>
 */
public final class PropertyCatalog {

    /** 属性展示档位：标准只显示常用项，专家增加规范扩展项，全部含派生只读量。 */
    public enum View { STANDARD, EXPERT, ALL }

    /** 属性本身的级别；DERIVED 即计算/派生属性，只在「全部」档出现且不可编辑。 */
    public enum Level { STANDARD, EXPERT, DERIVED }

    public enum ValueKind {
        STRING, TEXT, BOOLEAN, INTEGER, REAL, UNLIMITED_NATURAL,
        ENUM, REFERENCE, REFERENCE_LIST, STRING_LIST
    }

    public record PropertySpec(
            String key,
            String umlName,
            String label,
            String metaclass,
            String metaclassName,
            String metaclassLabel,
            String spec,
            ValueKind kind,
            Level level,
            boolean computed,
            List<String> options,
            String defaultValue) {

        /** 计算属性与派生属性不可修改；其余均为可编辑的模型属性。 */
        public boolean editable() {
            return !computed && level != Level.DERIVED;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("key", key);
            row.put("umlName", umlName);
            row.put("label", label);
            row.put("metaclass", metaclass);
            row.put("metaclassName", metaclassName);
            row.put("metaclassLabel", metaclassLabel);
            row.put("spec", spec);
            row.put("kind", kind.name());
            row.put("level", level.name());
            row.put("computed", computed);
            row.put("editable", editable());
            row.put("options", options);
            row.put("defaultValue", defaultValue);
            return row;
        }
    }

    private record Spec(String key, String umlName, String label, ValueKind kind, Level level,
                        boolean computed, List<String> options, String defaultValue) {
    }

    private static final ValueKind STR = ValueKind.STRING;
    private static final ValueKind TXT = ValueKind.TEXT;
    private static final ValueKind BOOL = ValueKind.BOOLEAN;
    private static final ValueKind INT = ValueKind.INTEGER;
    private static final ValueKind REAL = ValueKind.REAL;
    private static final ValueKind UNL = ValueKind.UNLIMITED_NATURAL;
    private static final ValueKind REF = ValueKind.REFERENCE;
    private static final ValueKind REFS = ValueKind.REFERENCE_LIST;
    private static final ValueKind STRS = ValueKind.STRING_LIST;
    private static final Level STD = Level.STANDARD;
    private static final Level EXP = Level.EXPERT;

    private static final Map<UmlMetaclass, List<PropertySpec>> BY_METACLASS = new EnumMap<>(UmlMetaclass.class);
    private static final Map<ElementType, List<UmlMetaclass>> ROOTS = new EnumMap<>(ElementType.class);
    /**
     * 关系类型的元类链（显式声明，具体元类在前）。
     * 关系的父类链常带出与关系语义无关的属性（如 Association → Classifier 的抽象性），
     * 因此这里只取对关系有意义的元类，再由 {@link UmlMetaclass#SCOFEN_RELATION} 补齐系统属性。
     */
    private static final Map<RelationshipType, List<UmlMetaclass>> RELATION_CHAINS =
            new EnumMap<>(RelationshipType.class);

    static {
        /* ── UML 2.5.1 基础层 ── */
        mc(UmlMetaclass.ELEMENT,
                s("ownedComment", "拥有的注释", REFS, EXP),
                s("appliedStereotype", "应用的构造型", REFS, EXP),
                d("ownedElement", "拥有的元素（派生）", REFS),
                d("owner", "所有者（派生）", REF));
        mc(UmlMetaclass.RELATIONSHIP,
                d("relatedElement", "相关元素（派生）", REFS));
        mc(UmlMetaclass.DIRECTED_RELATIONSHIP,
                s("source", "源", REFS, STD),
                s("target", "目标", REFS, STD));
        mc(UmlMetaclass.NAMED_ELEMENT,
                s("name", "名称", STR, STD),
                e("visibility", "可见性", STD, "public", "private", "protected", "package"),
                s("nameExpression", "名称表达式", REF, EXP),
                d("qualifiedName", "限定名（派生）", STR),
                d("namespace", "命名空间（派生）", REF),
                d("clientDependency", "客户依赖（派生）", REFS));
        mc(UmlMetaclass.REDEFINABLE_ELEMENT,
                s("isLeaf", "是否为叶", BOOL, STD),
                d("redefinedElement", "被重定义元素（派生）", REFS),
                d("redefinitionContext", "重定义上下文（派生）", REFS));
        mc(UmlMetaclass.NAMESPACE,
                s("ownedRule", "拥有的约束", REFS, EXP),
                s("elementImport", "元素导入", REFS, EXP),
                s("packageImport", "包导入", REFS, EXP),
                d("member", "成员（派生）", REFS),
                d("ownedMember", "拥有的成员（派生）", REFS),
                d("importedMember", "导入的成员（派生）", REFS));
        mc(UmlMetaclass.PACKAGEABLE_ELEMENT,
                e("visibility", "可见性（重定义）", EXP, "public", "private", "protected", "package"));
        mc(UmlMetaclass.TYPE,
                d("package", "所属包（派生）", REF));
        mc(UmlMetaclass.TEMPLATEABLE_ELEMENT,
                s("ownedTemplateSignature", "拥有的模板签名", REF, EXP),
                s("templateParameter", "模板参数", REF, EXP));
        mc(UmlMetaclass.PARAMETERABLE_ELEMENT,
                s("owningTemplateParameter", "拥有模板参数", REF, EXP));
        mc(UmlMetaclass.TYPED_ELEMENT,
                s("type", "类型", REF, STD));
        mc(UmlMetaclass.MULTIPLICITY_ELEMENT,
                s("isOrdered", "是否有序", BOOL, STD),
                s("isUnique", "是否唯一", BOOL, STD),
                s("lowerValue", "下界值", STR, EXP),
                s("upperValue", "上界值", STR, EXP),
                d("lower", "下界（派生）", INT),
                d("upper", "上界（派生）", STR));
        mc(UmlMetaclass.FEATURE,
                s("isStatic", "是否静态", BOOL, STD),
                d("featuringClassifier", "特征化分类器（派生）", REF));
        mc(UmlMetaclass.STRUCTURAL_FEATURE,
                s("isReadOnly", "是否只读", BOOL, STD));
        mc(UmlMetaclass.BEHAVIORAL_FEATURE,
                e("concurrency", "并发性", EXP, "sequential", "guarded", "concurrent"),
                s("isAbstract", "是否抽象", BOOL, STD),
                s("method", "方法", REFS, EXP),
                s("ownedParameterSet", "拥有的参数集", REFS, EXP),
                s("raisedException", "抛出的异常", REFS, EXP));
        mc(UmlMetaclass.CONNECTABLE_ELEMENT,
                d("end", "连接器端（派生）", REFS));
        mc(UmlMetaclass.DEPLOYMENT_TARGET,
                s("deployment", "部署", REFS, EXP));
        mc(UmlMetaclass.CLASSIFIER,
                s("isAbstract", "是否抽象", BOOL, STD),
                s("isFinalSpecialization", "是否最终特化", BOOL, EXP),
                s("generalization", "泛化", REFS, EXP),
                s("powertypeExtent", "幂类型范围", REFS, EXP),
                s("redefinedClassifier", "被重定义分类器", REFS, EXP),
                s("representation", "表示", REF, EXP),
                s("substitution", "替换", REFS, EXP),
                s("useCase", "用例", REFS, EXP),
                s("collaborationUse", "协作使用", REFS, EXP),
                s("ownedUseCase", "拥有的用例", REFS, EXP),
                d("feature", "特征（派生）", REFS),
                d("inheritedMember", "继承成员（派生）", REFS),
                d("generalizationOf", "被泛化引用（派生）", REFS));
        mc(UmlMetaclass.STRUCTURED_CLASSIFIER,
                s("ownedAttribute", "拥有的属性", REFS, EXP),
                s("ownedConnector", "拥有的连接器", REFS, EXP),
                d("part", "部件（派生）", REFS),
                d("role", "角色（派生）", REFS));
        mc(UmlMetaclass.ENCAPSULATED_CLASSIFIER,
                s("ownedPort", "拥有的端口", REFS, EXP));
        mc(UmlMetaclass.BEHAVIORED_CLASSIFIER,
                s("interfaceRealization", "接口实现", REFS, EXP),
                s("ownedBehavior", "拥有的行为", REFS, EXP),
                s("classifierBehavior", "分类器行为", REF, EXP));
        mc(UmlMetaclass.CLASS,
                s("isActive", "是否活动类", BOOL, STD),
                s("ownedAttribute", "拥有的属性", REFS, STD),
                s("ownedOperation", "拥有的操作", REFS, STD),
                s("nestedClassifier", "嵌套分类器", REFS, EXP),
                s("ownedReception", "拥有的接收", REFS, EXP),
                d("superClass", "超类（派生）", REFS),
                d("extension", "扩展（派生）", REFS));
        mc(UmlMetaclass.DATA_TYPE,
                s("ownedAttribute", "拥有的属性", REFS, STD),
                s("ownedOperation", "拥有的操作", REFS, STD));
        mc(UmlMetaclass.PRIMITIVE_TYPE);
        mc(UmlMetaclass.ENUMERATION,
                s("ownedLiteral", "拥有的枚举字面量", REFS, STD));
        mc(UmlMetaclass.INSTANCE_SPECIFICATION,
                s("classifier", "分类器", REFS, STD),
                s("slot", "槽", REFS, EXP),
                s("specification", "规格", REF, EXP));
        mc(UmlMetaclass.ENUMERATION_LITERAL,
                d("enumeration", "所属枚举（派生）", REF));
        mc(UmlMetaclass.SLOT,
                s("definingFeature", "定义特征", REF, STD),
                s("value", "值", REFS, STD),
                d("owningInstance", "拥有实例（派生）", REF));
        mc(UmlMetaclass.VALUE_SPECIFICATION);
        mc(UmlMetaclass.LITERAL_SPECIFICATION);
        mc(UmlMetaclass.LITERAL_STRING,
                s("value", "字符串值", STR, STD));
        mc(UmlMetaclass.LITERAL_INTEGER,
                s("value", "整数值", INT, STD));
        mc(UmlMetaclass.LITERAL_BOOLEAN,
                s("value", "布尔值", BOOL, STD));
        mc(UmlMetaclass.LITERAL_REAL,
                s("value", "实数值", REAL, STD));
        mc(UmlMetaclass.LITERAL_UNLIMITED_NATURAL,
                s("value", "无限自然数值", UNL, STD));
        mc(UmlMetaclass.LITERAL_NULL);
        mc(UmlMetaclass.EXPRESSION,
                s("symbol", "符号", STR, STD),
                s("operand", "操作数", REFS, EXP));
        mc(UmlMetaclass.STRING_EXPRESSION,
                s("subExpression", "子表达式", REFS, EXP),
                d("owningExpression", "拥有表达式（派生）", REF));
        mc(UmlMetaclass.OPAQUE_EXPRESSION,
                s("body", "表达式体", TXT, STD),
                s("language", "语言", STRS, STD),
                s("result", "结果", REF, EXP));
        mc(UmlMetaclass.INSTANCE_VALUE,
                s("instance", "实例", REF, STD));
        mc(UmlMetaclass.ELEMENT_VALUE,
                s("element", "元素", REF, STD));
        mc(UmlMetaclass.TIME_EXPRESSION,
                s("expr", "时间表达式", REF, EXP),
                s("observation", "观察", REFS, EXP));
        mc(UmlMetaclass.DURATION,
                s("expr", "持续时间表达式", REF, EXP),
                s("observation", "观察", REFS, EXP));
        mc(UmlMetaclass.INTERVAL,
                s("min", "最小值", REF, EXP),
                s("max", "最大值", REF, EXP));
        mc(UmlMetaclass.PROPERTY,
                e("aggregation", "聚合", STD, "none", "shared", "composite"),
                s("isDerived", "是否派生", BOOL, STD),
                s("isDerivedUnion", "是否派生联合", BOOL, EXP),
                s("isID", "是否标识", BOOL, EXP),
                s("isReadOnly", "是否只读", BOOL, STD),
                s("defaultValue", "默认值", STR, STD),
                s("association", "关联", REF, EXP),
                s("qualifier", "限定符", REFS, EXP),
                s("datatype", "数据类型", REF, EXP),
                s("redefinedProperty", "被重定义属性", REFS, EXP),
                s("subsettedProperty", "被子集化属性", REFS, EXP),
                d("owningAssociation", "拥有关联（派生）", REF),
                d("opposite", "对端（派生）", REF),
                d("associationEnd", "关联端（派生）", REF));
        mc(UmlMetaclass.PORT,
                s("isBehavior", "是否行为端口", BOOL, STD),
                s("isService", "是否服务端口", BOOL, STD),
                s("required", "所需接口", REFS, EXP),
                s("provided", "提供接口", REFS, EXP),
                d("end", "连接器端（派生）", REFS));
        mc(UmlMetaclass.OPERATION,
                s("isQuery", "是否查询", BOOL, STD),
                s("ownedParameter", "拥有的参数", REFS, STD),
                s("raisedException", "抛出的异常", REFS, EXP),
                s("redefinedOperation", "被重定义操作", REFS, EXP),
                s("precondition", "前置条件", REFS, EXP),
                s("postcondition", "后置条件", REFS, EXP),
                s("bodyCondition", "体条件", REF, EXP),
                s("lowerValue", "返回值下界", STR, EXP),
                s("upperValue", "返回值上界", STR, EXP),
                d("class", "所属类（派生）", REF),
                d("package", "所属包（派生）", REF));
        mc(UmlMetaclass.PARAMETER,
                e("direction", "方向", STD, "in", "inout", "out", "return"),
                e("effect", "效果", EXP, "create", "read", "update", "delete"),
                s("defaultValue", "默认值", STR, STD),
                s("isException", "是否异常", BOOL, EXP),
                s("isStream", "是否流", BOOL, EXP),
                d("operation", "所属操作（派生）", REF));
        mc(UmlMetaclass.PARAMETER_SET,
                s("parameter", "参数", REFS, STD),
                s("condition", "条件", TXT, EXP));
        mc(UmlMetaclass.RECEPTION,
                s("signal", "信号", REF, STD));
        mc(UmlMetaclass.SIGNAL,
                s("ownedAttribute", "拥有的属性", REFS, STD));
        mc(UmlMetaclass.INTERFACE,
                s("ownedAttribute", "拥有的属性", REFS, STD),
                s("ownedOperation", "拥有的操作", REFS, STD),
                s("nestedClassifier", "嵌套分类器", REFS, EXP),
                s("redefinedInterface", "被重定义接口", REFS, EXP),
                s("protocol", "协议状态机", REF, EXP));
        mc(UmlMetaclass.COMPONENT,
                s("isIndirectlyInstantiated", "是否间接实例化", BOOL, STD),
                s("packagedElement", "打包元素", REFS, EXP),
                s("realization", "实现", REFS, EXP),
                s("required", "所需接口", REFS, EXP),
                s("provided", "提供接口", REFS, EXP));
        mc(UmlMetaclass.NODE,
                s("nestedNode", "嵌套节点", REFS, EXP));
        mc(UmlMetaclass.ARTIFACT,
                s("fileName", "文件名", STR, STD),
                s("nestedArtifact", "嵌套工件", REFS, EXP),
                s("manifestation", "体现", REFS, EXP),
                s("ownedAttribute", "拥有的属性", REFS, EXP),
                s("ownedOperation", "拥有的操作", REFS, EXP));
        mc(UmlMetaclass.PACKAGE,
                s("URI", "包 URI", STR, STD),
                s("packagedElement", "打包元素", REFS, STD),
                s("nestedPackage", "嵌套包", REFS, EXP),
                s("ownedType", "拥有的类型", REFS, EXP),
                s("packageMerge", "包合并", REFS, EXP),
                s("profileApplication", "剖面应用", REFS, EXP));
        mc(UmlMetaclass.MODEL,
                s("viewpoint", "视点", STR, STD));
        mc(UmlMetaclass.PROFILE,
                s("metaclassReference", "元类引用", REFS, EXP),
                s("metamodelReference", "元模型引用", REFS, EXP),
                s("ownedStereotype", "拥有的构造型", REFS, STD));
        mc(UmlMetaclass.STEREOTYPE,
                s("icon", "图标", REFS, EXP),
                d("profile", "所属剖面（派生）", REF));
        mc(UmlMetaclass.DEPENDENCY,
                s("client", "客户", REFS, STD),
                s("supplier", "供应者", REFS, STD));
        mc(UmlMetaclass.ABSTRACTION,
                s("mapping", "映射", STR, EXP));
        mc(UmlMetaclass.REALIZATION);
        mc(UmlMetaclass.USAGE);
        mc(UmlMetaclass.SUBSTITUTION,
                s("contract", "契约", REF, STD),
                d("substitutingClassifier", "替换分类器（派生）", REF));
        mc(UmlMetaclass.GENERALIZATION,
                s("general", "一般分类器", REF, STD),
                s("specific", "特殊分类器", REF, STD),
                s("isSubstitutable", "是否可替换", BOOL, STD),
                s("generalizationSet", "泛化集", REFS, EXP));
        mc(UmlMetaclass.GENERALIZATION_SET,
                s("isCovering", "是否覆盖", BOOL, EXP),
                s("isDisjoint", "是否互斥", BOOL, EXP),
                s("powertype", "幂类型", REF, EXP),
                s("generalization", "泛化", REFS, EXP));
        mc(UmlMetaclass.ASSOCIATION,
                s("isDerived", "是否派生", BOOL, STD),
                s("memberEnd", "成员端", REFS, STD),
                s("ownedEnd", "拥有的端", REFS, EXP),
                s("navigableOwnedEnd", "可导航拥有端", REFS, EXP));
        mc(UmlMetaclass.EXTENSION,
                s("isRequired", "是否必需", BOOL, EXP),
                d("metaclass", "元类（派生）", REF));
        mc(UmlMetaclass.EXTENSION_END,
                d("type", "扩展端类型（派生）", REF));
        mc(UmlMetaclass.PROFILE_APPLICATION,
                s("isStrict", "是否严格", BOOL, EXP),
                s("appliedProfile", "应用的剖面", REF, STD));
        mc(UmlMetaclass.PACKAGE_IMPORT,
                s("importedPackage", "导入的包", REF, STD));
        mc(UmlMetaclass.ELEMENT_IMPORT,
                s("alias", "别名", STR, STD),
                s("importedElement", "导入的元素", REF, STD));
        mc(UmlMetaclass.PACKAGE_MERGE,
                s("mergedPackage", "被合并的包", REF, STD));
        mc(UmlMetaclass.DEPLOYMENT,
                s("deployedArtifact", "部署的工件", REFS, STD),
                s("location", "位置", REF, EXP),
                s("configuration", "配置", REFS, EXP));
        mc(UmlMetaclass.COMMENT,
                s("body", "注释正文", TXT, STD),
                s("annotatedElement", "被注释元素", REFS, STD));
        mc(UmlMetaclass.CONSTRAINT,
                s("specification", "约束规格", TXT, STD),
                s("constrainedElement", "受约束元素", REFS, STD),
                d("context", "上下文（派生）", REF));
        mc(UmlMetaclass.COLLABORATION,
                s("collaborationRole", "协作角色", REFS, EXP));
        mc(UmlMetaclass.COLLABORATION_USE,
                s("type", "协作类型", REF, STD),
                s("roleBinding", "角色绑定", REFS, EXP));
        mc(UmlMetaclass.CONNECTOR,
                ed("kind", "种类（派生）", "assembly", "delegation"),
                s("end", "端", REFS, STD),
                s("contract", "契约", REFS, EXP),
                s("redefinedConnector", "被重定义连接器", REFS, EXP));
        mc(UmlMetaclass.CONNECTOR_END,
                s("role", "角色", REF, STD),
                s("partWithPort", "带端口部件", REF, EXP),
                d("definingEnd", "定义端（派生）", REF));
        mc(UmlMetaclass.BEHAVIOR,
                s("isReentrant", "是否可重入", BOOL, STD),
                s("ownedParameter", "拥有的参数", REFS, EXP),
                s("ownedParameterSet", "拥有的参数集", REFS, EXP),
                s("specification", "规格", REF, EXP),
                d("context", "上下文（派生）", REF));
        mc(UmlMetaclass.OPAQUE_BEHAVIOR,
                s("body", "行为体", TXT, STD),
                s("language", "语言", STRS, STD));
        mc(UmlMetaclass.FUNCTION_BEHAVIOR);
        mc(UmlMetaclass.ACTIVITY,
                s("isReadOnly", "是否只读", BOOL, EXP),
                s("isSingleExecution", "是否单次执行", BOOL, EXP),
                s("node", "节点", REFS, STD),
                s("edge", "边", REFS, STD),
                s("group", "组", REFS, EXP),
                s("partition", "分区", REFS, EXP),
                s("structuredNode", "结构化节点", REFS, EXP),
                s("variable", "变量", REFS, EXP));
        mc(UmlMetaclass.ACTIVITY_NODE,
                s("incoming", "入边", REFS, EXP),
                s("outgoing", "出边", REFS, EXP),
                s("redefinedNode", "被重定义节点", REFS, EXP),
                s("inPartition", "所在分区", REFS, EXP),
                d("activity", "所属活动（派生）", REF));
        mc(UmlMetaclass.EXECUTABLE_NODE,
                s("handler", "异常处理器", REFS, EXP));
        mc(UmlMetaclass.ACTION,
                s("isLocallyReentrant", "是否本地可重入", BOOL, STD),
                s("localPrecondition", "本地前置条件", REFS, EXP),
                s("localPostcondition", "本地后置条件", REFS, EXP),
                s("input", "输入", REFS, EXP),
                s("output", "输出", REFS, EXP),
                d("context", "上下文（派生）", REF));
        mc(UmlMetaclass.CONTROL_NODE);
        mc(UmlMetaclass.OBJECT_NODE,
                e("ordering", "排序", EXP, "unordered", "ordered", "LIFO", "FIFO"),
                s("isControlType", "是否控制类型", BOOL, EXP),
                s("upperBound", "上界", STR, EXP),
                s("inState", "所处状态", REFS, EXP),
                s("selection", "选择", REF, EXP));
        mc(UmlMetaclass.DATA_STORE_NODE);
        mc(UmlMetaclass.CENTRAL_BUFFER_NODE);
        mc(UmlMetaclass.PIN,
                s("isControl", "是否控制引脚", BOOL, EXP));
        mc(UmlMetaclass.INPUT_PIN);
        mc(UmlMetaclass.OUTPUT_PIN);
        mc(UmlMetaclass.ACTIVITY_EDGE,
                s("guard", "守卫", STR, STD),
                s("weight", "权重", STR, EXP),
                s("source", "源节点", REF, STD),
                s("target", "目标节点", REF, STD),
                s("redefinedEdge", "被重定义边", REFS, EXP),
                d("activity", "所属活动（派生）", REF));
        mc(UmlMetaclass.CONTROL_FLOW);
        mc(UmlMetaclass.OBJECT_FLOW,
                s("isMulticast", "是否多播", BOOL, EXP),
                s("isMultireceive", "是否多接收", BOOL, EXP),
                s("transformation", "转换", REF, EXP),
                s("selection", "选择", REF, EXP));
        mc(UmlMetaclass.ACTIVITY_GROUP,
                s("superGroup", "父组", REF, EXP));
        mc(UmlMetaclass.ACTIVITY_PARTITION,
                s("isDimension", "是否维度", BOOL, STD),
                s("represents", "代表", REF, EXP),
                s("node", "节点", REFS, STD),
                s("subpartition", "子分区", REFS, EXP),
                d("superPartition", "父分区（派生）", REF));
        mc(UmlMetaclass.ACTIVITY_PARAMETER_NODE,
                s("parameter", "参数", REF, STD));
        mc(UmlMetaclass.VARIABLE,
                s("activityScope", "活动作用域", REF, EXP));
        mc(UmlMetaclass.EXCEPTION_HANDLER,
                s("exceptionInputNode", "异常输入节点", REF, EXP),
                s("exceptionType", "异常类型", REFS, EXP),
                s("handlerBody", "处理器体", REF, EXP),
                s("protectedNode", "受保护节点", REFS, EXP));
        mc(UmlMetaclass.INTERACTION_FRAGMENT,
                s("enclosingInteraction", "包围交互", REF, EXP),
                s("enclosingOperand", "包围操作数", REF, EXP),
                s("generalOrdering", "一般排序", REFS, EXP),
                s("covered", "覆盖的生命线", REFS, EXP));
        mc(UmlMetaclass.INTERACTION,
                s("lifeline", "生命线", REFS, STD),
                s("fragment", "片段", REFS, STD),
                s("message", "消息", REFS, STD),
                s("action", "动作", REFS, EXP),
                s("formalGate", "形式门", REFS, EXP));
        mc(UmlMetaclass.OCCURRENCE_SPECIFICATION,
                s("covered", "覆盖的生命线", REF, STD),
                s("toBefore", "之前的发生", REFS, EXP),
                s("toAfter", "之后的发生", REFS, EXP));
        mc(UmlMetaclass.EXECUTION_SPECIFICATION,
                s("start", "开始发生", REF, EXP),
                s("finish", "结束发生", REF, EXP));
        mc(UmlMetaclass.MESSAGE_END,
                d("message", "所属消息（派生）", REF));
        mc(UmlMetaclass.MESSAGE,
                e("messageSort", "消息种类", STD, "synchCall", "asynchCall", "asynchSignal",
                        "createMessage", "deleteMessage", "reply"),
                ed("messageKind", "消息类别（派生）", "complete", "lost", "found", "unknown"),
                s("argument", "实参", REFS, STD),
                s("connector", "连接器", REF, EXP),
                s("signature", "签名", REF, EXP),
                s("sendEvent", "发送事件", REF, EXP),
                s("receiveEvent", "接收事件", REF, EXP),
                d("interaction", "所属交互（派生）", REF));
        mc(UmlMetaclass.MESSAGE_OCCURRENCE_SPECIFICATION);
        mc(UmlMetaclass.LIFELINE,
                s("represents", "代表", REF, STD),
                s("selector", "选择器", STR, EXP),
                s("coveredBy", "被覆盖", REFS, EXP),
                s("decomposition", "分解", REF, EXP),
                d("interaction", "所属交互（派生）", REF));
        mc(UmlMetaclass.COMBINED_FRAGMENT,
                e("interactionOperator", "交互操作符", STD, "alt", "opt", "par", "loop", "critical",
                        "neg", "assert", "strict", "seq", "ignore", "consider", "break"),
                s("operand", "操作数", REFS, STD),
                s("cfragmentGate", "门", REFS, EXP));
        mc(UmlMetaclass.INTERACTION_OPERAND,
                s("guard", "守卫", STR, STD),
                s("fragment", "片段", REFS, EXP));
        mc(UmlMetaclass.INTERACTION_USE,
                s("refersTo", "引用的交互", REF, STD),
                s("returnValue", "返回值", REF, EXP),
                s("returnValueRecipient", "返回值接收者", REF, EXP),
                s("actualGate", "实际门", REFS, EXP),
                s("argument", "实参", REFS, EXP));
        mc(UmlMetaclass.STATE_INVARIANT,
                s("invariant", "不变式", TXT, STD));
        mc(UmlMetaclass.GATE,
                d("isActual", "是否实际门（派生）", BOOL));
        mc(UmlMetaclass.GENERAL_ORDERING,
                s("before", "先于", REF, STD),
                s("after", "后于", REF, STD));
        mc(UmlMetaclass.STATE_MACHINE,
                s("region", "区域", REFS, STD),
                s("connectionPoint", "连接点", REFS, EXP),
                s("extendedStateMachine", "被扩展状态机", REFS, EXP),
                s("submachineState", "子机状态", REFS, EXP));
        mc(UmlMetaclass.REGION,
                s("subvertex", "子顶点", REFS, STD),
                s("transition", "转换", REFS, STD),
                s("extendedRegion", "被扩展区域", REF, EXP),
                d("stateMachine", "所属状态机（派生）", REF),
                d("state", "所属状态（派生）", REF));
        mc(UmlMetaclass.VERTEX,
                s("incoming", "入转换", REFS, EXP),
                s("outgoing", "出转换", REFS, EXP),
                d("container", "容器（派生）", REF));
        mc(UmlMetaclass.PSEUDOSTATE,
                e("kind", "伪状态种类", STD, "initial", "deepHistory", "shallowHistory", "join",
                        "fork", "junction", "choice", "entryPoint", "exitPoint", "terminate"),
                s("state", "所属状态", REF, EXP),
                s("stateMachine", "所属状态机", REF, EXP));
        mc(UmlMetaclass.STATE,
                d("isSimple", "是否简单状态（派生）", BOOL),
                d("isComposite", "是否复合状态（派生）", BOOL),
                d("isOrthogonal", "是否正交状态（派生）", BOOL),
                s("entry", "入口动作", REF, EXP),
                s("exit", "出口动作", REF, EXP),
                s("doActivity", "do 活动", REF, EXP),
                s("stateInvariant", "状态不变式", REF, EXP),
                s("submachine", "子状态机", REF, EXP),
                s("connection", "连接点", REFS, EXP),
                s("connectionPoint", "连接点引用", REFS, EXP),
                s("region", "区域", REFS, STD),
                s("deferrableTrigger", "可延迟触发器", REFS, EXP));
        mc(UmlMetaclass.FINAL_STATE);
        mc(UmlMetaclass.CONNECTION_POINT_REFERENCE,
                s("entry", "入口点", REFS, EXP),
                s("exit", "出口点", REFS, EXP),
                d("state", "所属状态（派生）", REF));
        mc(UmlMetaclass.TRANSITION,
                e("kind", "转换种类", STD, "internal", "local", "external"),
                s("guard", "守卫", TXT, STD),
                s("effect", "效果", REF, EXP),
                s("source", "源顶点", REF, STD),
                s("target", "目标顶点", REF, STD),
                s("trigger", "触发器", REFS, STD),
                s("redefinedTransition", "被重定义转换", REF, EXP),
                d("container", "容器（派生）", REF));
        mc(UmlMetaclass.EVENT);
        mc(UmlMetaclass.SIGNAL_EVENT,
                s("signal", "信号", REF, STD));
        mc(UmlMetaclass.CALL_EVENT,
                s("operation", "操作", REF, STD));
        mc(UmlMetaclass.TIME_EVENT,
                s("isRelative", "是否相对", BOOL, STD),
                s("when", "时间表达式", REF, EXP));
        mc(UmlMetaclass.CHANGE_EVENT,
                s("changeExpression", "改变表达式", TXT, STD));
        mc(UmlMetaclass.TRIGGER,
                s("event", "事件", REF, STD),
                s("port", "端口", REFS, EXP));
        mc(UmlMetaclass.USE_CASE,
                s("subject", "主体", REFS, STD),
                s("include", "包含", REFS, EXP),
                s("extend", "扩展", REFS, EXP),
                s("extensionPoint", "扩展点", REFS, STD));
        mc(UmlMetaclass.ACTOR);
        mc(UmlMetaclass.EXTENSION_POINT,
                d("useCase", "所属用例（派生）", REF));
        mc(UmlMetaclass.INCLUDE,
                s("addition", "被包含用例", REF, STD),
                d("includingCase", "包含用例（派生）", REF));
        mc(UmlMetaclass.EXTEND,
                s("condition", "条件", TXT, STD),
                s("extensionLocation", "扩展位置", REFS, EXP),
                s("extensionPoint", "扩展点", REFS, STD),
                s("extendedCase", "被扩展用例", REF, STD));
        mc(UmlMetaclass.TEMPLATE_SIGNATURE,
                s("parameter", "参数", REFS, EXP),
                s("ownedParameter", "拥有的参数", REFS, EXP),
                d("template", "模板（派生）", REF));
        mc(UmlMetaclass.TEMPLATE_PARAMETER,
                s("parameteredElement", "被参数化元素", REF, STD),
                s("default", "默认值", REF, EXP),
                s("ownedDefault", "拥有的默认值", REF, EXP),
                d("signature", "签名（派生）", REF));

        /* ── SysML 1.6 构造型 ── */
        mc(UmlMetaclass.SYSML_BLOCK,
                s("isEncapsulated", "是否封装", BOOL, STD),
                d("ownedPart", "拥有的部件（派生）", REFS),
                d("ownedReference", "拥有的引用（派生）", REFS),
                d("ownedValue", "拥有的值属性（派生）", REFS),
                d("ownedConstraint", "拥有的约束（派生）", REFS));
        mc(UmlMetaclass.SYSML_CONSTRAINT_BLOCK,
                s("constraint", "约束表达式", TXT, STD),
                s("ownedParameter", "拥有的约束参数", REFS, STD),
                d("isEncapsulated", "是否封装（派生）", BOOL));
        mc(UmlMetaclass.SYSML_VALUE_TYPE,
                s("unit", "单位", REF, STD),
                s("dimension", "量纲", REF, STD),
                s("quantityKind", "量纲种类", STRS, EXP));
        mc(UmlMetaclass.SYSML_UNIT,
                s("symbol", "单位符号", STR, STD),
                s("baseUnit", "基本单位", REFS, EXP),
                s("derivedUnit", "导出单位", REFS, EXP));
        mc(UmlMetaclass.SYSML_DIMENSION,
                s("symbol", "量纲符号", STR, STD),
                s("baseDimension", "基本量纲", REFS, EXP));
        mc(UmlMetaclass.SYSML_REQUIREMENT,
                s("id", "需求 ID", STR, STD),
                s("text", "需求文本", TXT, STD),
                s("derivedFrom", "派生自", REFS, EXP),
                s("refinedBy", "被细化", REFS, EXP),
                s("satisfiedBy", "被满足", REFS, EXP),
                s("verifiedBy", "被验证", REFS, EXP),
                s("tracedTo", "追溯到", REFS, EXP),
                s("master", "主控需求", REF, EXP),
                s("copy", "副本", REFS, EXP));
        mc(UmlMetaclass.SYSML_TEST_CASE,
                s("verifies", "验证的需求", REFS, STD),
                s("testProcedure", "测试规程", TXT, EXP));
        mc(UmlMetaclass.SYSML_PART_PROPERTY,
                d("owningBlock", "所属块（派生）", REF));
        mc(UmlMetaclass.SYSML_VALUE_PROPERTY,
                s("unit", "单位", REF, EXP),
                s("dimension", "量纲", REF, EXP));
        mc(UmlMetaclass.SYSML_REFERENCE_PROPERTY,
                d("owningBlock", "所属块（派生）", REF));
        mc(UmlMetaclass.SYSML_CONSTRAINT_PROPERTY,
                s("constraintBlock", "约束块", REF, STD));
        mc(UmlMetaclass.SYSML_CONSTRAINT_PARAMETER,
                s("constraintBlock", "约束块", REF, EXP));
        mc(UmlMetaclass.SYSML_FLOW_PORT,
                e("direction", "方向", STD, "in", "out", "inout"),
                s("isAtomic", "是否原子", BOOL, STD),
                s("isConjugated", "是否共轭", BOOL, EXP));
        mc(UmlMetaclass.SYSML_FLOW_SPECIFICATION,
                s("flowProperty", "流属性", REFS, STD));
        mc(UmlMetaclass.SYSML_FLOW_PROPERTY,
                e("direction", "方向", STD, "in", "out", "inout"));
        mc(UmlMetaclass.SYSML_ITEM_FLOW,
                s("itemProperty", "项属性", REF, EXP),
                s("informationSource", "信息源", REF, EXP),
                s("informationTarget", "信息目标", REF, EXP));
        mc(UmlMetaclass.SYSML_ALLOCATE,
                d("allocationTarget", "分配目标（派生）", REFS));
        mc(UmlMetaclass.SYSML_VIEW,
                s("viewpoint", "视点", STR, STD),
                s("conforms", "符合的视点", REFS, EXP),
                s("stakeholder", "干系人", STRS, STD));
        mc(UmlMetaclass.SYSML_VIEWPOINT,
                s("stakeholder", "干系人", STRS, STD),
                s("concern", "关注点", TXT, STD),
                s("purpose", "目的", TXT, STD),
                s("language", "语言", STR, EXP),
                s("method", "方法", STRS, EXP));
        mc(UmlMetaclass.SYSML_RATIONALE,
                s("rationaleId", "理由 ID", STR, EXP));
        mc(UmlMetaclass.SYSML_PROBLEM,
                s("problemId", "问题 ID", STR, EXP));

        /* ── 实现层系统属性：文档/构造型可编辑，标识与统计量只读 ── */
        mc(UmlMetaclass.SCOFEN_CORE,
                s("documentation", "文档", TXT, STD),
                s("stereotypes", "构造型", STRS, STD),
                s("taggedValues", "标记值（JSON 对象）", TXT, EXP),
                d("id", "模型 ID（系统）", STR),
                d("xmiId", "XMI ID（系统）", STR),
                d("ownerId", "所有者 ID（系统）", REF),
                d("elementType", "元模型类型（系统）", STR),
                d("revision", "模型 revision（系统）", INT),
                d("qualifiedName", "限定名（系统计算）", STR),
                d("ownedElementCount", "直接子元素数（系统计算）", INT),
                d("descendantCount", "后代元素数（系统计算）", INT),
                d("diagramRefCount", "被图引用数（系统计算）", INT),
                d("relationshipCount", "关联关系数（系统计算）", INT),
                d("isProjectRoot", "是否项目根（系统计算）", BOOL));

        /* ── 关系系统属性：端点只读、标识只读，文档/构造型/标记值可编辑 ── */
        mc(UmlMetaclass.SCOFEN_RELATION,
                s("documentation", "文档", TXT, STD),
                s("stereotypes", "构造型", STRS, STD),
                s("taggedValues", "标记值（JSON 对象）", TXT, EXP),
                d("id", "关系 ID（系统）", STR),
                d("xmiId", "XMI ID（系统）", STR),
                d("sourceId", "源元素（系统）", REF),
                d("targetId", "目标元素（系统）", REF),
                d("ownerId", "所有者 ID（系统）", REF),
                d("relationshipType", "关系类型（系统）", STR),
                d("revision", "模型 revision（系统）", INT));


        /* ── ElementType → 直接元类（继承链自动展开） ── */
        roots(ElementType.PACKAGE, UmlMetaclass.PACKAGE);
        roots(ElementType.MODEL, UmlMetaclass.MODEL);
        roots(ElementType.MODEL_LIBRARY, UmlMetaclass.MODEL);
        roots(ElementType.PROFILE, UmlMetaclass.PROFILE);
        roots(ElementType.STEREOTYPE, UmlMetaclass.STEREOTYPE);
        roots(ElementType.REQUIREMENT, UmlMetaclass.SYSML_REQUIREMENT);
        roots(ElementType.TEST_CASE, UmlMetaclass.SYSML_TEST_CASE);
        roots(ElementType.BLOCK, UmlMetaclass.SYSML_BLOCK);
        roots(ElementType.VALUE_TYPE, UmlMetaclass.SYSML_VALUE_TYPE);
        roots(ElementType.PART, UmlMetaclass.SYSML_PART_PROPERTY);
        roots(ElementType.PORT, UmlMetaclass.PORT);
        roots(ElementType.FLOW_PORT, UmlMetaclass.SYSML_FLOW_PORT);
        roots(ElementType.CONNECTOR, UmlMetaclass.CONNECTOR);
        roots(ElementType.CONSTRAINT_BLOCK, UmlMetaclass.SYSML_CONSTRAINT_BLOCK);
        roots(ElementType.CONSTRAINT_PROPERTY, UmlMetaclass.SYSML_CONSTRAINT_PROPERTY);
        roots(ElementType.CONSTRAINT_PARAMETER, UmlMetaclass.SYSML_CONSTRAINT_PARAMETER);
        roots(ElementType.ACTIVITY, UmlMetaclass.ACTIVITY);
        roots(ElementType.ACTION, UmlMetaclass.ACTION);
        roots(ElementType.CONTROL_NODE, UmlMetaclass.CONTROL_NODE);
        roots(ElementType.OBJECT_NODE, UmlMetaclass.OBJECT_NODE);
        roots(ElementType.ACTIVITY_PARTITION, UmlMetaclass.ACTIVITY_PARTITION);
        roots(ElementType.INTERACTION, UmlMetaclass.INTERACTION);
        roots(ElementType.LIFELINE, UmlMetaclass.LIFELINE);
        roots(ElementType.MESSAGE, UmlMetaclass.MESSAGE);
        roots(ElementType.COMBINED_FRAGMENT, UmlMetaclass.COMBINED_FRAGMENT);
        roots(ElementType.STATE_MACHINE, UmlMetaclass.STATE_MACHINE);
        roots(ElementType.STATE, UmlMetaclass.STATE);
        roots(ElementType.TRANSITION, UmlMetaclass.TRANSITION);
        roots(ElementType.PSEUDOSTATE, UmlMetaclass.PSEUDOSTATE);
        roots(ElementType.USE_CASE, UmlMetaclass.USE_CASE);
        roots(ElementType.ACTOR, UmlMetaclass.ACTOR);
        roots(ElementType.COMMENT, UmlMetaclass.COMMENT);

        /* ── RelationshipType → 元类链：关系与元素一样按规范铺开属性 ── */
        relationChain(RelationshipType.CONTAINMENT, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.IMPORT, UmlMetaclass.PACKAGE_IMPORT, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.ACCESS, UmlMetaclass.PACKAGE_IMPORT, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.GENERALIZATION, UmlMetaclass.GENERALIZATION, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.ASSOCIATION, UmlMetaclass.ASSOCIATION, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.DEPENDENCY, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.SATISFY, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.VERIFY, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.REFINE, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.DERIVE_REQT, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.COPY, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.TRACE, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.ALLOCATE, UmlMetaclass.SYSML_ALLOCATE,
                UmlMetaclass.ABSTRACTION, UmlMetaclass.DEPENDENCY, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.CONNECTOR, UmlMetaclass.CONNECTOR, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.ITEM_FLOW, UmlMetaclass.SYSML_ITEM_FLOW, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.BINDING, UmlMetaclass.CONNECTOR, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.DELEGATION, UmlMetaclass.CONNECTOR, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.CONSTRAINT_PARAMETER,
                UmlMetaclass.SYSML_CONSTRAINT_PARAMETER, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.CONTROL_FLOW,
                UmlMetaclass.CONTROL_FLOW, UmlMetaclass.ACTIVITY_EDGE, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.OBJECT_FLOW,
                UmlMetaclass.OBJECT_FLOW, UmlMetaclass.ACTIVITY_EDGE, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.PARTITION, UmlMetaclass.ACTIVITY_PARTITION, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.MESSAGE, UmlMetaclass.MESSAGE, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.ORDERED_FRAGMENT,
                UmlMetaclass.COMBINED_FRAGMENT, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.GUARD, UmlMetaclass.CONSTRAINT, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.TRANSITION, UmlMetaclass.TRANSITION, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.REGION, UmlMetaclass.REGION, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.INCLUDE, UmlMetaclass.INCLUDE, UmlMetaclass.NAMED_ELEMENT);
        relationChain(RelationshipType.EXTEND, UmlMetaclass.EXTEND, UmlMetaclass.NAMED_ELEMENT);
    }

    private PropertyCatalog() {
    }

    private static Spec s(String key, String label, ValueKind kind, Level level) {
        return new Spec(key, key, label, kind, level, false, List.of(), null);
    }

    private static Spec d(String key, String label, ValueKind kind) {
        return new Spec(key, key, label, kind, Level.DERIVED, true, List.of(), null);
    }

    private static Spec e(String key, String label, Level level, String... options) {
        return new Spec(key, key, label, ValueKind.ENUM, level, false, List.of(options), null);
    }

    private static Spec ed(String key, String label, String... options) {
        return new Spec(key, key, label, ValueKind.ENUM, Level.DERIVED, true, List.of(options), null);
    }

    private static void mc(UmlMetaclass metaclass, Spec... specs) {
        List<PropertySpec> rows = new ArrayList<>();
        for (Spec spec : specs) {
            rows.add(new PropertySpec(spec.key(), spec.umlName(), spec.label(),
                    metaclass.name(), metaclass.umlName(), metaclass.label(), metaclass.spec(),
                    spec.kind(), spec.level(), spec.computed(), spec.options(), spec.defaultValue()));
        }
        BY_METACLASS.put(metaclass, List.copyOf(rows));
    }

    private static void roots(ElementType type, UmlMetaclass... metaclasses) {
        ROOTS.put(type, List.of(metaclasses));
    }

    private static void relationChain(RelationshipType type, UmlMetaclass... metaclasses) {
        RELATION_CHAINS.put(type, List.of(metaclasses));
    }

    private static void collect(UmlMetaclass metaclass, LinkedHashSet<UmlMetaclass> chain) {
        if (!chain.add(metaclass)) {
            return;
        }
        for (UmlMetaclass parent : metaclass.parents()) {
            collect(parent, chain);
        }
    }

    /** 该元素类型在继承链上的全部元类，具体元类在前。 */
    public static List<UmlMetaclass> metaclassesOf(ElementType type) {
        LinkedHashSet<UmlMetaclass> chain = new LinkedHashSet<>();
        for (UmlMetaclass root : ROOTS.getOrDefault(type, List.of(UmlMetaclass.NAMED_ELEMENT))) {
            collect(root, chain);
        }
        collect(UmlMetaclass.SCOFEN_CORE, chain);
        return List.copyOf(chain);
    }

    /** 完整属性清单（同名属性由更具体的元类优先，系统属性追加在最后）。 */
    public static List<PropertySpec> forType(ElementType type) {
        Map<String, PropertySpec> byKey = new LinkedHashMap<>();
        for (UmlMetaclass metaclass : metaclassesOf(type)) {
            for (PropertySpec spec : BY_METACLASS.getOrDefault(metaclass, List.of())) {
                byKey.putIfAbsent(spec.key(), spec);
            }
        }
        return List.copyOf(byKey.values());
    }

    /** 按「标准 / 专家 / 全部」三档过滤展示数量。 */
    public static List<PropertySpec> filter(ElementType type, View view) {
        List<PropertySpec> all = forType(type);
        if (view == View.ALL) {
            return all;
        }
        return all.stream()
                .filter(spec -> view == View.EXPERT
                        ? spec.level() != Level.DERIVED
                        : spec.level() == Level.STANDARD)
                .toList();
    }

    public static PropertySpec find(ElementType type, String key) {
        return forType(type).stream()
                .filter(spec -> spec.key().equals(key))
                .findFirst()
                .orElse(null);
    }

    /** 服务端写入校验用：只允许注册表内、非计算/派生的属性。 */
    public static boolean isEditable(ElementType type, String key) {
        PropertySpec spec = find(type, key);
        return spec != null && spec.editable();
    }

    /* ── 关系：关系也是一种模型对象，属性窗口与元素同构 ── */

    /** 该关系类型的元类链（具体元类在前，末尾追加关系系统属性）。 */
    public static List<UmlMetaclass> metaclassesOf(RelationshipType type) {
        LinkedHashSet<UmlMetaclass> chain = new LinkedHashSet<>(
                RELATION_CHAINS.getOrDefault(type, List.of(UmlMetaclass.NAMED_ELEMENT)));
        // 每条关系在图上都有方向：链里没有有向关系时补上，端点由界面只读展示。
        if (!chain.contains(UmlMetaclass.DIRECTED_RELATIONSHIP) && !chain.contains(UmlMetaclass.RELATIONSHIP)) {
            chain.add(UmlMetaclass.DIRECTED_RELATIONSHIP);
        }
        chain.add(UmlMetaclass.SCOFEN_RELATION);
        return List.copyOf(chain);
    }

    /** 关系完整属性清单；端点属性转只读，避免绕过图形直接改连接。 */
    public static List<PropertySpec> forRelationship(RelationshipType type) {
        Map<String, PropertySpec> byKey = new LinkedHashMap<>();
        for (UmlMetaclass metaclass : metaclassesOf(type)) {
            for (PropertySpec spec : BY_METACLASS.getOrDefault(metaclass, List.of())) {
                PropertySpec value = isEndpointKey(spec.key()) ? asDerived(spec) : spec;
                byKey.putIfAbsent(spec.key(), value);
            }
        }
        return List.copyOf(byKey.values());
    }

    private static boolean isEndpointKey(String key) {
        return "source".equals(key) || "target".equals(key);
    }

    private static PropertySpec asDerived(PropertySpec spec) {
        return new PropertySpec(spec.key(), spec.umlName(), spec.label(),
                spec.metaclass(), spec.metaclassName(), spec.metaclassLabel(), spec.spec(),
                ValueKind.REFERENCE, Level.DERIVED, true, spec.options(), spec.defaultValue());
    }

    public static List<PropertySpec> filter(RelationshipType type, View view) {
        List<PropertySpec> all = forRelationship(type);
        if (view == View.ALL) {
            return all;
        }
        return all.stream()
                .filter(spec -> view == View.EXPERT
                        ? spec.level() != Level.DERIVED
                        : spec.level() == Level.STANDARD)
                .toList();
    }

    public static PropertySpec find(RelationshipType type, String key) {
        return forRelationship(type).stream()
                .filter(spec -> spec.key().equals(key))
                .findFirst()
                .orElse(null);
    }

    /** 服务端写入校验用：关系属性同样必须在清单内且非只读。 */
    public static boolean isEditable(RelationshipType type, String key) {
        PropertySpec spec = find(type, key);
        return spec != null && spec.editable();
    }

    public static int totalPropertyCount() {
        return BY_METACLASS.values().stream().mapToInt(List::size).sum();
    }

    /** 下发给前端的完整目录：档位定义 + 元类继承链 + 每种元素类型的属性表。 */
    public static Map<String, Object> describe() {
        List<Map<String, Object>> levels = List.of(
                Map.of("code", "STANDARD", "label", "标准", "description", "建模时最常用的规范属性"),
                Map.of("code", "EXPERT", "label", "专家", "description", "标准属性 + 规范扩展属性"),
                Map.of("code", "ALL", "label", "全部", "description", "专家属性 + 计算属性 / 派生属性（只读）"));
        List<Map<String, Object>> metaclasses = new ArrayList<>();
        for (UmlMetaclass metaclass : UmlMetaclass.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("code", metaclass.name());
            row.put("name", metaclass.umlName());
            row.put("label", metaclass.label());
            row.put("spec", metaclass.spec());
            row.put("parents", metaclass.parents().stream().map(UmlMetaclass::name).toList());
            row.put("propertyCount", BY_METACLASS.getOrDefault(metaclass, List.of()).size());
            metaclasses.add(row);
        }
        Map<String, Object> types = new LinkedHashMap<>();
        for (ElementType type : ElementType.values()) {
            List<PropertySpec> all = forType(type);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("metaclasses", metaclassesOf(type).stream().map(UmlMetaclass::name).toList());
            row.put("properties", all.stream().map(PropertySpec::toMap).toList());
            row.put("counts", Map.of(
                    "STANDARD", filter(type, View.STANDARD).size(),
                    "EXPERT", filter(type, View.EXPERT).size(),
                    "ALL", all.size()));
            types.put(type.name(), row);
        }
        Map<String, Object> relationships = new LinkedHashMap<>();
        for (RelationshipType type : RelationshipType.values()) {
            List<PropertySpec> all = forRelationship(type);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("metaclasses", metaclassesOf(type).stream().map(UmlMetaclass::name).toList());
            row.put("properties", all.stream().map(PropertySpec::toMap).toList());
            row.put("counts", Map.of(
                    "STANDARD", filter(type, View.STANDARD).size(),
                    "EXPERT", filter(type, View.EXPERT).size(),
                    "ALL", all.size()));
            relationships.put(type.code(), row);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("levels", levels);
        result.put("metaclasses", metaclasses);
        result.put("types", types);
        result.put("relationships", relationships);
        result.put("totalDefinitions", totalPropertyCount());
        result.put("specification", "UML 2.5.1 + SysML 1.6");
        return result;
    }
}
