package com.scofen.model.web.api;

import java.util.Map;

/** REST 侧的 Command DTO，字段与 WebSocket Patch 协议一致。 */
public record CommandRequest(
        String type,
        Map<String, Object> payload,
        long baseRevision,
        String clientCmdId) {
}
