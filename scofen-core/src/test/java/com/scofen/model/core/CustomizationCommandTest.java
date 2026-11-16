package com.scofen.model.core;

import com.scofen.model.metamodel.Customization;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.NotationStyle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 元模型定制的服务端契约：自定义图类型（扩展图）与构造型标签定义。
 *
 * <p>覆盖三件事：</p>
 * <ol>
 *   <li>定制属性走 {@code custom:} 例外通道：白名单外键、越界值、非法类型一律 400；</li>
 *   <li>自定义图类型真的收紧图的允许集合——不在白名单里的元素进不了图，服务端拒绝；</li>
 *   <li>定义元素与图引用随快照往返，撤销一步即可复原。</li>
 * </ol>
 */
class CustomizationCommandTest {

    private static final String SESSION = "custom-session";

    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), patch -> { });
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "cls", "type", "Class", "name", "算法", "ownerId", "pkg"));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION,
                Command.of(type, executor.revision(), "custom-" + (++counter), payload));
    }

    private ModelElement element(String id) {
        return executor.snapshot().elements().stream()
                .filter(e -> e.id().equals(id)).findFirst().orElseThrow();
    }

    private Diagram diagram(String id) {
        return executor.snapshot().diagrams().stream()
                .filter(d -> d.id().equals(id)).findFirst().orElseThrow();
    }

    /** 建一条自定义图类型定义：基底 bdd，白名单只留 Block。 */
    private void createDiagramType(String id, String name) {
        cmd("CREATE_ELEMENT", Map.of("id", id, "type", "DiagramType", "name", name, "ownerId", "pkg"));
        cmd("UPDATE_PROPERTY", Map.of("id", id, "key", Customization.DIAGRAM_BASE_KIND, "value", "bdd"));
        cmd("UPDATE_PROPERTY", Map.of("id", id, "key", Customization.DIAGRAM_ALLOWED_TYPES,
                "value", List.of("Block")));
        cmd("UPDATE_PROPERTY", Map.of("id", id, "key", Customization.DIAGRAM_ALLOWED_RELATIONSHIPS,
                "value", List.of("association")));
    }

    @Test
    void diagramTypeDefinitionIsStoredAsRealElement() {
        createDiagramType("dt-1", "接口图");

        ModelElement definition = element("dt-1");
        assertThat(definition.type()).isEqualTo("DiagramType");
        assertThat(definition.ownerId()).isEqualTo("pkg");
        assertThat(definition.properties())
                .containsEntry(Customization.DIAGRAM_BASE_KIND, "bdd");
        assertThat(Customization.stringList(
                definition.properties().get(Customization.DIAGRAM_ALLOWED_TYPES)))
                .containsExactly("Block");
    }

    @Test
    void customDiagramKeepsItsTypeReferenceAcrossSnapshot() {
        createDiagramType("dt-1", "接口图");
        cmd("CREATE_DIAGRAM", Map.of("id", "d-1", "kind", "bdd", "name", "接口图示例",
                "ownerId", "pkg", "elementIds", List.of(), "customTypeId", "dt-1"));

        assertThat(diagram("d-1").customTypeId()).isEqualTo("dt-1");
        // 快照是权威载体：重新读一遍（模拟落库回载）后引用仍在。
        ModelSnapshot snapshot = executor.snapshot();
        assertThat(snapshot.diagrams()).anySatisfy(d -> {
            assertThat(d.id()).isEqualTo("d-1");
            assertThat(d.customTypeId()).isEqualTo("dt-1");
        });
    }

    @Test
    void customDiagramRejectsElementsOutsideWhitelist() {
        createDiagramType("dt-1", "接口图");
        cmd("CREATE_DIAGRAM", Map.of("id", "d-1", "kind", "bdd", "name", "接口图示例",
                "ownerId", "pkg", "elementIds", List.of(), "customTypeId", "dt-1"));

        // 白名单里只有 Block：放 Class 进图必须被服务端拒绝。
        assertThatThrownBy(() -> cmd("ADD_TO_DIAGRAM", Map.of("diagramId", "d-1", "elementId", "cls")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("CLASS")
                .hasMessageContaining("接口图");

        // Block 可以进。
        cmd("ADD_TO_DIAGRAM", Map.of("diagramId", "d-1", "elementId", "blk"));
        assertThat(diagram("d-1").elementIds()).contains("blk");
    }

    @Test
    void createDiagramRejectsUnknownCustomType() {
        assertThatThrownBy(() -> cmd("CREATE_DIAGRAM", Map.of("id", "d-1", "kind", "bdd",
                "name", "坏的图", "ownerId", "pkg", "elementIds", List.of(), "customTypeId", "dt-missing")))
                .isInstanceOf(ValidationException.class);
    }

    @Test
    void customPropertiesOutsideDictionaryAreRejected() {
        cmd("CREATE_ELEMENT", Map.of("id", "dt-1", "type", "DiagramType", "name", "接口图", "ownerId", "pkg"));

        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "dt-1",
                "key", "custom:notInDictionary", "value", "x")))
                .isInstanceOf(ValidationException.class);
    }

    @Test
    void customPropertyValuesAreValidated() {
        cmd("CREATE_ELEMENT", Map.of("id", "dt-1", "type", "DiagramType", "name", "接口图", "ownerId", "pkg"));

        // 基底不是规范图 → 拒绝。
        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "dt-1",
                "key", Customization.DIAGRAM_BASE_KIND, "value", "not-a-kind")))
                .isInstanceOf(ValidationException.class);
        // 白名单里的元素类型不存在 → 拒绝。
        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "dt-1",
                "key", Customization.DIAGRAM_ALLOWED_TYPES, "value", List.of("NoSuchType"))))
                .isInstanceOf(ValidationException.class);
        // 标签类型不在枚举内 → 拒绝。
        cmd("CREATE_ELEMENT", Map.of("id", "st-1", "type", "Stereotype", "name", "安全关键", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "tag-1", "type", "TagDefinition", "name", "等级",
                "ownerId", "st-1"));
        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "tag-1",
                "key", Customization.TAG_TYPE, "value", "DATETIME")))
                .isInstanceOf(ValidationException.class);
        // 合法值放行。
        cmd("UPDATE_PROPERTY", Map.of("id", "tag-1", "key", Customization.TAG_TYPE, "value", "ENUM"));
        assertThat(element("tag-1").properties()).containsEntry(Customization.TAG_TYPE, "ENUM");
    }

    @Test
    void definitionElementIsUndoneInOneStep() {
        createDiagramType("dt-1", "接口图");
        assertThat(executor.snapshot().elements()).anyMatch(e -> e.id().equals("dt-1"));

        // 撤销栈顶：三次属性写入 + 一次建定义元素，逐一退掉后定义元素消失。
        for (int i = 0; i < 4; i++) {
            executor.undo(SESSION);
        }
        assertThat(executor.snapshot().elements()).noneMatch(e -> e.id().equals("dt-1"));
    }

    @Test
    void tagDefinitionIsNestedUnderStereotype() {
        cmd("CREATE_ELEMENT", Map.of("id", "st-1", "type", "Stereotype", "name", "安全关键", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "tag-1", "type", "TagDefinition", "name", "等级",
                "ownerId", "st-1"));

        assertThat(element("tag-1").ownerId()).isEqualTo("st-1");
        assertThat(element("st-1").type()).isEqualTo("Stereotype");
    }

    @Test
    void customTitleRespectsLengthLimit() {
        cmd("CREATE_ELEMENT", Map.of("id", "dt-1", "type", "DiagramType", "name", "接口图", "ownerId", "pkg"));
        String tooLong = "x".repeat(NotationStyle.FRAME_TITLE_MAX + 1);

        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "dt-1",
                "key", Customization.DIAGRAM_FRAME_TITLE, "value", tooLong)))
                .isInstanceOf(ValidationException.class);
    }
}
