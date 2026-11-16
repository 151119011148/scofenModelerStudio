package com.scofen.model.core;

import com.scofen.model.metamodel.DiagramTypeLibrary;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ModelElement;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 预置扩展图播种器：把 {@link DiagramTypeLibrary} 的模板写成模型里的真实元素。
 *
 * <p>与 {@link ExtensionSeeder} 同套路：走批量命令 {@code CREATE_ELEMENTS}，
 * 一次命令、一次 revision、一个 Patch，写入路径与用户手建完全一致，
 * 因此可撤销、可随快照与 XMI 往返。</p>
 *
 * <p>预置定义落在用户域 id（{@code e-dt-preset-*}），不会落入扩展域命名空间，
 * 所以 {@code ExtensionSeeder.sync()} 的反向清理不会把它们当过期内容删掉。</p>
 */
public final class DiagramTypeSeeder {

    /** 播种会话：与用户会话分离，用户撤销自己的操作时不会误伤系统内容。 */
    public static final String SYSTEM_SESSION = "system";

    private DiagramTypeSeeder() {
    }

    /**
     * 新项目播种：建「扩展图库」包 + 全部预置扩展图定义。
     *
     * @param executor     项目运行时
     * @param rootOwnerId  项目根元素 id
     */
    public static void seed(CommandExecutor executor, String rootOwnerId) {
        List<Map<String, Object>> rows = rows(rootOwnerId, Set.of());
        if (rows.isEmpty()) {
            return;
        }
        executor.execute(SYSTEM_SESSION, Command.of("CREATE_ELEMENTS", executor.revision(),
                "seed-diagram-type-library", Map.of("elements", rows)));
    }

    /**
     * 增量同步：给存量项目补齐尚未落库的预置扩展图。
     *
     * <p>与 {@link ExtensionSeeder#sync} 同思路：预置模板随产品版本演进，
     * 升级后新增的模板要补进存量项目；已存在的（包括用户改过名、改过白名单的）一律不动。</p>
     *
     * @return 是否真的改动过（调用方据此决定要不要重写快照）
     */
    public static boolean sync(CommandExecutor executor, String rootOwnerId) {
        Set<String> existing = new LinkedHashSet<>();
        for (ModelElement element : executor.snapshot().elements()) {
            existing.add(element.id());
        }
        List<Map<String, Object>> rows = rows(rootOwnerId, existing);
        if (rows.isEmpty()) {
            return false;
        }
        executor.execute(SYSTEM_SESSION, Command.of("CREATE_ELEMENTS", executor.revision(),
                "sync-diagram-type-library", Map.of("elements", rows)));
        return true;
    }

    /**
     * 找出尚未落库的预置定义，供「载入预置扩展图」按钮补建存量项目。
     *
     * @param executor 项目运行时
     * @return 缺失的定义（按清单顺序）
     */
    public static List<DiagramTypeLibrary.Preset> missing(CommandExecutor executor) {
        Set<String> existing = new LinkedHashSet<>();
        for (ModelElement element : executor.snapshot().elements()) {
            existing.add(element.id());
        }
        List<DiagramTypeLibrary.Preset> result = new ArrayList<>();
        for (DiagramTypeLibrary.Preset preset : DiagramTypeLibrary.presets()) {
            if (!existing.contains(preset.id())) {
                result.add(preset);
            }
        }
        return result;
    }

    /**
     * 预置定义的模型行（含「扩展图库」包本身）。
     *
     * @param rootOwnerId 项目根元素 id
     * @param skipIds    已存在的 id（不重复创建）
     */
    public static List<Map<String, Object>> rows(String rootOwnerId, Set<String> skipIds) {
        List<Map<String, Object>> elements = new ArrayList<>();
        if (!skipIds.contains(DiagramTypeLibrary.LIBRARY_PACKAGE_ID)) {
            Map<String, Object> pack = new LinkedHashMap<>();
            pack.put("id", DiagramTypeLibrary.LIBRARY_PACKAGE_ID);
            pack.put("type", ElementType.PACKAGE.name());
            pack.put("name", DiagramTypeLibrary.LIBRARY_PACKAGE_NAME);
            pack.put("ownerId", rootOwnerId);
            pack.put("documentation", "预置扩展图模板库：可在「定制」页签中改名、改白名单或删除。");
            pack.put("properties", Map.of());
            elements.add(pack);
        }
        for (DiagramTypeLibrary.Preset preset : DiagramTypeLibrary.presets()) {
            if (skipIds.contains(preset.id())) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", preset.id());
            row.put("type", ElementType.DIAGRAM_TYPE.name());
            row.put("name", preset.name());
            row.put("ownerId", DiagramTypeLibrary.LIBRARY_PACKAGE_ID);
            row.put("documentation", preset.documentation());
            row.put("properties", preset.properties());
            elements.add(row);
        }
        return elements;
    }
}
