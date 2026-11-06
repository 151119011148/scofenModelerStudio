package com.scofen.model.metamodel;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** UML 2.5.1 / SysML 1.6 元属性目录：继承链展开、三档过滤与可编辑性。 */
class PropertyCatalogTest {

    @Test
    void everyElementTypeResolvesToSpecificationProperties() {
        for (ElementType type : ElementType.values()) {
            List<PropertyCatalog.PropertySpec> all = PropertyCatalog.forType(type);
            assertThat(all).as("%s 应有规范属性", type.name()).isNotEmpty();
            assertThat(all).as("%s 属性键不得重复", type.name())
                    .extracting(PropertyCatalog.PropertySpec::key)
                    .doesNotHaveDuplicates();
            assertThat(PropertyCatalog.metaclassesOf(type)).as("%s 应能解析元类链", type.name()).isNotEmpty();
        }
    }

    /** 标准 ⊂ 专家 ⊂ 全部，且「全部」包含派生只读属性。 */
    @Test
    void viewsAreNestedAndDerivedOnlyAppearInAll() {
        for (ElementType type : ElementType.values()) {
            int standard = PropertyCatalog.filter(type, PropertyCatalog.View.STANDARD).size();
            int expert = PropertyCatalog.filter(type, PropertyCatalog.View.EXPERT).size();
            int all = PropertyCatalog.filter(type, PropertyCatalog.View.ALL).size();
            assertThat(standard).as("%s 标准档不能为空", type.name()).isGreaterThanOrEqualTo(2);
            assertThat(expert).as("%s 专家档应覆盖标准档", type.name()).isGreaterThanOrEqualTo(standard);
            assertThat(all).as("%s 全部档应覆盖专家档", type.name()).isGreaterThan(expert);

            assertThat(PropertyCatalog.filter(type, PropertyCatalog.View.STANDARD))
                    .allMatch(spec -> spec.level() == PropertyCatalog.Level.STANDARD);
            assertThat(PropertyCatalog.filter(type, PropertyCatalog.View.EXPERT))
                    .noneMatch(spec -> spec.level() == PropertyCatalog.Level.DERIVED);
            assertThat(PropertyCatalog.filter(type, PropertyCatalog.View.ALL))
                    .anyMatch(spec -> spec.level() == PropertyCatalog.Level.DERIVED);
        }
    }

    /** 派生属性（UML 中以 / 标注）一律只读，服务端据此拒绝写入。 */
    @Test
    void derivedPropertiesAreReadOnly() {
        for (ElementType type : ElementType.values()) {
            for (PropertyCatalog.PropertySpec spec : PropertyCatalog.forType(type)) {
                if (spec.level() == PropertyCatalog.Level.DERIVED || spec.computed()) {
                    assertThat(spec.editable())
                            .as("%s.%s 为派生/计算属性，必须只读", type.name(), spec.key()).isFalse();
                    assertThat(PropertyCatalog.isEditable(type, spec.key())).isFalse();
                }
            }
        }
        assertThat(PropertyCatalog.isEditable(ElementType.BLOCK, "qualifiedName")).isFalse();
        assertThat(PropertyCatalog.isEditable(ElementType.BLOCK, "id")).isFalse();
        assertThat(PropertyCatalog.isEditable(ElementType.BLOCK, "isEncapsulated")).isTrue();
    }

    /** 关键元属性按规范落在正确的元素类型上。 */
    @Test
    void specificationPropertiesLandOnTheRightTypes() {
        assertThat(keys(ElementType.REQUIREMENT)).contains("id", "text", "name", "visibility", "documentation");
        assertThat(keys(ElementType.BLOCK)).contains("isEncapsulated", "isAbstract", "isLeaf", "isActive");
        assertThat(keys(ElementType.PART)).contains("type", "lowerValue", "upperValue", "aggregation", "isOrdered");
        assertThat(keys(ElementType.PORT)).contains("isBehavior", "isService", "provided", "required");
        assertThat(keys(ElementType.FLOW_PORT)).contains("direction", "isAtomic");
        assertThat(keys(ElementType.TRANSITION)).contains("kind", "effect", "guard", "trigger");
        assertThat(keys(ElementType.MESSAGE)).contains("messageSort", "signature", "connector", "messageKind");
        assertThat(keys(ElementType.USE_CASE)).contains("subject", "extensionPoint");
        assertThat(keys(ElementType.ACTOR)).contains("isAbstract");
    }

    @Test
    void unreachablePropertyIsRejected() {
        assertThat(PropertyCatalog.find(ElementType.PACKAGE, "messageSort")).isNull();
        assertThat(PropertyCatalog.isEditable(ElementType.PACKAGE, "messageSort")).isFalse();
        assertThat(PropertyCatalog.find(ElementType.PACKAGE, "notARealProperty")).isNull();
    }

    /** 元类与构造型引用必须是真引用，并声明目标类型，界面才能收敛候选并定位。 */
    @Test
    void metaclassAndStereotypeReferencesTargetRealElements() {
        PropertyCatalog.PropertySpec extendsMetaclass = PropertyCatalog.find(ElementType.BLOCK, "extendsMetaclass");
        assertThat(extendsMetaclass).isNotNull();
        assertThat(extendsMetaclass.kind()).isEqualTo(PropertyCatalog.ValueKind.REFERENCE);
        assertThat(extendsMetaclass.level()).isEqualTo(PropertyCatalog.Level.STANDARD);
        assertThat(extendsMetaclass.referenceTarget()).isEqualTo("METACLASS");
        assertThat(PropertyCatalog.referencesElement(extendsMetaclass)).isTrue();

        PropertyCatalog.PropertySpec metaclassReference =
                PropertyCatalog.find(ElementType.PROFILE, "metaclassReference");
        assertThat(metaclassReference.referenceTarget()).isEqualTo("METACLASS");
        assertThat(PropertyCatalog.referencesElement(metaclassReference)).isTrue();

        PropertyCatalog.PropertySpec appliedStereotype =
                PropertyCatalog.find(ElementType.BLOCK, "appliedStereotype");
        assertThat(appliedStereotype.referenceTarget()).isEqualTo("STEREOTYPE");
        assertThat(PropertyCatalog.referencesElement(appliedStereotype)).isTrue();

        // 指向元模型或表达式的引用仍是自由文本
        assertThat(PropertyCatalog.referencesElement(
                PropertyCatalog.find(ElementType.PROFILE, "metamodelReference"))).isFalse();
        assertThat(PropertyCatalog.referencesElement(
                PropertyCatalog.find(ElementType.BLOCK, "nameExpression"))).isFalse();
    }

    @Test
    void describeExposesCatalogForEveryTypeWithCounts() {
        Map<String, Object> described = PropertyCatalog.describe();
        assertThat(described.get("specification")).isEqualTo("UML 2.5.1 + SysML 1.6");
        assertThat((Integer) described.get("totalDefinitions")).isGreaterThan(300);
        assertThat((List<?>) described.get("levels")).hasSize(3);
        assertThat((List<?>) described.get("metaclasses")).isNotEmpty();

        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> types = (Map<String, Map<String, Object>>) described.get("types");
        assertThat(types).hasSize(ElementType.values().length);
        for (ElementType type : ElementType.values()) {
            Map<String, Object> row = types.get(type.name());
            assertThat(row).as("%s 必须下发", type.name()).isNotNull();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> properties = (List<Map<String, Object>>) row.get("properties");
            assertThat(properties).isNotEmpty();
            assertThat(properties.get(0)).containsKeys("key", "label", "metaclass", "spec", "level", "editable");
            @SuppressWarnings("unchecked")
            Map<String, Integer> counts = (Map<String, Integer>) row.get("counts");
            assertThat(counts.get("ALL")).isEqualTo(properties.size());
        }
    }

    private static Set<String> keys(ElementType type) {
        Set<String> result = new HashSet<>();
        for (PropertyCatalog.PropertySpec spec : PropertyCatalog.forType(type)) {
            result.add(spec.key());
        }
        return result;
    }
}
