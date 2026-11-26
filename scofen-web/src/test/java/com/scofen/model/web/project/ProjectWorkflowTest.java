package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.web.auth.AuthService;
import com.scofen.model.web.auth.AuthService.Principal;
import com.scofen.model.web.rbac.BuiltinRoles;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ProjectWorkflowTest {
    private final ProjectRecords records = new ProjectRecords(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class));
    private final ProjectWorkflow workflow = new ProjectWorkflow(records);
    private final WorkspaceDirectory directory = new WorkspaceDirectory();
    private final ProjectAccess access = new ProjectAccess(directory, records);
    private final RequirementImport imports = new RequirementImport();
    private final Principal owner = user("owner", BuiltinRoles.EDITOR_PERMISSIONS);
    private final Principal visitor = user("reader", BuiltinRoles.VIEWER_PERMISSIONS);

    @Test
    void membersCanReviewWithoutEditingAndReceivesOnlyTheirProjects() throws Exception {
        var a = directory.addProject("personal", "Project A", "", owner.username()).id();
        var b = directory.addProject("team", "Project B", "", owner.username()).id();
        assertThat(access.grant(WorkspaceDirectory.CURRENT_PROJECT_ID, visitor).canView()).isFalse();
        assertThat(access.grant(a, visitor).canView()).isFalse();
        access.changeMember(a, owner, visitor.username(), "reviewer");
        assertThat(access.grant(a, visitor).canReview()).isTrue();
        assertThat(access.grant(a, visitor).canEdit()).isFalse();
        assertThat(access.grant(b, visitor).canView()).isFalse();

        var auth = mock(AuthService.class);
        when(auth.parseOrNull("reviewer")).thenReturn(visitor);
        when(auth.parseOrNull("owner")).thenReturn(owner);
        var sockets = new PatchWebSocketHandler(auth, access);
        var first = session(a, "reviewer");
        var second = session(b, "owner");
        sockets.afterConnectionEstablished(first);
        sockets.afterConnectionEstablished(second);
        clearInvocations(first, second);

        var broker = new PatchBroker(sockets);
        var executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker.forProject(a));
        create(executor, "root", "Package", "Project A", "");
        verify(first).sendMessage(any(TextMessage.class));
        verify(second, never()).sendMessage(any());

        access.changeMember(a, owner, visitor.username(), null);
        assertThat(access.grant(a, visitor).canView()).isFalse();
        sockets.projectRecordsChanged(a);
        verify(first).close(any(CloseStatus.class));
        verify(second, never()).sendMessage(any());
    }

    @Test
    void importsExcelAndCsvThenUpdatesOneHierarchyInOneRevision() throws Exception {
        var csv = new MockMultipartFile("file", "r.csv", "text/csv", "\ufeffID,Name\r\nR1,\"Test, A\"".getBytes(StandardCharsets.UTF_8));
        assertThat(imports.read(csv).rows()).containsExactly(List.of("R1", "Test, A"));
        var bytes = new ByteArrayOutputStream();
        try (var workbook = new XSSFWorkbook()) {
            var sheet = workbook.createSheet();
            sheet.createRow(0).createCell(0).setCellValue("ID");
            sheet.createRow(1).createCell(0).setCellValue("R1");
            workbook.write(bytes);
        }
        assertThat(imports.read(new MockMultipartFile("file", "r.xlsx", "application/octet-stream", bytes.toByteArray())).rows())
                .containsExactly(List.of("R1"));

        var model = model();
        var rows = List.of(row(2, "R2", "R1", "Child", "A"), row(3, "R1", "", "Parent", "B"));
        var input = input(model, rows);
        assertThat(imports.preview(input, model.snapshot()).creates()).isEqualTo(2);
        assertThat(imports.commit(input, model, "test", "create").revision()).isEqualTo(input.baseRevision() + 1);
        var first = model.snapshot().elements().stream().filter(element -> element.name().equals("Parent")).findFirst().orElseThrow();
        var child = model.snapshot().elements().stream().filter(element -> element.name().equals("Child")).findFirst().orElseThrow();
        assertThat(child.ownerId()).isEqualTo(first.id());
        assertThat(child.properties()).containsEntry("id", "R2").containsEntry("text", "A");
        assertThat(imports.commit(input(model, rows), model, "test", "repeat").unchanged()).isEqualTo(2);
        assertThatThrownBy(() -> imports.commit(input, model, "test", "stale")).isInstanceOf(RevisionConflictException.class);
        var subset = input(model, List.of(new RequirementImport.InputRow(2, "R2", null, "Child", null, null)));
        assertThat(imports.commit(subset, model, "test", "new-mapping").unchanged()).isEqualTo(1);

        var update = input(model, List.of(row(2, "R2", "", "Child", "Updated")));
        assertThat(imports.commit(update, model, "test", "update").updates()).isEqualTo(1);
        assertThat(model.repository().findElement(child.id()).orElseThrow().ownerId()).isEqualTo("root");
        model.undo("test");
        assertThat(model.repository().findElement(child.id()).orElseThrow()).isEqualTo(child);
        var invalid = input(model, List.of(row(2, "X", "Y", "X", ""), row(3, "Y", "X", "Y", ""), row(4, "V", "", "V", "")));
        assertThat(imports.commit(invalid, model, "test", "invalid").errors()).isEqualTo(2);
        assertThat(model.revision()).isEqualTo(invalid.baseRevision());
        assertThat(model.snapshot().elements()).extracting(ModelElement::name).doesNotContain("V");
    }

    @Test
    void evidenceAndResolvedReviewsAreFrozenWithTheBaseline() {
        var model = model();
        create(model, "req", "Requirement", "Requirement", "root");
        create(model, "test", "TestCase", "Test", "root");
        create(model, "block", "Block", "Design", "root");
        model.executeBatch("test", model.revision(), "links", List.of(
                link("r1", "satisfy", "block", "req"), link("r2", "verify", "test", "req")));
        assertThat(ProjectAnalysis.trace(model.snapshot(), "req", "both", 3, Set.of("verify", "satisfy")).nodes())
                .extracting(node -> node.target().id()).containsExactlyInAnyOrder("block", "test");
        var review = workflow.review("p", model.snapshot(), owner, "element", "req", "Confirm test method");
        workflow.updateReview("p", review.id(), visitor, "reply", "Confirmed");
        workflow.updateReview("p", review.id(), owner, "resolve", null);
        workflow.recordEvidence("p", model.snapshot(), owner, new ProjectWorkflow.Evidence(model.revision(), "req", "test", "pass", "EV-1", null, null));
        var original = workflow.publish("p", model.snapshot(), owner, "A", "Review complete");

        execute(model, "RENAME_ELEMENT", Map.of("id", "req", "name", "New name"));
        workflow.updateReview("p", review.id(), visitor, "reopen", null);
        var saved = workflow.baseline("p", original.id());
        assertThat(saved.reviews().get(0).status()).isEqualTo("resolved");
        assertThat(saved.evidence()).extracting(ProjectWorkflow.Evidence::source).containsExactly("EV-1");
        assertThat(ProjectAnalysis.diff(saved.snapshot(), model.snapshot())).anyMatch(change -> change.id().equals("req")
                && change.field().equals("name") && change.after().equals("New name"));
        long previous = model.revision();
        model.restoreSnapshot("test", previous, "restore", saved.snapshot());
        assertThat(model.revision()).isEqualTo(previous + 1);
        assertThat(model.repository().findElement("req").orElseThrow().name()).isEqualTo("Requirement");
    }

    @Test
    void snapshotUndoDoesNotOverwriteAnotherSessionsEdit() {
        var model = model();
        imports.commit(input(model, List.of(row(2, "R1", "", "Requirement", ""))), model, "importer", "load");
        execute(model, "RENAME_ELEMENT", Map.of("id", "root", "name", "Concurrent edit"));
        long revision = model.revision();
        assertThatThrownBy(() -> model.undo("importer")).isInstanceOf(ValidationException.class);
        assertThat(model.revision()).isEqualTo(revision);
        assertThat(model.repository().findElement("root").orElseThrow().name()).isEqualTo("Concurrent edit");
        assertThat(model.undoDepth("importer")).isEqualTo(1);
    }

    private static CommandExecutor model() {
        var result = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), patch -> {});
        create(result, "root", "Package", "Project", "");
        return result;
    }

    private static void create(CommandExecutor model, String id, String type, String name, String owner) {
        execute(model, "CREATE_ELEMENT", Map.of("id", id, "type", type, "name", name, "ownerId", owner));
    }

    private static void execute(CommandExecutor model, String type, Map<String, Object> payload) {
        model.execute("test", Command.of(type, model.revision(), UUID.randomUUID().toString(), payload));
    }

    private static RequirementImport.Input input(CommandExecutor model, List<RequirementImport.InputRow> rows) {
        return new RequirementImport.Input(model.revision(), "customer", "root", rows);
    }

    private static RequirementImport.InputRow row(int line, String id, String parent, String name, String text) {
        return new RequirementImport.InputRow(line, id, parent, name, text, "draft");
    }

    private static Principal user(String id, Set<String> permissions) {
        return new Principal(id, id, false, Set.of(), permissions);
    }

    private static WebSocketSession session(String project, String token) {
        var channel = mock(WebSocketSession.class);
        when(channel.getId()).thenReturn(UUID.randomUUID().toString());
        when(channel.isOpen()).thenReturn(true);
        when(channel.getUri()).thenReturn(URI.create("ws://localhost/ws/patches?project=" + project + "&token=" + token));
        return channel;
    }

    private static Command link(String id, String type, String source, String target) {
        return RequirementImport.command("CREATE_RELATIONSHIP", Map.of("id", id, "type", type, "sourceId", source, "targetId", target));
    }
}
