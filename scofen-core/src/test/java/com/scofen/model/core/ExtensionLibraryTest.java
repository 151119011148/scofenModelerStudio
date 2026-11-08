package com.scofen.model.core;

import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.UmlMetaclass;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 通用扩展包：SysML / UML 的元类与构造型随每个项目提供，并可被引用定位。 */
class ExtensionLibraryTest {

    private static final String SESSION = "extension-session";

    private final List<Patch> published = new ArrayList<>();
    private final PatchSink sink = published::add;
    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        published.clear();
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), sink);
        executor.execute(SESSION, Command.of("CREATE_ELEMENT", executor.revision(), "root",
                Map.of("id", "model-root", "type", "Package", "name", "示例项目", "ownerId", "")));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION,
                Command.of(type, executor.revision(), "ext-" + (++counter), payload));
    }

    private ModelElement element(String id) {
        return executor.snapshot().elements().stream()
                .filter(item -> item.id().equals(id))
                .findFirst()
                .orElseThrow(() -> new AssertionError("元素不存在: " + id));
    }

    private ModelElement elementOrNull(String id) {
        return executor.snapshot().elements().stream()
                .filter(item -> item.id().equals(id))
                .findFirst()
                .orElse(null);
    }

    @Test
    void everyProjectGetsBothGenericExtensionPackages() {
        ExtensionSeeder.seed(executor, "model-root");
        ModelSnapshot snapshot = executor.snapshot();

        assertThat(snapshot.elements()).hasSize(1 + ExtensionLibrary.size());
        assertThat(element(ExtensionLibrary.SYSML_PROFILE_ID).name()).isEqualTo("SysML 扩展包");
        assertThat(element(ExtensionLibrary.UML_PROFILE_ID).name()).isEqualTo("UML 扩展包");
        assertThat(element(ExtensionLibrary.SYSML_PROFILE_ID).type()).isEqualTo("PROFILE");
        // 扩展包挂在项目根下，是项目的公共内容
        assertThat(element(ExtensionLibrary.SYSML_PROFILE_ID).ownerId()).isEqualTo("model-root");
    }

    @Test
    void extensionPackageCarriesMetaclassesAndStereotypes() {
        ExtensionSeeder.seed(executor, "model-root");

        long metaclassCount = executor.snapshot().elements().stream()
                .filter(item -> "METACLASS".equals(item.type()))
                .count();
        long stereotypeCount = executor.snapshot().elements().stream()
                .filter(item -> "STEREOTYPE".equals(item.type()))
                .count();

        // 每个规范元类（除实现层系统属性外）都有对应的元类元素
        long expected = java.util.Arrays.stream(UmlMetaclass.values())
                .filter(mc -> mc != UmlMetaclass.SCOFEN_CORE && mc != UmlMetaclass.SCOFEN_RELATION)
                .count();
        assertThat(metaclassCount).isEqualTo(expected);
        // 构造型只收规范里真实存在的那些，界面关键词（package / comment / controlNode…）不算
        long expectedStereotypes = java.util.Arrays.stream(ElementType.values())
                .filter(ElementType::specStereotype)
                .count();
        assertThat(stereotypeCount)
                .isEqualTo(expectedStereotypes
                        + ExtensionLibrary.sysmlExtraStereotypeCount()
                        + ExtensionLibrary.standardStereotypeCount());
    }

    /** 「String 值类型」是用户明确指出的缺口：原始类型库必须真的给出可引用的元素。 */
    @Test
    void primitiveTypesAndValueTypesAreRealElements() {
        ExtensionSeeder.seed(executor, "model-root");

        for (String name : List.of("Boolean", "Integer", "Real", "String", "UnlimitedNatural")) {
            ModelElement primitive = element(ExtensionLibrary.primitiveId(name));
            assertThat(primitive.type()).isEqualTo("PRIMITIVE_TYPE");
            assertThat(primitive.ownerId()).isEqualTo(ExtensionLibrary.PRIMITIVE_LIBRARY_ID);
        }
        for (String name : List.of("Boolean", "Integer", "Real", "String", "Number", "Complex")) {
            assertThat(element(ExtensionLibrary.valueTypeId(name)).type()).isEqualTo("VALUE_TYPE");
        }
        // 单位库的量纲可被单位引用：metre → length
        ModelElement metre = element(ExtensionLibrary.unitId("metre"));
        assertThat(metre.properties().get("dimension"))
                .isEqualTo(ExtensionLibrary.dimensionId("length"));
        assertThat(metre.stereotypes()).contains("unit");
    }

    /** 值属性的类型可以直接指向标准库里的 String，而不必自己造一个同名元素。 */
    @Test
    void valuePropertyCanReferenceThePrimitiveTypeLibrary() {
        ExtensionSeeder.seed(executor, "model-root");
        cmd("CREATE_ELEMENT", Map.of("id", "e-spec", "type", "Block", "name", "规格块",
                "ownerId", "model-root"));
        cmd("CREATE_ELEMENT", Map.of("id", "p-name", "type", "ValueProperty", "name", "名称",
                "ownerId", "e-spec"));

        cmd("UPDATE_PROPERTY", Map.of("id", "p-name", "key", "type",
                "value", ExtensionLibrary.primitiveId("String")));
        assertThat(element("p-name").properties().get("type"))
                .isEqualTo(ExtensionLibrary.primitiveId("String"));
    }

    @Test
    void metaclassInheritanceIsExpressedAsResolvableReference() {
        ExtensionSeeder.seed(executor, "model-root");
        Set<String> ids = new HashSet<>(executor.snapshot().elements().stream()
                .map(ModelElement::id).toList());

        for (UmlMetaclass metaclass : UmlMetaclass.values()) {
            if (metaclass == UmlMetaclass.SCOFEN_CORE || metaclass == UmlMetaclass.SCOFEN_RELATION) {
                continue;
            }
            ModelElement element = element(ExtensionLibrary.metaclassId(metaclass));
            Object parent = element.properties().get("extendsMetaclass");
            if (metaclass.parents().isEmpty()) {
                // 元模型的最顶层（Element）没有父元类
                assertThat(parent).as("%s 是元模型顶层", element.name()).isNull();
                continue;
            }
            assertThat(parent).as("%s 的父元类", element.name()).isNotNull();
            assertThat(ids).contains(String.valueOf(parent));
        }
    }

    @Test
    void sysMLMetaclassInheritsFromUMLMetaclass() {
        ExtensionSeeder.seed(executor, "model-root");

        // SysML 的块扩展自 UML 的类
        ModelElement block = element(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_BLOCK));
        assertThat(block.ownerId()).isEqualTo(ExtensionLibrary.SYSML_PROFILE_ID + ExtensionLibrary.METACLASS_PACKAGE_SUFFIX);
        assertThat(String.valueOf(block.properties().get("extendsMetaclass")))
                .isEqualTo(ExtensionLibrary.metaclassId(UmlMetaclass.CLASS));

        // SysML 的需求扩展自 UML 的类
        ModelElement requirement = element(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_REQUIREMENT));
        assertThat(String.valueOf(requirement.properties().get("extendsMetaclass")))
                .isEqualTo(ExtensionLibrary.metaclassId(UmlMetaclass.CLASS));
    }

    @Test
    void stereotypeSpecializesTheMetaclassItAppliesTo() {
        ExtensionSeeder.seed(executor, "model-root");

        ModelElement blockStereotype = element(ExtensionLibrary.stereotypeId("block"));
        assertThat(blockStereotype.type()).isEqualTo("STEREOTYPE");
        assertThat(String.valueOf(blockStereotype.properties().get("extendsMetaclass")))
                .isEqualTo(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_BLOCK));

        ModelElement requirementStereotype = element(ExtensionLibrary.stereotypeId("requirement"));
        assertThat(String.valueOf(requirementStereotype.properties().get("extendsMetaclass")))
                .isEqualTo(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_REQUIREMENT));
    }

    @Test
    void elementCanReferenceItsMetaclassAndLocateItInTheTree() {
        ExtensionSeeder.seed(executor, "model-root");
        cmd("CREATE_ELEMENT", Map.of("id", "e-vcu", "type", "Block", "name", "整车控制器",
                "ownerId", "model-root", "stereotypes", List.of("block")));

        // 「扩展的元类」指向扩展包里的元类元素
        cmd("UPDATE_PROPERTY", Map.of("id", "e-vcu", "key", "extendsMetaclass",
                "value", ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_BLOCK)));
        assertThat(element("e-vcu").properties().get("extendsMetaclass"))
                .isEqualTo(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_BLOCK));

        // 指向不存在的元类必须被服务端拒绝
        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "e-vcu",
                "key", "extendsMetaclass", "value", "mc-NOT-A-METACLASS")))
                .hasMessageContaining("引用的元素不存在");
    }

    @Test
    void bulkCreateIsOneRevisionAndReversible() {
        long before = executor.revision();
        cmd("CREATE_ELEMENTS", Map.of("elements", List.of(
                Map.of("id", "p-1", "type", "Package", "name", "包一", "ownerId", "model-root"),
                Map.of("id", "p-2", "type", "Package", "name", "包二", "ownerId", "p-1"))));

        assertThat(executor.revision()).isEqualTo(before + 1);
        assertThat(element("p-1").ownerId()).isEqualTo("model-root");
        assertThat(element("p-2").ownerId()).isEqualTo("p-1");

        executor.undo(SESSION);
        assertThat(executor.snapshot().elements()).hasSize(1);
    }

    @Test
    void bulkCreateRejectsDuplicateNamesWithinTheSameBatch() {
        assertThatThrownBy(() -> cmd("CREATE_ELEMENTS", Map.of("elements", List.of(
                Map.of("id", "d-1", "type", "Package", "name", "同名包", "ownerId", "model-root"),
                Map.of("id", "d-2", "type", "Package", "name", "同名包", "ownerId", "model-root")))))
                .hasMessageContaining("Duplicate element name");
    }

    @Test
    void bulkCreateRejectsDanglingMetaclassReference() {
        assertThatThrownBy(() -> cmd("CREATE_ELEMENTS", Map.of("elements", List.of(
                Map.of("id", "m-1", "type", "METACLASS", "name", "孤儿元类", "ownerId", "model-root",
                        "properties", Map.of("extendsMetaclass", "mc-MISSING"))))))
                .hasMessageContaining("引用的元素不存在");
    }

    @Test
    void extensionPackageCannotBeDeletedWholesale() {
        ExtensionSeeder.seed(executor, "model-root");
        assertThatThrownBy(() -> cmd("DELETE_ELEMENT",
                Map.of("id", ExtensionLibrary.SYSML_PROFILE_ID)))
                .hasMessageContaining("通用扩展包不可删除");
        // 包内的具体元类仍可自行增删
        cmd("DELETE_ELEMENT", Map.of("id", ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_VIEW)));
        assertThat(elementOrNull(ExtensionLibrary.metaclassId(UmlMetaclass.SYSML_VIEW))).isNull();
    }

    /** 升级补齐只补缺失项：已齐全时不动，缺一个就只补那一个。 */
    @Test
    void syncBackfillsOnlyMissingLibraryElements() {
        ExtensionSeeder.seed(executor, "model-root");
        int before = executor.snapshot().elements().size();
        assertThat(ExtensionSeeder.sync(executor, "model-root")).isFalse();

        cmd("DELETE_ELEMENT", Map.of("id", ExtensionLibrary.primitiveId("String")));
        assertThat(ExtensionSeeder.sync(executor, "model-root")).isTrue();
        assertThat(executor.snapshot().elements()).hasSize(before);
        assertThat(element(ExtensionLibrary.primitiveId("String")).type()).isEqualTo("PRIMITIVE_TYPE");
    }

    /**
     * 旧版本把 ElementType 的「界面关键词」（package / port / activity…）当成构造型物化了，
     * 快照里留下 st-package 之类的元素。新目录不再生成它们，若只补不删，这些元素会因为
     * 父包被隔离而变成孤儿、直接挂到模型树顶层——必须清掉；用户自建元素一律不动。
     */
    @Test
    void syncPrunesKeywordStereotypesLeftByOlderVersions() {
        ExtensionSeeder.seed(executor, "model-root");
        String stereotypeOwner = ExtensionLibrary.SYSML_PROFILE_ID
                + ExtensionLibrary.STEREOTYPE_PACKAGE_SUFFIX;
        cmd("CREATE_ELEMENT", Map.of("id", "st-package", "type", "STEREOTYPE", "name", "package",
                "ownerId", stereotypeOwner));
        cmd("CREATE_ELEMENT", Map.of("id", "e-user-1", "type", "Package", "name", "用户包",
                "ownerId", "model-root"));
        int before = executor.snapshot().elements().size();

        assertThat(ExtensionSeeder.sync(executor, "model-root")).isTrue();

        assertThat(elementOrNull("st-package")).as("旧版关键词构造型应被清理").isNull();
        assertThat(element("e-user-1").name()).as("用户元素不在扩展域命名空间").isEqualTo("用户包");
        assertThat(executor.snapshot().elements()).hasSize(before - 1);
    }

    @Test
    void extensionDomainIsRecognizedByIdPrefix() {
        // 与前端 isExtensionId() 同一套前缀约定；用户元素 id 形如 e-xxx，不会误判。
        assertThat(ExtensionLibrary.ownsId("ext-sysml")).isTrue();
        assertThat(ExtensionLibrary.ownsId("mc-PACKAGE")).isTrue();
        assertThat(ExtensionLibrary.ownsId("st-package")).isTrue();
        assertThat(ExtensionLibrary.ownsId("prim-String")).isTrue();
        assertThat(ExtensionLibrary.ownsId("unit-kilogram")).isTrue();
        assertThat(ExtensionLibrary.ownsId("e-lx2k9a-4f8d1")).isFalse();
        assertThat(ExtensionLibrary.ownsId("model-root")).isFalse();
        assertThat(ExtensionLibrary.ownsId(null)).isFalse();
    }

    @Test
    void packageCatalogDescribesTheWholeExtensionSubtree() {        List<ExtensionLibrary.PackageInfo> packages = ExtensionLibrary.packages();

        // 六个顶层扩展包 / 库 + 两个 Profile 下的「元类」「构造型」子包
        assertThat(packages).hasSize(10);
        assertThat(packages).extracting(ExtensionLibrary.PackageInfo::id)
                .containsExactlyInAnyOrder(
                        ExtensionLibrary.SYSML_PROFILE_ID,
                        ExtensionLibrary.UML_PROFILE_ID,
                        ExtensionLibrary.PRIMITIVE_LIBRARY_ID,
                        ExtensionLibrary.VALUE_LIBRARY_ID,
                        ExtensionLibrary.UNITS_LIBRARY_ID,
                        ExtensionLibrary.STANDARD_PROFILE_ID,
                        ExtensionLibrary.SYSML_PROFILE_ID + ExtensionLibrary.METACLASS_PACKAGE_SUFFIX,
                        ExtensionLibrary.SYSML_PROFILE_ID + ExtensionLibrary.STEREOTYPE_PACKAGE_SUFFIX,
                        ExtensionLibrary.UML_PROFILE_ID + ExtensionLibrary.METACLASS_PACKAGE_SUFFIX,
                        ExtensionLibrary.UML_PROFILE_ID + ExtensionLibrary.STEREOTYPE_PACKAGE_SUFFIX);

        // 顶层扩展包没有父，子包挂在各自的扩展包下
        ExtensionLibrary.PackageInfo sysml = packages.stream()
                .filter(item -> ExtensionLibrary.SYSML_PROFILE_ID.equals(item.id()))
                .findFirst().orElseThrow();
        assertThat(sysml.parentId()).isNull();
        assertThat(sysml.kind()).isEqualTo("PROFILE");

        // 三个标准库是模型库类型，界面据此换图标
        assertThat(packages.stream()
                .filter(item -> ExtensionLibrary.PRIMITIVE_LIBRARY_ID.equals(item.id()))
                .findFirst().orElseThrow().kind()).isEqualTo("MODEL_LIBRARY");

        ExtensionLibrary.PackageInfo sysmlMetaclasses = packages.stream()
                .filter(item -> (ExtensionLibrary.SYSML_PROFILE_ID + ExtensionLibrary.METACLASS_PACKAGE_SUFFIX)
                        .equals(item.id()))
                .findFirst().orElseThrow();
        assertThat(sysmlMetaclasses.parentId()).isEqualTo(ExtensionLibrary.SYSML_PROFILE_ID);
        assertThat(sysmlMetaclasses.kind()).isEqualTo("PACKAGE");
        // 子包计数 = 其直接子元素数，与扩展包内的实际数量一致
        assertThat(sysmlMetaclasses.metaclassCount()).isPositive();
        assertThat(sysmlMetaclasses.stereotypeCount()).isZero();
    }
}
