package com.scofen.model.core;

import java.util.List;

/** 服务端广播的权威变更：全局 seq / revision、受影响 id、变更明细、逆命令与校验增量。 */
public record Patch(
        long seq,
        long revision,
        List<String> affectedIds,
        List<Change> changes,
        Command inverse,
        String validationDelta,
        String clientCmdId) {

    public Patch {
        affectedIds = affectedIds == null ? List.of() : List.copyOf(affectedIds);
        changes = changes == null ? List.of() : List.copyOf(changes);
    }
}
