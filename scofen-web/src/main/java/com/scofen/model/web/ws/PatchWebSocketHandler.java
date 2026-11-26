package com.scofen.model.web.ws;

import com.scofen.model.core.Patch;
import com.scofen.model.web.auth.AuthService;
import com.scofen.model.web.project.ProjectAccess;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/** Project-scoped revision notifications. A reconnect reloads the authoritative snapshot. */
public class PatchWebSocketHandler extends TextWebSocketHandler {

    private record Subscription(WebSocketSession session, String project, String token) {}
    private final Map<String, Subscription> sessions = new ConcurrentHashMap<>();
    private final AtomicLong broadcastCount = new AtomicLong();
    /** 单元测试可直接 new 无参版本（不做鉴权）；Spring 装配时注入 AuthService。 */
    private final AuthService auth;
    private final ProjectAccess access;

    public PatchWebSocketHandler() {
        this(null, null);
    }

    public PatchWebSocketHandler(AuthService auth, ProjectAccess access) {
        this.auth = auth;
        this.access = access;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String project = ProjectAccess.projectId(queryParam(session.getUri(), "project"));
        String token = queryParam(session.getUri(), "token");
        if (auth != null && !access.grant(project, auth.parseOrNull(token)).canView()) {
            session.close(new CloseStatus(1008, "unauthorized"));
            return;
        }
        WebSocketSession channel = new ConcurrentWebSocketSessionDecorator(session, 5000, 256 * 1024);
        sessions.put(session.getId(), new Subscription(channel, project, token));
        channel.sendMessage(new TextMessage("{\"type\":\"connected\"}"));
    }

    private static String queryParam(URI uri, String name) {
        if (uri == null || uri.getRawQuery() == null) {
            return null;
        }
        for (String pair : uri.getRawQuery().split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && name.equals(pair.substring(0, eq))) {
                return URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
    }

    public void broadcast(String project, Patch patch) {
        broadcastCount.incrementAndGet();
        send(project, new TextMessage(render(patch)));
    }

    public void projectRecordsChanged(String project) {
        send(project, new TextMessage("{\"type\":\"project-records\"}"));
    }

    private void send(String project, TextMessage message) {
        for (Subscription subscription : sessions.values()) {
            if (!subscription.project().equals(project)) continue;
            WebSocketSession session = subscription.session();
            if (!session.isOpen()) {
                sessions.remove(session.getId());
                continue;
            }
            try {
                if (auth != null && !access.grant(project, auth.parseOrNull(subscription.token())).canView()) {
                    sessions.remove(session.getId());
                    session.close(new CloseStatus(1008, "project access revoked"));
                } else {
                    session.sendMessage(message);
                }
            } catch (IOException | IllegalStateException ex) {
                sessions.remove(session.getId());
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
