package com.scofen.model.core;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** 服务端按 session 保存撤销栈，客户端不持有真本。 */
public final class UndoStack {

    private final Map<String, Deque<Command>> stacks = new ConcurrentHashMap<>();

    public void push(String sessionId, Command inverse) {
        stacks.computeIfAbsent(sessionId, key -> new ArrayDeque<>()).push(inverse);
    }

    public Optional<Command> pop(String sessionId) {
        Deque<Command> stack = stacks.get(sessionId);
        return stack == null || stack.isEmpty() ? Optional.empty() : Optional.of(stack.pop());
    }

    public int size(String sessionId) {
        Deque<Command> stack = stacks.get(sessionId);
        return stack == null ? 0 : stack.size();
    }
}
