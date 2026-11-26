package com.scofen.model.core;

import com.scofen.model.metamodel.ModelSnapshot;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 唯一的写入入口：baseRevision 乐观锁 → 服务端规则校验 → 原子写 Repository
 * → revision / seq 递增 → 增量校验 → WebSocket Patch 广播 → session 级撤销栈。
 */
public final class CommandExecutor {
    static final String APPLY_SNAPSHOT = "APPLY_PREPARED_SNAPSHOT";

    private final InMemoryModelRepository repository;
    private final ValidationEngine validation;
    private final PatchSink sink;
    private final UndoStack undoStack;
    private PersistenceService persistence;
    private final Map<String, Patch> idempotency = new ConcurrentHashMap<>();

    public CommandExecutor(InMemoryModelRepository repository, ValidationEngine validation, PatchSink sink) {
        this(repository, validation, sink, new UndoStack(), new NoopPersistenceService());
    }

    public CommandExecutor(InMemoryModelRepository repository, ValidationEngine validation,
                           PatchSink sink, UndoStack undoStack) {
        this(repository, validation, sink, undoStack, new NoopPersistenceService());
    }

    public CommandExecutor(InMemoryModelRepository repository, ValidationEngine validation,
                           PatchSink sink, UndoStack undoStack, PersistenceService persistence) {
        this.repository = repository;
        this.validation = validation;
        this.sink = sink;
        this.undoStack = undoStack;
        this.persistence = persistence;
    }

    /**
     * 替换持久化实现。<b>仅限初始化期</b>（播种模型之前挂 {@link NoopPersistenceService}，
     * 播种完成后换成真实实现并整包落库一次）——避免种子阶段的每条命令都写一份整包快照。
     * 运行期调用会与正在进行的 apply 交错，不应使用。
     */
    public void setPersistence(PersistenceService replacement) {
        synchronized (this) {
            this.persistence = replacement == null ? new NoopPersistenceService() : replacement;
        }
    }

    public synchronized Patch execute(String sessionId, Command cmd) {
        if (APPLY_SNAPSHOT.equals(cmd.type())) throw new ValidationException("内部命令");
        return executeInternal(sessionId, cmd, true);
    }

    /** Validate every operation against a disposable repository before committing one revision. */
    public synchronized Patch executeBatch(String sessionId, long baseRevision, String id, List<Command> operations) {
        Patch cached = idempotency.get(sessionId + ":" + id);
        if (cached != null) return cached;
        ModelSnapshot before = snapshotAt(baseRevision);
        InMemoryModelRepository staged = new InMemoryModelRepository();
        staged.load(before);
        for (Command operation : operations) {
            if (APPLY_SNAPSHOT.equals(operation.type())) throw new ValidationException("内部命令");
            validation.validate(operation, staged);
            staged.apply(operation);
        }
        return commitSnapshot(sessionId, id, before, staged.snapshot());
    }

    public synchronized Patch restoreSnapshot(String sessionId, long baseRevision, String id, ModelSnapshot snapshot) {
        Patch cached = idempotency.get(sessionId + ":" + id);
        return cached != null ? cached : commitSnapshot(sessionId, id, snapshotAt(baseRevision), snapshot);
    }

    private ModelSnapshot snapshotAt(long revision) {
        ModelSnapshot snapshot = repository.snapshot();
        if (snapshot.revision() != revision) throw new RevisionConflictException(revision, snapshot.revision());
        return snapshot;
    }

    private Patch commitSnapshot(String sessionId, String id, ModelSnapshot before, ModelSnapshot after) {
        return executeInternal(sessionId, snapshotCommand(before.revision(), id, before, after), true);
    }

    static Command snapshotCommand(long revision, String id, ModelSnapshot before, ModelSnapshot after) {
        return Command.of(APPLY_SNAPSHOT, revision, id, Map.of("before", before, "after", after));
    }

    public synchronized Patch undo(String sessionId) {
        UndoStack.UndoEntry entry = undoStack.peekUndo(sessionId)
                .orElseThrow(() -> new IllegalStateException("Nothing to undo for session " + sessionId));
        Command rebased = new Command(entry.inverse().type(), entry.inverse().payload(), repository.revision(),
                "undo-" + UUID.randomUUID());
        Patch patch = executeInternal(sessionId, rebased, false);
        undoStack.popUndo(sessionId);
        undoStack.pushRedo(sessionId, entry);
        return patch;
    }

    public synchronized Patch redo(String sessionId) {
        UndoStack.UndoEntry entry = undoStack.peekRedo(sessionId)
                .orElseThrow(() -> new IllegalStateException("Nothing to redo for session " + sessionId));
        Command rebased = new Command(entry.forward().type(), entry.forward().payload(), repository.revision(),
                "redo-" + UUID.randomUUID());
        Patch patch = executeInternal(sessionId, rebased, false);
        undoStack.popRedo(sessionId);
        undoStack.pushUndo(sessionId, entry);
        return patch;
    }

    private Patch executeInternal(String sessionId, Command cmd, boolean recordUndo) {
        // 幂等键先于 CAS：网络重试会带着同一个 baseRevision 重发，命中即返回原 Patch。
        String key = sessionId + ":" + idempotencyKey(cmd);
        Patch cached = idempotency.get(key);
        if (cached != null) {
            return cached;
        }
        long current = repository.revision();
        if (cmd.baseRevision() != current) {
            throw new RevisionConflictException(cmd.baseRevision(), current);
        }

        if (!APPLY_SNAPSHOT.equals(cmd.type())) validation.validate(cmd, repository);
        ModelSnapshot previous = persistence.isEnabled() ? repository.snapshot() : null;
        Patch raw;
        String delta;
        try {
            raw = repository.apply(cmd);
            ModelSnapshot snapshot = repository.snapshot();
            delta = validation.validateIncremental(snapshot, raw.affectedIds());
            if (persistence.isEnabled()) persistence.save(snapshot);
        } catch (RuntimeException ex) {
            if (previous != null) repository.load(previous);
            throw ex;
        }
        Patch patch = new Patch(raw.seq(), raw.revision(), raw.affectedIds(), raw.changes(),
                raw.inverse(), delta, cmd.clientCmdId());

        idempotency.put(key, patch);
        if (recordUndo && patch.inverse() != null) {
            undoStack.push(sessionId, cmd, patch.inverse());
        }
        sink.publish(patch);
        return patch;
    }

    private String idempotencyKey(Command cmd) {
        return cmd.clientCmdId() == null
                ? "anon:" + cmd.type() + ":" + cmd.baseRevision() + ":" + cmd.payload().hashCode()
                : cmd.clientCmdId();
    }

    public synchronized long revision() {
        return repository.revision();
    }

    public synchronized ModelSnapshot snapshot() {
        return repository.snapshot();
    }

    /** 全量校验当前快照：结构 ERROR + 需求追溯 WARNING，供校验问题面板拉取。 */
    public synchronized java.util.List<ValidationIssue> validateFull() {
        return validation.validateFull(repository.snapshot());
    }

    /** 需求 satisfy / verify 覆盖明细，供需求覆盖矩阵渲染（与校验 WARNING 同源）。 */
    public synchronized java.util.List<RequirementCoverage> requirementCoverage() {
        return validation.requirementCoverage(repository.snapshot());
    }

    public InMemoryModelRepository repository() {
        return repository;
    }

    public synchronized int undoDepth(String sessionId) {
        return undoStack.undoSize(sessionId);
    }

    public synchronized int redoDepth(String sessionId) {
        return undoStack.redoSize(sessionId);
    }
}
