package com.scofen.model.core;

import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 通用扩展包播种器：把 SysML / UML 的元类与构造型写进项目。
 *
 * <p>扩展包是每个项目的公共内容，因此走批量命令 {@code CREATE_ELEMENTS}：
 * 一次命令、一次 revision、一个 Patch，既避免上百次命令把 revision 顶高，
 * 也避免逐条广播把 WebSocket 通道打爆。写入路径与用户编辑完全一致，
 * 校验（含关系、命名唯一、引用存在性）同样生效。</p>
 */
public final class ExtensionSeeder {

    /** 播种使用的会话：与用户会话分离，用户无法撤销系统内容。 */
    public static final String SYSTEM_SESSION = "system";

    private ExtensionSeeder() {
    }

    /**
     * 把通用扩展包写入指定项目根之下。
     *
     * @param executor     项目运行时
     * @param rootOwnerId  项目根元素 id
     */
    public static void seed(CommandExecutor executor, String rootOwnerId) {
        executor.execute(SYSTEM_SESSION, Command.of("CREATE_ELEMENTS", executor.revision(),
                "seed-extension-library", Map.of("elements", rows(rootOwnerId, Set.of()))));
    }

    /**
     * 增量同步：先清掉目录里已不存在的扩展内容，再补建新增的元类 / 构造型 / 标准库。
     *
     * <p>扩展包随项目提供，但快照是版本相关的：升级后新增的元类、原始类型库、
     * 单位量纲库不会自动出现在存量项目里，因此按 id 比对补建，已存在的（包括用户改过名的）
     * 一律不动。</p>
     *
     * <p>反方向同样要处理：旧版本曾把 ElementType 的「界面关键词」（{@code package}、
     * {@code port}、{@code activity}…）物化成构造型，这些元素在快照里留下 {@code st-package}
     * 之类的 id，而新目录已不再生成它们。它们既不在扩展目录里，也不是项目元素，
     * 最终会以「孤儿」身份漏进模型树顶层——所以按「扩展域 id 但目录未定义」清理一次。
     * 用户自建元素的 id 形如 {@code e-xxx}，不会落入扩展域命名空间。</p>
     *
     * @return 是否真的改动过（调用方据此决定要不要重写快照）
     */
    public static boolean sync(CommandExecutor executor, String rootOwnerId) {
        Set<String> existing = new HashSet<>();
        for (ModelElement element : executor.snapshot().elements()) {
            existing.add(element.id());
        }

        Set<String> defined = new HashSet<>();
        for (ExtensionLibrary.Definition definition : ExtensionLibrary.definitions(rootOwnerId)) {
            defined.add(definition.id());
        }

        boolean changed = false;
        List<String> retired = new ArrayList<>();
        for (String id : existing) {
            if (!defined.contains(id) && ExtensionLibrary.ownsId(id)) {
                retired.add(id);
            }
        }
        if (!retired.isEmpty()) {
            executor.execute(SYSTEM_SESSION, Command.of("DELETE_ELEMENTS", executor.revision(),
                    "prune-extension-library", Map.of("ids", retired)));
            existing.removeAll(retired);
            changed = true;
        }

        List<Map<String, Object>> missing = rows(rootOwnerId, existing);
        if (!missing.isEmpty()) {
            executor.execute(SYSTEM_SESSION, Command.of("CREATE_ELEMENTS", executor.revision(),
                    "sync-extension-library", Map.of("elements", missing)));
            changed = true;
        }
        return changed;
    }

    private static List<Map<String, Object>> rows(String rootOwnerId, Set<String> skipIds) {
        List<Map<String, Object>> elements = new ArrayList<>();
        for (ExtensionLibrary.Definition definition : ExtensionLibrary.definitions(rootOwnerId)) {
            if (skipIds.contains(definition.id())) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", definition.id());
            row.put("type", definition.type());
            row.put("name", definition.name());
            row.put("ownerId", definition.ownerId());
            row.put("documentation", definition.documentation());
            row.put("stereotypes", definition.stereotypes());
            row.put("properties", definition.properties());
            elements.add(row);
        }
        return elements;
    }
}
