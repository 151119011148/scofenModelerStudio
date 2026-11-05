package com.scofen.model.core;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 服务端按 session 保存撤销/重做栈。每个条目同时持有「正向命令」与「逆命令」，
 * 从而一次 undo 之后可以用同一条目的正向命令完成 redo；任何新的正向写入都会清空 redo 栈。
 */
public final class UndoStack {

    public record UndoEntry(Command forward, Command inverse) {}

    private final Map<String, Deque<UndoEntry>> undoStacks = new ConcurrentHashMap<>();
    private final Map<String, Deque<UndoEntry>> redoStacks = new ConcurrentHashMap<>();

    /** 一次成功的正向写入：压入撤销栈，并清空该会话的重做栈（新动作使 redo 失效）。 */
    public void push(String sessionId, Command forward, Command inverse) {
        undoStacks.computeIfAbsent(sessionId, key -> new ArrayDeque<>()).push(new UndoEntry(forward, inverse));
        redoStacks.remove(sessionId);
    }

    /** 弹出一条待撤销条目（含正向与逆命令）。 */
    public Optional<UndoEntry> popUndo(String sessionId) {
        Deque<UndoEntry> stack = undoStacks.get(sessionId);
        return stack == null || stack.isEmpty() ? Optional.empty() : Optional.of(stack.pop());
    }

    /** 撤销后把原条目放入重做栈，供 redo 重新执行其正向命令。 */
    public void pushRedo(String sessionId, UndoEntry entry) {
        redoStacks.computeIfAbsent(sessionId, key -> new ArrayDeque<>()).push(entry);
    }

    /** 弹出一条待重做条目。 */
    public Optional<UndoEntry> popRedo(String sessionId) {
        Deque<UndoEntry> stack = redoStacks.get(sessionId);
        return stack == null || stack.isEmpty() ? Optional.empty() : Optional.of(stack.pop());
    }

    public int undoSize(String sessionId) {
        Deque<UndoEntry> stack = undoStacks.get(sessionId);
        return stack == null ? 0 : stack.size();
    }

    public int redoSize(String sessionId) {
        Deque<UndoEntry> stack = redoStacks.get(sessionId);
        return stack == null ? 0 : stack.size();
    }
}
