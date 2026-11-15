package com.scofen.model.metamodel;

import java.util.Objects;

/**
 * 模型对象（元素 / 关系）上的一条评论。评审批注层，独立于元素本体属性。
 *
 * <p>作者与时间戳由服务端在写入时权威注入（{@code author} 取登录用户名、{@code authorName}
 * 取展示名、{@code createdAt} 为 ISO-8601 时刻），客户端不得伪造。{@code updatedAt} 为空串
 * 表示从未编辑（避免 null 进入命令载荷，{@code Command} 的 {@code Map.copyOf} 拒绝 null 值）。</p>
 *
 * <p>评论按 {@code targetId} 关联，<b>不随元素删除而级联删除</b>：删除元素只是让评论暂时
 * 成为孤儿（界面按现存目标过滤，读不到就不显示），撤销删除时元素回归、其评论自动重新可见，
 * 无需在删除 / 恢复的复合命令里搬运评论。</p>
 */
public record Comment(
        String id,
        String targetType,
        String targetId,
        String author,
        String authorName,
        String text,
        String createdAt,
        String updatedAt) {

    public Comment {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(targetId, "targetId");
        targetType = "relationship".equals(targetType) ? "relationship" : "element";
        author = author == null ? "" : author;
        authorName = authorName == null || authorName.isBlank() ? author : authorName;
        text = text == null ? "" : text;
        createdAt = createdAt == null ? "" : createdAt;
        updatedAt = updatedAt == null ? "" : updatedAt;
    }

    /** 编辑正文：保留原作者 / 首建时间，刷新 updatedAt。 */
    public Comment withText(String newText, String editedAt) {
        return new Comment(id, targetType, targetId, author, authorName, newText, createdAt, editedAt);
    }
}
