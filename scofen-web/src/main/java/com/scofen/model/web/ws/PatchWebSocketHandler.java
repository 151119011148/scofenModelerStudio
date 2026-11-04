package com.scofen.model.web.ws;

import com.scofen.model.core.Patch;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/** 单写者 + 只读跟随：所有在线会话收到同一条权威 Patch，不做多写者协同。 */
public class PatchWebSocketHandler extends TextWebSocketHandler {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    private final AtomicLong broadcastCount = new AtomicLong();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.add(session);
        session.sendMessage(new TextMessage("{\"type\":\"connected\"}"));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    public void broadcast(Patch patch) {
        broadcastCount.incrementAndGet();
        TextMessage message = new TextMessage(render(patch));
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) {
                sessions.remove(session);
                continue;
            }
            try {
                session.sendMessage(message);
            } catch (IOException ex) {
                sessions.remove(session);
            }
        }
    }

    public int sessionCount() {
        return sessions.size();
    }

    public long broadcastCount() {
        return broadcastCount.get();
    }

    private String render(Patch patch) {
        String ids = patch.affectedIds().stream()
                .map(value -> "\"" + escape(value) + "\"")
                .collect(Collectors.joining(","));
        return "{\"type\":\"patch\",\"seq\":" + patch.seq()
                + ",\"revision\":" + patch.revision()
                + ",\"affectedIds\":[" + ids + "]"
                + ",\"validationDelta\":\"" + escape(String.valueOf(patch.validationDelta())) + "\""
                + ",\"clientCmdId\":\"" + escape(String.valueOf(patch.clientCmdId())) + "\"}";
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }
}
