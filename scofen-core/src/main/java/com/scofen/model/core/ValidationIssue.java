package com.scofen.model.core;

/**
 * 一条结构化校验问题：供「校验问题面板」按严重度分组、点击定位到模型对象。
 *
 * <p>与 {@link ValidationEngine#validateIncremental} 返回的纯文本 delta 不同，
 * 这里携带机器可读的 {@code code}、定位用的 {@code targetType}/{@code targetId}
 * 与展示用的 {@code targetName}，前端据此把一行问题直接跳转到对应的元素或图。</p>
 *
 * @param severity   error / warning / info（小写，前端按此着色与排序）
 * @param code       机器可读规则码，如 DANGLING_REL_TARGET、REQ_NOT_SATISFIED
 * @param message    面向用户的中文描述
 * @param targetType 定位目标种类：element / diagram（前端据此决定选中还是开图）
 * @param targetId   定位目标 id：元素 id 或图 id
 * @param targetName 定位目标显示名，便于面板直接呈现
 */
public record ValidationIssue(
        String severity,
        String code,
        String message,
        String targetType,
        String targetId,
        String targetName) {

    public static final String ERROR = "error";
    public static final String WARNING = "warning";
    public static final String INFO = "info";

    public static ValidationIssue error(String code, String message,
                                        String targetType, String targetId, String targetName) {
        return new ValidationIssue(ERROR, code, message, targetType, targetId, targetName);
    }

    public static ValidationIssue warning(String code, String message,
                                          String targetType, String targetId, String targetName) {
        return new ValidationIssue(WARNING, code, message, targetType, targetId, targetName);
    }
}