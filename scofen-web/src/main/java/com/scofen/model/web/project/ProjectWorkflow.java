package com.scofen.model.web.project;

import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.core.ValidationIssue;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.auth.AuthService.Principal;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Component
public final class ProjectWorkflow {
    private static final String VIEW = "view";
    private static final String REVIEW = "review";
    private static final String BASELINE = "baseline";
    private static final String EVIDENCE = "evidence";
    private static final String RESTORE = "restore";

    public record Settings(String scopeId, String query, String mode, String sort, List<String> columns,
                           String rowType, String columnType, String relationType, boolean swapped, String missing) {}
    public record View(String id, String name, String kind, Settings settings) {}
    public record Message(String author, String authorName, String text, String at) {}
    public record Review(String id, ProjectAnalysis.Target target, long revision, String status,
                         List<Message> messages, String updatedBy, String updatedAt) {}
    public record Evidence(long revision, String requirementId, String testId, String result, String source,
                           String actor, String at) {}
    public record BaselineInfo(String id, String name, long revision, String author, String at,
                               String notes, String comparedTo) {}
    public record Baseline(BaselineInfo info, ModelSnapshot snapshot, List<Review> reviews, List<Evidence> evidence) {}
    public record Restoration(String id, String baselineId, long fromRevision, long revision, String author, String at) {}

    private final ProjectRecords records;

    public ProjectWorkflow(ProjectRecords records) {
        this.records = records;
    }

    synchronized View saveView(String project, View input) {
        String id = input.id() == null || input.id().isBlank() ? UUID.randomUUID().toString() : uuid(input.id());
        String name = required(input.name(), "视图名称", 120);
        if (!Set.of("requirement-table", "generic-table", "generic-matrix", "satisfy-matrix", "verify-matrix").contains(Objects.toString(input.kind(), ""))
                || input.settings() == null) throw new ValidationException("请选择有效的视图类型和配置");
        if (views(project).stream().anyMatch(view -> !view.id().equals(id) && view.name().equalsIgnoreCase(name))) {
            throw new ValidationException("共享视图名称已存在");
        }
        Settings supplied = input.settings();
        Set<String> allowed = Set.of("id", "name", "type", "text", "satisfy", "verify", "status", "execution");
        List<String> columns = supplied.columns() == null ? List.of() : supplied.columns().stream()
                .filter(Objects::nonNull).filter(allowed::contains).distinct().toList();
        Settings settings = new Settings(shortText(supplied.scopeId(), 200), shortText(supplied.query(), 300),
                shortText(supplied.mode(), 20), shortText(supplied.sort(), 20), columns, shortText(supplied.rowType(), 100),
                shortText(supplied.columnType(), 100), shortText(supplied.relationType(), 100), supplied.swapped(), shortText(supplied.missing(), 20));
        View view = new View(id, name, input.kind(), settings);
        records.save(project, VIEW, id, view);
        return view;
    }

    List<View> views(String project) {
        return records.list(project, VIEW, View.class).stream().sorted(Comparator.comparing(View::name)).toList();
    }

    void deleteView(String project, String id) {
        records.delete(project, VIEW, uuid(id));
    }

    synchronized Review review(String project, ModelSnapshot model, Principal principal, String type, String id, String text) {
        ProjectAnalysis.Target target = ProjectAnalysis.target(model, type, id);
        Message first = message(principal, text);
        Review review = new Review(UUID.randomUUID().toString(), target, model.revision(), "open", List.of(first), first.author(), first.at());
        records.save(project, REVIEW, review.id(), review);
        return review;
    }

    synchronized Review updateReview(String project, String id, Principal principal, String operation, String text) {
        Review previous = records.find(project, REVIEW, uuid(id), Review.class)
                .orElseThrow(() -> new ValidationException("评审批注不存在"));
        List<Message> messages = new ArrayList<>(previous.messages());
        String status = previous.status();
        switch (Objects.toString(operation, "")) {
            case "reply" -> messages.add(message(principal, text));
            case "resolve" -> status = "resolved";
            case "reopen" -> status = "open";
            default -> throw new ValidationException("请选择有效的批注操作");
        }
        Review review = new Review(id, previous.target(), previous.revision(), status, messages, principal.username(), now());
        records.save(project, REVIEW, id, review);
        return review;
    }

    List<Review> reviews(String project) {
        return records.list(project, REVIEW, Review.class).stream().sorted(Comparator.comparing(Review::updatedAt).reversed()).toList();
    }

    Evidence recordEvidence(String project, ModelSnapshot model, Principal principal, Evidence input) {
        checkRevision(model, input.revision());
        boolean testCase = model.elements().stream().anyMatch(element -> element.id().equals(input.testId())
                && ElementType.fromAny(element.type()).orElse(null) == ElementType.TEST_CASE);
        boolean verifies = new ValidationEngine().requirementCoverage(model).stream()
                .filter(item -> item.id().equals(input.requirementId()))
                .anyMatch(item -> item.verifiedBy().stream().anyMatch(source -> source.id().equals(input.testId())));
        if (!testCase || !verifies || !Set.of("pass", "fail").contains(Objects.toString(input.result(), ""))) {
            throw new ValidationException("请选择与需求关联的测试用例及有效的结果");
        }
        Evidence evidence = new Evidence(model.revision(), input.requirementId(), input.testId(), input.result(),
                required(input.source(), "验证依据", 2000), principal.username(), now());
        String key = model.revision() + "\u0000" + input.requirementId() + "\u0000" + input.testId();
        records.save(project, EVIDENCE, UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString(), evidence);
        return evidence;
    }

    public List<Evidence> evidence(String project) {
        return records.list(project, EVIDENCE, Evidence.class);
    }

    synchronized BaselineInfo publish(String project, ModelSnapshot model, Principal principal, String name, String notes) {
        String baselineName = required(name, "基线名称", 120);
        List<BaselineInfo> baselines = baselineList(project);
        if (baselines.stream().anyMatch(item -> item.name().equalsIgnoreCase(baselineName))) {
            throw new ValidationException("基线名称已存在");
        }
        List<ValidationIssue> errors = new ValidationEngine().validateFull(model).stream()
                .filter(issue -> issue.severity().equals(ValidationIssue.ERROR)).toList();
        if (!errors.isEmpty()) throw new ValidationException("请先修复 " + errors.size() + " 项结构错误。" + errors.get(0).message());
        var info = new BaselineInfo(UUID.randomUUID().toString(), baselineName, model.revision(), principal.username(), now(),
                shortText(notes, 4000), baselines.isEmpty() ? "" : baselines.get(0).id());
        records.save(project, BASELINE, info.id(), new Baseline(info, model, reviews(project),
                evidence(project).stream().filter(result -> result.revision() == model.revision()).toList()));
        return info;
    }

    List<BaselineInfo> baselineList(String project) {
        return records.list(project, BASELINE, Baseline.class).stream().map(Baseline::info)
                .sorted(Comparator.comparing(BaselineInfo::at).reversed()).toList();
    }

    Baseline baseline(String project, String id) {
        return records.find(project, BASELINE, uuid(id), Baseline.class)
                .orElseThrow(() -> new ValidationException("该项目中找不到所选基线"));
    }

    List<Restoration> restorations(String project) {
        return records.list(project, RESTORE, Restoration.class).stream()
                .sorted(Comparator.comparingLong(Restoration::revision).reversed()).toList();
    }

    void recordRestoration(String project, String id, String baseline, long from, long to, Principal principal) {
        records.save(project, RESTORE, uuid(id), new Restoration(id, baseline, from, to, principal.username(), now()));
    }

    static void checkRevision(ModelSnapshot snapshot, long expected) {
        if (snapshot.revision() != expected) throw new RevisionConflictException(expected, snapshot.revision());
    }

    static String uuid(String value) {
        try {
            if (value != null && value.length() == 36) return UUID.fromString(value).toString();
        } catch (IllegalArgumentException ignored) {
            // Translate invalid IDs to the same validation response.
        }
        throw new ValidationException("记录 ID 无效");
    }

    private static Message message(Principal principal, String text) {
        return new Message(principal.username(), principal.displayName(), required(text, "批注", 4000), now());
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static String required(String value, String field, int max) {
        String text = shortText(value, max);
        if (text.isEmpty()) throw new ValidationException(field + "不能为空");
        return text;
    }

    private static String shortText(String value, int max) {
        String text = Objects.toString(value, "").trim();
        if (text.length() > max) throw new ValidationException("输入长度超过 " + max + " 字符");
        return text;
    }
}
