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
 * 通用扩展包：把 SysML 1.6 与 UML 2.5.1 的元类、构造型物化成模型元素。
 *
 * <p>每个项目都自带一份这样的扩展包，挂在项目根 Package 之下：</p>
 *
 * <pre>
 * 车载动力系统工程模型
 * ├── SysML 扩展包            （Profile）
 * │   ├── 元类               （Package）
 * │   │   ├── Block          （Metaclass，扩展的元类 → UML 的 Class）
 * │   │   └── …
 * │   └── 构造型             （Package）
 * │       ├── requirement    （Stereotype，扩展的元类 → SysML 的 Requirement）
 * │       └── …
 * └── UML 扩展包              （Profile）
 *     ├── 元类               （Package）
 *     └── 构造型             （Package）
 * </pre>
 *
 * <p>这样做的意义在于：元类与构造型不再只是元模型里的静态目录，而是模型里可被引用、
 * 可在模型树上定位的对象。属性面板里的「扩展的元类」「元类引用」「构造型」因此
 * 都能渲染成引用卡片，右键即可在模型树上高亮定位。</p>
 *
 * <p>SysML 的元类继承自 UML 的元类，因此 SysML 扩展包里的元类，其「扩展的元类」
 * 指向 UML 扩展包中的对应元类——扩展包之间的继承关系因此也是可追溯的引用。</p>
 */
public final class ExtensionLibrary {

    /** SysML 扩展包（Profile）元素 id。 */
    public static final String SYSML_PROFILE_ID = "ext-sysml";
    /** UML 扩展包（Profile）元素 id。 */
    public static final String UML_PROFILE_ID = "ext-uml";
    /** 元类子包 id 后缀。 */
    public static final String METACLASS_PACKAGE_SUFFIX = "-mc";
    /** 构造型子包 id 后缀。 */
    public static final String STEREOTYPE_PACKAGE_SUFFIX = "-st";

    /** 元类元素的 id 前缀。 */
    public static final String METACLASS_ID_PREFIX = "mc-";
    /** 构造型元素的 id 前缀。 */
    public static final String STEREOTYPE_ID_PREFIX = "st-";

    /**
     * 构造型归入哪个扩展包。
     *
     * <p>UML 自身的构造型（包、模型、剖面、端口、连接器、注释…）留在 UML 扩展包；
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

    private ExtensionLibrary() {
    }

    /** 元类元素的 id：由元类枚举名派生，全局唯一且可读。 */
    public static String metaclassId(UmlMetaclass metaclass) {
        return METACLASS_ID_PREFIX + metaclass.name();
    }

    /** 构造型元素的 id：由构造型名派生。 */
    public static String stereotypeId(String stereotypeName) {
        return STEREOTYPE_ID_PREFIX + stereotypeName;
    }

    /** 某个元素类型默认构造型对应的元类（构造型特化的目标）。 */
    public static UmlMetaclass metaclassOfStereotype(ElementType type) {
        return PropertyCatalog.rootMetaclass(type);
    }

    /**
     * 生成通用扩展包的完整元素清单。
     *
     * <p>返回顺序即创建顺序：父包在前、子元素在后，便于增量渲染与逐条校验。
     * 每个项目的 id 固定一致，因为各项目拥有独立的模型运行时。</p>
     *
     * @param rootOwnerId 项目根元素 id（扩展包挂在它下面）
     */
    public static List<Definition> definitions(String rootOwnerId) {
        List<Definition> result = new ArrayList<>();

        // 两个扩展包（Profile）
        result.add(definition(SYSML_PROFILE_ID, "PROFILE", "SysML 扩展包", rootOwnerId,
                "SysML 1.6 通用扩展包：元类与构造型随项目提供。",
                List.of("profile"), Map.of()));
        result.add(definition(UML_PROFILE_ID, "PROFILE", "UML 扩展包", rootOwnerId,
                "UML 2.5.1 通用扩展包：元类与构造型随项目提供。",
                List.of("profile"), Map.of()));

        // 四个子包：元类 / 构造型
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
            result.add(definition(metaclassId(metaclass), "METACLASS", metaclass.umlName(), owner,
                    metaclass.spec(), List.of(), properties));
        }

        // 构造型：每个元素类型一个默认构造型，特化到自己的元类
        for (ElementType type : ElementType.values()) {
            String stereotype = type.stereotype();
            if (stereotype == null || stereotype.isBlank()) {
                continue;
            }
            boolean umlSide = UML_SIDE_STEREOTYPES.contains(type);
            String owner = (umlSide ? UML_PROFILE_ID : SYSML_PROFILE_ID) + STEREOTYPE_PACKAGE_SUFFIX;
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("extendsMetaclass", metaclassId(metaclassOfStereotype(type)));
            result.add(definition(stereotypeId(stereotype), "STEREOTYPE", stereotype, owner,
                    type.label() + " 的默认构造型（" + type.umlName() + "）。",
                    List.of("stereotype"), properties));
        }

        return List.copyOf(result);
    }

    /**
     * 扩展包子树的元素 id 集合（两个扩展包根 + 它们的所有后代）。
     *
     * <p>导入时用它区分「系统提供的公共内容」与「用户自己的模型」：
     * 扩展包随每个项目提供，不随模型交换，导入时应当原样保留。</p>
     *
     * @param elements 当前模型的元素集合
     */
    public static Set<String> subtreeIds(Collection<ModelElement> elements) {
        Set<String> result = new LinkedHashSet<>();
        result.add(SYSML_PROFILE_ID);
        result.add(UML_PROFILE_ID);
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

    /**
     * 通用扩展包清单：供界面识别「哪些是系统提供的公共内容」。
     *
     * <p>模型树默认把扩展包折叠起来——否则一百多个元类会淹没用户自己的模型；
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
     * 通用扩展包的清单：两个扩展包 + 四个子包（元类 / 构造型）。
     *
     * <p>模型树默认把整棵扩展子树折叠起来——否则一百多个元类会淹没用户自己的模型；
     * 需要查规范时再逐级展开。</p>
     */
    public static List<PackageInfo> packages() {
        List<PackageInfo> result = new ArrayList<>();
        for (String id : List.of(SYSML_PROFILE_ID, UML_PROFILE_ID)) {
            boolean sysml = SYSML_PROFILE_ID.equals(id);
            result.add(new PackageInfo(id,
                    null,
                    "PROFILE",
                    sysml ? "SysML 扩展包" : "UML 扩展包",
                    sysml ? "SysML 扩展包" : "UML 扩展包",
                    sysml ? "SysML Extension Package" : "UML Extension Package",
                    countUnder(id, "METACLASS"),
                    countUnder(id, "STEREOTYPE")));
            for (String suffix : List.of(METACLASS_PACKAGE_SUFFIX, STEREOTYPE_PACKAGE_SUFFIX)) {
                String childId = id + suffix;
                boolean metaclasses = METACLASS_PACKAGE_SUFFIX.equals(suffix);
                result.add(new PackageInfo(childId,
                        id,
                        "PACKAGE",
                        metaclasses ? "元类" : "构造型",
                        metaclasses ? "元类" : "构造型",
                        metaclasses ? "Metaclasses" : "Stereotypes",
                        metaclasses ? countUnder(childId, "METACLASS") : 0,
                        metaclasses ? 0 : countUnder(childId, "STEREOTYPE")));
            }
        }
        return List.copyOf(result);
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
