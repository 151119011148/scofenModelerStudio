package com.scofen.model.core;

public class RevisionConflictException extends RuntimeException {
    private final long expected;
    private final long actual;

    public RevisionConflictException(long expected, long actual) {
        super("Stale baseRevision: client=" + expected + ", server=" + actual);
        this.expected = expected;
        this.actual = actual;
    }

    public long expected() {
        return expected;
    }

    public long actual() {
        return actual;
    }
}
