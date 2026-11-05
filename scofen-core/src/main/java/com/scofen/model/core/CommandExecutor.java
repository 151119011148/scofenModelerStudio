package com.scofen.model.core;

import com.scofen.model.metamodel.ModelSnapshot;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 唯一的写入入口：baseRevision 乐观锁 → 服务端规则校验 → 原子写 Repository
 * → revision / seq 递增 → 增量校验 → WebSocket Patch 广播 → session 级撤销栈。
 */
public final class CommandExecutor {

    private final InMemoryModelRepository repository;
    private final ValidationEngine validation;
    private final PatchSink sink;
    private final UndoStack undoStack;
    private final PersistenceService persistence;
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

    public synchronized Patch execute(String sessionId, Command cmd) {
        return executeInternal(sessionId, cmd, true);
    }

    public synchronized Patch undo(String sessionId) {
        Command inverse = undoStack.pop(sessionId)
                .orElseThrow(() -> new IllegalStateException("Nothing to undo for session " + sessionId));
        Command rebased = new Command(inverse.type(), inverse.payload(), repository.revision(),
                "undo-" + UUID.randomUUID());
        return executeInternal(sessionId, rebased, false);
    }

    private Patch executeInternal(String sessionId, Command cmd, boolean recordUndo) {
        // 幂等键先于 CAS：网络重试会带着同一个 baseRevision 重发，命中即返回原 Patch。
        String key = idempotencyKey(cmd);
        Patch cached = idempotency.get(key);
        if (cached != null) {
            return cached;
        }
        long current = repository.revision();
        if (cmd.baseRevision() != current) {
            throw new RevisionConflictException(cmd.baseRevision(), current);
        }

        validation.validate(cmd, repository);
        Patch raw = repository.apply(cmd);
        String delta = validation.validateIncremental(repository.snapshot(), raw.affectedIds());
        Patch patch = new Patch(raw.seq(), raw.revision(), raw.affectedIds(), raw.changes(),
                raw.inverse(), delta, cmd.clientCmdId());

        idempotency.put(key, patch);
        if (recordUndo && patch.inverse() != null) {
            undoStack.push(sessionId, patch.inverse());
        }
        if (persistence.isEnabled()) {
            persistence.save(repository.snapshot());
        }
        sink.publish(patch);
        return patch;
    }

    private String idempotencyKey(Command cmd) {
        return cmd.clientCmdId() == null
                ? "anon:" + cmd.type() + ":" + cmd.baseRevision() + ":" + cmd.payload().hashCode()
                : cmd.clientCmdId();
    }

    public long revision() {
        return repository.revision();
    }

    public ModelSnapshot snapshot() {
        return repository.snapshot();
    }

    public InMemoryModelRepository repository() {
        return repository;
    }

    public int undoDepth(String sessionId) {
        return undoStack.size(sessionId);
    }
}
