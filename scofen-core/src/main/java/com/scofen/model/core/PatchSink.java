package com.scofen.model.core;

/** WS 广播出口。core 不依赖 Spring，由 web 层实现。 */
public interface PatchSink {
    void publish(Patch patch);
}
