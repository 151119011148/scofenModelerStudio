package com.scofen.model.web.ws;

import com.scofen.model.core.Patch;
import com.scofen.model.core.PatchSink;
import com.scofen.model.web.workspace.WorkspaceDirectory;

import java.util.List;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicLong;

/** core 的广播出口，同时保留 Patch 历史供 sinceRevision 补帧。 */
public class PatchBroker implements PatchSink {

    private final PatchWebSocketHandler handler;
    private final ArrayDeque<Patch> history = new ArrayDeque<>();
    private final AtomicLong published = new AtomicLong();

    public PatchBroker(PatchWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void publish(Patch patch) {
        publish(WorkspaceDirectory.CURRENT_PROJECT_ID, patch);
    }

    public PatchSink forProject(String project) {
        return patch -> publish(project, patch);
    }

    private void publish(String project, Patch patch) {
        if (WorkspaceDirectory.CURRENT_PROJECT_ID.equals(project)) {
            synchronized (history) {
                history.addLast(patch);
                if (history.size() > 256) history.removeFirst();
            }
        }
        published.incrementAndGet();
        handler.broadcast(project, patch);
    }

    public List<Patch> since(long revision) {
        synchronized (history) {
            return history.stream().filter(patch -> patch.revision() > revision).toList();
        }
    }

    public long publishedCount() {
        return published.get();
    }

    public int sessionCount() {
        return handler.sessionCount();
    }
}
