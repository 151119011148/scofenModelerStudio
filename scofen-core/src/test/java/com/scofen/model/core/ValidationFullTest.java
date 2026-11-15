package com.scofen.model.core;

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

/** 全量校验：结构 ERROR + 需求追溯 WARNING 的方向、等价建模与计数契约。 */
class ValidationFullTest {

    private final ValidationEngine engine = new ValidationEngine();

    private static ModelElement el(String id, String type, String name, String owner) {
        return ModelElement.of(id, type, name, owner);
    }

    @Test
    void requirementCoverageFollowsSatisfyVerifyDirection() {
        ModelElement pkg = el("pkg", "Package", "系统", "");
        ModelElement r1 = el("r1", "Requirement", "续航需求", "pkg");
        ModelElement r2 = el("r2", "Requirement", "未覆盖需求", "pkg");
        ModelElement block = el("b1", "Block", "整车控制器", "pkg");
        // SysML 方向：source=满足/验证元素，target=需求。
        Relationship satisfy = Relationship.of("rel-s", "satisfy", "b1", "r1");
        Relationship verify = Relationship.of("rel-v", "verify", "b1", "r1");
        ModelSnapshot snapshot = new ModelSnapshot(1, List.of(pkg, r1, r2, block),
                List.of(satisfy, verify), List.of(), List.of());

        List<ValidationIssue> issues = engine.validateFull(snapshot);

        assertThat(issues).noneMatch(i -> i.targetId().equals("r1"));
        assertThat(issues).filteredOn(i -> i.code().equals("REQ_NOT_SATISFIED"))
                .extracting(ValidationIssue::targetId).containsExactly("r2");
        assertThat(issues).filteredOn(i -> i.code().equals("REQ_NOT_VERIFIED"))
                .extracting(ValidationIssue::targetId).containsExactly("r2");
        assertThat(issues).allMatch(i -> i.severity().equals(ValidationIssue.WARNING));
    }

    @Test
    void coverageAlsoHonorsPropertiesAndTestCase() {
        ModelElement pkg = el("pkg", "Package", "系统", "");
        ModelElement r1 = new ModelElement("r1", "Requirement", "属性覆盖", List.of(), "pkg", "",
                Map.of(), null, Map.of("satisfiedBy", List.of("b1"), "verifiedBy", List.of("tc1")));
        ModelElement block = el("b1", "Block", "块", "pkg");
        ModelElement tc = new ModelElement("tc1", "TestCase", "用例", List.of(), "pkg", "",
                Map.of(), null, Map.of("verifies", List.of("r1")));
        ModelSnapshot snapshot = new ModelSnapshot(1, List.of(pkg, r1, block, tc),
                List.of(), List.of(), List.of());

        assertThat(engine.validateFull(snapshot)).isEmpty();
    }

    @Test
    void structuralProblemsAreErrors() {
        ModelElement pkg = el("pkg", "Package", "系统", "");
        ModelElement a = el("a", "Block", "同名", "pkg");
        ModelElement b = el("b", "Block", "同名", "pkg");
        Relationship dangling = Relationship.of("rel-x", "dependency", "a", "ghost");
        Diagram diagram = Diagram.of("d1", DiagramKind.BDD, "模块图", List.of("a", "ghost"));
        Notation notation = new Notation("n1", "d1", "ghost", 0, 0, 120, 60, Map.of());
        ModelSnapshot snapshot = new ModelSnapshot(1, List.of(pkg, a, b),
                List.of(dangling), List.of(diagram), List.of(notation));

        List<ValidationIssue> issues = engine.validateFull(snapshot);

        assertThat(issues).filteredOn(i -> i.code().equals("DUPLICATE_NAME"))
                .extracting(ValidationIssue::targetId).containsExactlyInAnyOrder("a", "b");
        assertThat(issues).anyMatch(i -> i.code().equals("DANGLING_REL_TARGET")
                && i.targetType().equals("element") && i.targetId().equals("a"));
        assertThat(issues).anyMatch(i -> i.code().equals("DANGLING_DIAGRAM_ELEMENT")
                && i.targetType().equals("diagram") && i.targetId().equals("d1"));
        assertThat(issues).anyMatch(i -> i.code().equals("DANGLING_NOTATION_ELEMENT"));
        assertThat(issues).allMatch(i -> i.severity().equals(ValidationIssue.ERROR));
    }

    @Test
    void coverageListsSourceElements() {
        ModelElement pkg = el("pkg", "Package", "系统", "");
        ModelElement r1 = el("r1", "Requirement", "续航需求", "pkg");
        ModelElement block = el("b1", "Block", "整车控制器", "pkg");
        ModelElement tc = el("tc1", "TestCase", "续航试验", "pkg");
        Relationship satisfy = Relationship.of("rel-s", "satisfy", "b1", "r1");
        Relationship verify = Relationship.of("rel-v", "verify", "tc1", "r1");
        ModelSnapshot snapshot = new ModelSnapshot(1, List.of(pkg, r1, block, tc),
                List.of(satisfy, verify), List.of(), List.of());

        List<RequirementCoverage> coverage = engine.requirementCoverage(snapshot);

        assertThat(coverage).hasSize(1);
        RequirementCoverage item = coverage.get(0);
        assertThat(item.satisfied()).isTrue();
        assertThat(item.verified()).isTrue();
        assertThat(item.satisfiedBy()).extracting(RequirementCoverage.CoverageRef::id).containsExactly("b1");
        assertThat(item.satisfiedBy()).extracting(RequirementCoverage.CoverageRef::name).containsExactly("整车控制器");
        assertThat(item.verifiedBy()).extracting(RequirementCoverage.CoverageRef::id).containsExactly("tc1");
    }
}