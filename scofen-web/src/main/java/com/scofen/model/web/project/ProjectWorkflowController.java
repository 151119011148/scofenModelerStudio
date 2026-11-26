package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.ValidationException;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.RelationshipType;
import com.scofen.model.web.auth.AuthController;
import com.scofen.model.web.auth.AuthService.Principal;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.rbac.RequiresPermission;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/project")
@RequiresPermission(Permission.MODEL_VIEW)
public final class ProjectWorkflowController {
    private record Context(String project, Principal principal, ProjectAccess.Grant grant, String session) {}
    public record MemberRequest(String username, String role) {}
    public record ReviewRequest(String type, String id, String text, long revision) {}
    public record ReplyRequest(String operation, String text) {}
    public record PublishRequest(String name, String notes, long revision) {}
    public record RestoreRequest(long revision, String requestId) {}
    public record Link(String type, String sourceId, String targetId, String removeId) {}
    public record Links(long revision, String requestId, List<Link> links) {}

    private final ProjectAccess access;
    private final ProjectRegistry projects;
    private final ProjectWorkflow workflow;
    private final RequirementImport imports;
    private final PatchWebSocketHandler sockets;

    public ProjectWorkflowController(ProjectAccess access, ProjectRegistry projects, ProjectWorkflow workflow,
            RequirementImport imports, PatchWebSocketHandler sockets) {
        this.access = access;
        this.projects = projects;
        this.workflow = workflow;
        this.imports = imports;
        this.sockets = sockets;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview(HttpServletRequest request) {
        var context = context(request);
        String project = context.project();
        return Map.of("grant", context.grant(), "views", workflow.views(project), "reviews", workflow.reviews(project),
                "baselines", workflow.baselineList(project), "restorations", workflow.restorations(project),
                "members", context.grant().canManage() ? access.members(project) : List.of());
    }

    @PutMapping("/members")
    public void changeMember(HttpServletRequest request, @RequestBody MemberRequest input) {
        var context = context(request);
        access.changeMember(context.project(), context.principal(), input.username(), input.role());
        sockets.projectRecordsChanged(context.project());
    }

    @PutMapping("/views")
    public ProjectWorkflow.View saveView(HttpServletRequest request, @RequestBody ProjectWorkflow.View input) {
        var context = context(request);
        require(context.grant().canEdit());
        var result = workflow.saveView(context.project(), input);
        sockets.projectRecordsChanged(context.project());
        return result;
    }

    @DeleteMapping("/views/{id}")
    public void deleteView(HttpServletRequest request, @PathVariable String id) {
        var context = context(request);
        require(context.grant().canEdit());
        workflow.deleteView(context.project(), id);
        sockets.projectRecordsChanged(context.project());
    }

    @PostMapping("/import/file")
    public RequirementImport.FileRows upload(HttpServletRequest request, @RequestParam("file") MultipartFile file) {
        require(context(request).grant().canImport());
        return imports.read(file);
    }

    @PostMapping("/import/preview")
    public RequirementImport.Preview preview(HttpServletRequest request, @RequestBody RequirementImport.Input input) {
        var context = context(request);
        require(context.grant().canImport());
        return imports.preview(input, snapshot(context));
    }

    @PostMapping("/import/commit")
    public RequirementImport.Preview importRequirements(HttpServletRequest request, @RequestBody RequirementImport.Input input) {
        var context = context(request);
        require(context.grant().canImport());
        return imports.commit(input, projects.resolve(context.project()), context.session(), "requirements-" + UUID.randomUUID());
    }

    @GetMapping("/trace")
    public ProjectAnalysis.Trace trace(HttpServletRequest request, @RequestParam String id,
            @RequestParam(defaultValue = "both") String direction, @RequestParam(defaultValue = "3") int depth,
            @RequestParam(required = false) Set<String> types) {
        return ProjectAnalysis.trace(snapshot(context(request)), id, direction, depth, types == null ? Set.of() : types);
    }

    @PostMapping("/matrix")
    public Map<String, Long> matrix(HttpServletRequest request, @RequestBody Links input) {
        var context = context(request);
        require(context.grant().canEdit());
        if (input.links() == null || input.links().isEmpty() || input.links().size() > 500) {
            throw new ValidationException("请选择 1 至 500 个关系");
        }
        List<Command> operations = new ArrayList<>();
        for (Link link : input.links()) {
            if (link == null) throw new ValidationException("请选择有效的关系");
            if (link.removeId() != null && !link.removeId().isBlank()) {
                require(context.principal().hasPermission(Permission.MODEL_DELETE.code()));
                operations.add(RequirementImport.command("DELETE_RELATIONSHIP", Map.of("id", link.removeId())));
            } else {
                var type = RelationshipType.fromAny(link.type()).orElseThrow(() -> new ValidationException("未知关系类型"));
                if (link.sourceId() == null || link.targetId() == null) throw new ValidationException("缺少关系端点");
                operations.add(RequirementImport.command("CREATE_RELATIONSHIP", Map.of("id", "r-" + UUID.randomUUID(),
                        "sourceId", link.sourceId(), "targetId", link.targetId(), "type", type.code())));
            }
        }
        var patch = projects.resolve(context.project()).executeBatch(context.session(), input.revision(),
                "matrix-" + ProjectWorkflow.uuid(input.requestId()), operations);
        return Map.of("revision", patch.revision());
    }

    @PostMapping("/reviews")
    public ProjectWorkflow.Review review(HttpServletRequest request, @RequestBody ReviewRequest input) {
        var context = context(request);
        require(context.grant().canReview());
        ModelSnapshot model = snapshot(context);
        ProjectWorkflow.checkRevision(model, input.revision());
        var result = workflow.review(context.project(), model, context.principal(), input.type(), input.id(), input.text());
        sockets.projectRecordsChanged(context.project());
        return result;
    }

    @PostMapping("/reviews/{id}")
    public ProjectWorkflow.Review reply(HttpServletRequest request, @PathVariable String id, @RequestBody ReplyRequest input) {
        var context = context(request);
        require(context.grant().canReview());
        var review = workflow.updateReview(context.project(), id, context.principal(), input.operation(), input.text());
        sockets.projectRecordsChanged(context.project());
        return review;
    }

    @PutMapping("/evidence")
    public ProjectWorkflow.Evidence recordEvidence(HttpServletRequest request, @RequestBody ProjectWorkflow.Evidence input) {
        var context = context(request);
        require(context.grant().canReview());
        var evidence = workflow.recordEvidence(context.project(), snapshot(context), context.principal(), input);
        sockets.projectRecordsChanged(context.project());
        return evidence;
    }

    @PostMapping("/baselines")
    public ProjectWorkflow.BaselineInfo publish(HttpServletRequest request, @RequestBody PublishRequest input) {
        var context = context(request);
        require(context.grant().canManage() && context.grant().canEdit());
        ModelSnapshot model = snapshot(context);
        ProjectWorkflow.checkRevision(model, input.revision());
        var baseline = workflow.publish(context.project(), model, context.principal(), input.name(), input.notes());
        sockets.projectRecordsChanged(context.project());
        return baseline;
    }

    @GetMapping("/baselines/{id}")
    public Map<String, Object> baseline(HttpServletRequest request, @PathVariable String id) {
        var context = context(request);
        var baseline = workflow.baseline(context.project(), id);
        var info = baseline.info();
        var changes = info.comparedTo().isBlank() ? List.of() : ProjectAnalysis.diff(
                workflow.baseline(context.project(), info.comparedTo()).snapshot(), baseline.snapshot());
        return Map.of("info", info, "snapshot", baseline.snapshot(), "reviews", baseline.reviews(),
                "evidence", baseline.evidence(), "validation", ProjectAnalysis.coverage(baseline.snapshot(), baseline.evidence()),
                "changes", changes);
    }

    @GetMapping("/baselines/{id}/diff")
    public List<ProjectAnalysis.Difference> difference(HttpServletRequest request, @PathVariable String id, @RequestParam String from) {
        var context = context(request);
        return ProjectAnalysis.diff(workflow.baseline(context.project(), from).snapshot(), workflow.baseline(context.project(), id).snapshot());
    }

    @PostMapping("/baselines/{id}/restore")
    public Map<String, Long> restore(HttpServletRequest request, @PathVariable String id, @RequestBody RestoreRequest input) {
        var context = context(request);
        require(context.grant().canManage() && context.grant().canEdit());
        var baseline = workflow.baseline(context.project(), id);
        String requestId = ProjectWorkflow.uuid(input.requestId());
        CommandExecutor executor = projects.resolve(context.project());
        long revision = executor.restoreSnapshot(context.session(), input.revision(), "baseline-" + requestId,
                baseline.snapshot()).revision();
        workflow.recordRestoration(context.project(), requestId, id, input.revision(), revision, context.principal());
        sockets.projectRecordsChanged(context.project());
        return Map.of("revision", revision);
    }

    private Context context(HttpServletRequest request) {
        String project = ProjectAccess.projectId(request.getHeader(ProjectAccess.HEADER));
        Principal principal = (Principal) request.getAttribute(AuthController.PRINCIPAL_ATTRIBUTE);
        ProjectAccess.Grant grant = access.grant(project, principal);
        require(grant.canView());
        return new Context(project, principal, grant, ProjectAccess.session(principal, request.getHeader("X-Scofen-Session")));
    }

    private ModelSnapshot snapshot(Context context) {
        return projects.resolve(context.project()).snapshot();
    }

    private static void require(boolean allowed) {
        if (!allowed) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目角色不允许此操作");
    }
}
