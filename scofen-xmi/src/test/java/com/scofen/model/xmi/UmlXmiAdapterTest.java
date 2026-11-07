package com.scofen.model.xmi;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * XMI 语义往返 + 布局侧车。
 *
 * <p>往返的验收标准是「语义等价」而不是「字节相同」：元素与关系的
 * id / 类型 / 名称 / 归属 / 构造型 / 扩展属性都应当原样还原。</p>
 */
class UmlXmiAdapterTest {

    private final UmlXmiAdapter adapter = new UmlXmiAdapter();

    private ModelSnapshot sample() {
        ModelElement root = new ModelElement("model-root", "Package", "车载动力系统工程模型",
                List.of("model"), "", "顶层模型", Map.of(), "xmi-root", Map.of());
        ModelElement pkg = new ModelElement("pkg-1", "Package", "车载动力系统",
                List.of("package"), "model-root", "", Map.of(), null,
                Map.of("extendsMetaclass", "mc-PACKAGE"));
        ModelElement vcu = new ModelElement("e-vcu", "Block", "整车控制器",
                List.of("block"), "pkg-1", "核心控制器", Map.of("tier", "A"),
                null, Map.of("extendsMetaclass", "mc-SYSML_BLOCK"));
        ModelElement requirement = new ModelElement("r-range", "Requirement", "续航里程 ≥ 500km",
                List.of("requirement"), "pkg-1", "", Map.of(), null, Map.of());
        ModelElement port = new ModelElement("port-can", "Port", "CAN 接口",
                List.of("port"), "e-vcu", "", Map.of(), null, Map.of());
        Relationship satisfy = new Relationship("rel-1", "satisfy", "e-vcu", "r-range",
                "满足", "", List.of("satisfy"), "model-root", Map.of(), Map.of());
        Diagram pkgDiagram = new Diagram("d-pkg", DiagramKind.PKG, "包图", "pkg-1",
                List.of("pkg-1", "e-vcu"), List.of());
        Notation notation = new Notation("n-d-pkg-e-vcu", "d-pkg", "e-vcu",
                120, 240, 168, 84, Map.of("shape", "round"));
        return new ModelSnapshot(42L,
                List.of(root, pkg, vcu, requirement, port),
                List.of(satisfy),
                List.of(pkgDiagram),
                List.of(notation));
    }

    @Test
    void exportProducesWellFormedUmlXmi() {
        ExchangeBundle bundle = adapter.exportModel(sample());
        assertThat(bundle.format()).isEqualTo(ExchangeFormat.XMI_251);
        assertThat(bundle.semantic()).contains("xmi:XMI").contains("uml:Package").contains("uml:Association");
        assertThat(bundle.semantic()).contains("scofen:type=\"Block\"");
        assertThat(bundle.semantic()).contains("scofen:relationType=\"satisfy\"");
        assertThat(bundle.diagramKinds()).contains(DiagramKind.PKG);
    }

    @Test
    void semanticRoundTripKeepsEveryElement() {
        ModelSnapshot original = sample();
        ModelSnapshot back = adapter.importModel(adapter.exportModel(original));

        assertThat(back.elements()).hasSameSizeAs(original.elements());
        for (ModelElement before : original.elements()) {
            ModelElement after = back.elements().stream()
                    .filter(element -> element.id().equals(before.id()))
                    .findFirst().orElseThrow(() -> new AssertionError("丢失元素：" + before.id()));
            assertThat(after.type()).as("类型 %s", before.id()).isEqualTo(before.type());
            assertThat(after.name()).as("名称 %s", before.id()).isEqualTo(before.name());
            assertThat(after.ownerId()).as("归属 %s", before.id()).isEqualTo(before.ownerId());
            assertThat(after.stereotypes()).as("构造型 %s", before.id()).isEqualTo(before.stereotypes());
            assertThat(after.documentation()).as("文档 %s", before.id()).isEqualTo(before.documentation());
            assertThat(after.taggedValues()).as("标记值 %s", before.id()).isEqualTo(before.taggedValues());
            assertThat(after.properties()).as("扩展属性 %s", before.id()).isEqualTo(before.properties());
        }
    }

    @Test
    void semanticRoundTripKeepsRelations() {
        ModelSnapshot original = sample();
        ModelSnapshot back = adapter.importModel(adapter.exportModel(original));

        assertThat(back.relationships()).hasSize(1);
        Relationship after = back.relationships().get(0);
        assertThat(after.id()).isEqualTo("rel-1");
        assertThat(after.type()).isEqualTo("satisfy");
        assertThat(after.sourceId()).isEqualTo("e-vcu");
        assertThat(after.targetId()).isEqualTo("r-range");
        assertThat(after.name()).isEqualTo("满足");
        assertThat(after.stereotypes()).containsExactly("satisfy");
    }

    @Test
    void sidecarCarriesDiagramsAndNotations() {
        ModelSnapshot original = sample();
        ExchangeBundle bundle = adapter.exportModel(original);
        ModelSnapshot back = adapter.importModel(bundle);

        assertThat(back.diagrams()).hasSize(1);
        Diagram diagram = back.diagrams().get(0);
        assertThat(diagram.id()).isEqualTo("d-pkg");
        assertThat(diagram.kind()).isEqualTo(DiagramKind.PKG);
        assertThat(diagram.name()).isEqualTo("包图");
        assertThat(diagram.ownerId()).isEqualTo("pkg-1");
        assertThat(diagram.elementIds()).containsExactly("pkg-1", "e-vcu");

        assertThat(back.notations()).hasSize(1);
        Notation notation = back.notations().get(0);
        assertThat(notation.diagramId()).isEqualTo("d-pkg");
        assertThat(notation.elementId()).isEqualTo("e-vcu");
        assertThat(notation.x()).isEqualTo(120d);
        assertThat(notation.y()).isEqualTo(240d);
        assertThat(notation.style()).containsEntry("shape", "round");
    }

    @Test
    void importWithoutSidecarStillKeepsSemantics() {
        ModelSnapshot original = sample();
        ExchangeBundle bundle = adapter.exportModel(original);
        ModelSnapshot back = adapter.importModel(
                new ExchangeBundle(ExchangeFormat.XMI_251, bundle.semantic(), null, List.of()));

        assertThat(back.elements()).hasSameSizeAs(original.elements());
        assertThat(back.relationships()).hasSize(1);
        // 没有侧车就没有九图：这是设计上的取舍，界面需要提示用户。
        assertThat(back.diagrams()).isEmpty();
        assertThat(back.notations()).isEmpty();
    }

    @Test
    void malformedXmlIsRejected() {
        assertThatThrownBy(() -> adapter.importModel(
                new ExchangeBundle(ExchangeFormat.XMI_251, "<xmi:XMI><unclosed>", null, List.of())))
                .isInstanceOf(ExchangeException.class);
    }

    @Test
    void externalEntitiesAreNotResolved() {
        // XXE 防护：带外部实体的载荷必须被拒，而不是去读本地文件。
        String hostile = """
                <?xml version="1.0"?>
                <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
                <xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
                         xmlns:uml="http://www.omg.org/spec/UML/20131001">
                  <uml:Model xmi:id="m" name="&xxe;"/>
                </xmi:XMI>
                """;
        assertThatThrownBy(() -> adapter.importModel(
                new ExchangeBundle(ExchangeFormat.XMI_251, hostile, null, List.of())))
                .isInstanceOf(ExchangeException.class);
    }
}
