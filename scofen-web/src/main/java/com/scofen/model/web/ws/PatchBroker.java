package com.scofen.model.web.ws;

import com.scofen.model.core.Patch;
import com.scofen.model.core.PatchSink;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/** core 的广播出口，同时保留 Patch 历史供 sinceRevision 补帧。 */
public class PatchBroker implements PatchSink {

    private final PatchWebSocketHandler handler;
    private final List<Patch> history = new CopyOnWriteArrayList<>();
    private final AtomicLong published = new AtomicLong();

    public PatchBroker(PatchWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void publish(Patch patch) {
        history.add(patch);
        published.incrementAndGet();
        handler.broadcast(patch);
    }

    public List<Patch> since(long revision) {
        return history.stream().filter(patch -> patch.revision() > revision).toList();
    }

    public long publishedCount() {
        return published.get();
    }

    public int sessionCount() {
        return handler.sessionCount();
    }
}
