package com.scofen.model.core;

import java.util.List;

/**
 * 一条需求的 satisfy / verify 覆盖明细：供需求覆盖矩阵直接渲染。
 *
 * <p>与校验 WARNING 同源（{@link ValidationEngine#validateFull}），由服务端权威计算，
 * 前端不在浏览器里重算追溯规则。{@code satisfiedBy}/{@code verifiedBy} 列出覆盖来源元素，
 * 矩阵单元格据此显示「被谁满足/验证」并可点击定位。</p>
 */
public record RequirementCoverage(
        String id,
        String name,
        boolean satisfied,
        boolean verified,
        List<CoverageRef> satisfiedBy,
        List<CoverageRef> verifiedBy) {

    /** 覆盖来源元素的最小投影：id 用于点击定位，name 用于矩阵单元格展示。 */
    public record CoverageRef(String id, String name) {
    }
}