package com.scofen.model.core;

import com.scofen.model.metamodel.ExtensionLibrary;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
        List<Map<String, Object>> elements = new ArrayList<>();
        for (ExtensionLibrary.Definition definition : ExtensionLibrary.definitions(rootOwnerId)) {
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
        executor.execute(SYSTEM_SESSION, Command.of("CREATE_ELEMENTS", executor.revision(),
                "seed-extension-library", Map.of("elements", elements)));
    }
}
