package com.scofen.model.metamodel;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 规范名 → 界面英文显示名的派生工具。
 *
 * <p>UML 2.5.1 / SysML 1.6 的元类名与元属性名本身就是英文规范名
 * （如 {@code NamedElement}、{@code ownedAttribute}），因此英文标签不必逐条翻译，
 * 只要把规范名的驼峰与缩写还原成可读英文即可，避免维护一份易与规范脱节的平行词表。</p>
 */
public final class LabelUtil {

    /** 规范名中的缩写：还原为标准大写形式。 */
    private static final Map<String, String> ACRONYMS = new LinkedHashMap<>();

    static {
        ACRONYMS.put("id", "ID");
        ACRONYMS.put("ids", "IDs");
        ACRONYMS.put("uml", "UML");
        ACRONYMS.put("sysml", "SysML");
        ACRONYMS.put("xmi", "XMI");
        ACRONYMS.put("io", "IO");
        ACRONYMS.put("url", "URL");
        ACRONYMS.put("api", "API");
        ACRONYMS.put("sql", "SQL");
        ACRONYMS.put("qa", "QA");
        ACRONYMS.put("os", "OS");
    }

    private LabelUtil() {
    }

    /**
     * 把规范名派生成英文显示名：{@code ownedAttribute} → {@code Owned Attribute}，
     * {@code sourceId} → {@code Source ID}，{@code NamedElement} → {@code Named Element}。
     */
    public static String humanize(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String spaced = raw
                .replaceAll("([a-z0-9])([A-Z])", "$1 $2")
                .replaceAll("([A-Z]+)([A-Z][a-z])", "$1 $2")
                .replace('_', ' ');
        StringBuilder result = new StringBuilder();
        for (String word : spaced.split("[\\s]+")) {
            if (word.isEmpty()) {
                continue;
            }
            if (!result.isEmpty()) {
                result.append(' ');
            }
            result.append(capitalize(word));
        }
        return result.toString();
    }

    private static String capitalize(String word) {
        String lower = word.toLowerCase(Locale.ROOT);
        String acronym = ACRONYMS.get(lower);
        if (acronym != null) {
            return acronym;
        }
        // 已经是规范里的大小写混合形式（如 SysML），保持原样只调整首字母。
        return Character.toUpperCase(word.charAt(0)) + word.substring(1);
    }
}
