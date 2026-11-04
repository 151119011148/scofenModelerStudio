package com.scofen.model.core;

/** Patch 内的最小变更单元，供客户端增量应用投影副本。 */
public record Change(String op, String objectType, String id, Object before, Object after) {
}
