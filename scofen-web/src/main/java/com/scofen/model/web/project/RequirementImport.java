package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import org.apache.commons.csv.CSVFormat;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PushbackReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Component
public final class RequirementImport {
    private static final int ROW_LIMIT = 1000;
    private static final int COLUMN_LIMIT = 50;

    public record FileRows(List<String> headers, List<List<String>> rows) {}
    public record Input(long baseRevision, String source, String ownerId, List<InputRow> rows) {}
    public record InputRow(int line, String externalId, String parentId, String name, String text, String status) {}
    public record RowResult(int line, String externalId, String action, String message) {}
    public record Preview(long revision, List<RowResult> rows, int creates, int updates, int unchanged, int errors) {}
    private record Plan(Preview preview, List<Command> commands) {}

    public FileRows read(MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() > 1024 * 1024) {
            throw new ValidationException("请选择小于 1 MB 的需求文件");
        }
        String name = Objects.toString(file.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
        List<List<String>> rows = new ArrayList<>();
        try {
            if (name.endsWith(".csv")) {
                try (var reader = new PushbackReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
                    int first = reader.read();
                    if (first >= 0 && first != '\ufeff') reader.unread(first);
                    try (var records = CSVFormat.RFC4180.parse(reader)) {
                        for (var record : records) {
                            var fields = new ArrayList<String>();
                            record.forEach(fields::add);
                            addRow(rows, fields);
                        }
                    }
                }
            } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
                try (var workbook = WorkbookFactory.create(file.getInputStream())) {
                    if (workbook.getNumberOfSheets() == 0) throw new ValidationException("工作簿没有工作表");
                    var sheet = workbook.getSheetAt(0);
                    if (sheet.getLastRowNum() >= ROW_LIMIT + 1) throw new ValidationException("最多导入 1000 行需求");
                    var formatter = new DataFormatter(Locale.ROOT);
                    formatter.setUseCachedValuesForFormulaCells(true);
                    for (int index = 0; index <= sheet.getLastRowNum(); index++) {
                        Row row = sheet.getRow(index);
                        var fields = new ArrayList<String>();
                        if (row != null && row.getLastCellNum() > COLUMN_LIMIT) {
                            throw new ValidationException("导入文件最多支持 50 列");
                        }
                        for (int cell = 0; row != null && cell < row.getLastCellNum(); cell++) {
                            fields.add(formatter.formatCellValue(row.getCell(cell)));
                        }
                        addRow(rows, fields);
                    }
                }
            } else {
                throw new ValidationException("请选择 XLSX、XLS 或 UTF-8 CSV 文件");
            }
        } catch (ValidationException ex) {
            throw ex;
        } catch (IOException | RuntimeException ex) {
            throw new ValidationException("无法读取需求文件，请检查格式和文件保护设置");
        }
        if (rows.size() < 2 || rows.get(0).stream().allMatch(String::isBlank)) {
            throw new ValidationException("需求文件应包含一行表头及至少一条数据");
        }
        return new FileRows(rows.get(0), rows.subList(1, rows.size()));
    }

    private static void addRow(List<List<String>> data, List<String> cells) {
        if (data.size() >= ROW_LIMIT + 1 || cells.size() > COLUMN_LIMIT) {
            throw new ValidationException("导入文件最多支持 1000 行需求、50 列");
        }
        if (cells.stream().anyMatch(cell -> cell.length() > 10000)) {
            throw new ValidationException("第 " + (data.size() + 1) + " 行单元格过长");
        }
        data.add(cells);
    }

    public Preview preview(Input input, ModelSnapshot snapshot) {
        return plan(input, snapshot).preview();
    }

    public Preview commit(Input input, CommandExecutor executor, String session, String requestId) {
        synchronized (executor) {
            Plan plan = plan(input, executor.snapshot());
            if (plan.preview().errors() == 0 && !plan.commands().isEmpty()) {
                long revision = executor.executeBatch(session, input.baseRevision(), requestId, plan.commands()).revision();
                Preview summary = plan.preview();
                return new Preview(revision, summary.rows(), summary.creates(), summary.updates(), summary.unchanged(), 0);
            }
            return plan.preview();
        }
    }

    private Plan plan(Input input, ModelSnapshot snapshot) {
        if (input.baseRevision() != snapshot.revision()) {
            throw new RevisionConflictException(input.baseRevision(), snapshot.revision());
        }
        String source = trim(input.source());
        if (source.isEmpty() || source.length() > 100 || input.rows() == null || input.rows().isEmpty()
                || input.rows().size() > ROW_LIMIT) {
            throw new ValidationException("请填写来源，并提供 1 至 1000 条需求");
        }
        var staged = new InMemoryModelRepository();
        staged.load(snapshot);
        ModelElement owner = staged.findElement(trim(input.ownerId()))
                .filter(element -> ElementType.fromAny(element.type()).orElse(null) == ElementType.PACKAGE)
                .orElseThrow(() -> new ValidationException("请选择有效的目标包"));
        if (ExtensionLibrary.subtreeIds(snapshot.elements()).contains(owner.id())) {
            throw new ValidationException("请选择项目中的业务包");
        }
        Map<String, InputRow> pending = new LinkedHashMap<>();
        Map<String, String> outcomes = new HashMap<>();
        List<RowResult> results = new ArrayList<>();
        for (InputRow row : input.rows()) {
            if (row == null) throw new ValidationException("存在空的需求行");
            String key = trim(row.externalId());
            if (key.isEmpty() || key.length() > 120 || trim(row.parentId()).length() > 120 || trim(row.name()).isEmpty()
                    || Objects.toString(row.text(), "").length() > 10000) {
                results.add(new RowResult(row.line(), key, "error", "检查外部 ID、名称及正文长度"));
            } else if (pending.putIfAbsent(key, row) != null) {
                results.add(new RowResult(row.line(), key, "error", "文件中存在重复的外部 ID"));
            }
        }
        ValidationEngine rules = new ValidationEngine();
        List<Command> commands = new ArrayList<>();
        while (!pending.isEmpty()) {
            int previousSize = pending.size();
            for (var iterator = pending.entrySet().iterator(); iterator.hasNext();) {
                var entry = iterator.next();
                InputRow row = entry.getValue();
                String key = entry.getKey();
                String parent = trim(row.parentId());
                if (pending.containsKey(parent)) continue;
                iterator.remove();
                String action;
                String message = "";
                try {
                    String id = stableId(source, key);
                    ModelElement existing = staged.findElement(id).orElse(null);
                    String parentId = row.parentId() == null && existing != null ? existing.ownerId()
                            : parent.isEmpty() ? owner.id() : stableId(source, parent);
                    if ("error".equals(outcomes.get(parent)) || !staged.elementExists(parentId)) {
                        throw new ValidationException("找不到父需求 " + parent);
                    }
                    List<Command> changes = planRow(row, key, id, parentId, existing);
                    for (Command change : changes) {
                        rules.validate(change, staged);
                        staged.apply(change);
                    }
                    commands.addAll(changes);
                    action = existing == null ? "create" : changes.isEmpty() ? "unchanged" : "update";
                } catch (ValidationException ex) {
                    action = "error";
                    message = ex.getMessage();
                }
                outcomes.put(key, action);
                results.add(new RowResult(row.line(), key, action, message));
            }
            if (pending.size() == previousSize) {
                pending.forEach((key, row) -> results.add(new RowResult(row.line(), key, "error", "父需求存在循环或依赖循环")));
                break;
            }
        }
        results.sort(java.util.Comparator.comparingInt(RowResult::line));
        return new Plan(new Preview(snapshot.revision(), results, count(results, "create"), count(results, "update"),
                count(results, "unchanged"), count(results, "error")), commands);
    }

    private static List<Command> planRow(InputRow row, String key, String id, String owner, ModelElement existing) {
        String raw = trim(row.status());
        String status = switch (raw) {
            case "", "草稿", "draft" -> "draft";
            case "评审中", "in_review" -> "in_review";
            case "已批准", "approved" -> "approved";
            default -> throw new ValidationException("需求状态应为草稿、评审中或已批准");
        };
        String name = trim(row.name());
        String text = Objects.toString(row.text(), "");
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("id", key);
        if (existing == null || row.text() != null) properties.put("text", text);
        if (existing == null || row.status() != null) properties.put("requirementStatus", status);
        if (existing == null) {
            return List.of(command("CREATE_ELEMENT", Map.of("id", id, "type", "Requirement", "name", name,
                    "ownerId", owner, "properties", properties)));
        }
        if (ElementType.fromAny(existing.type()).orElse(null) != ElementType.REQUIREMENT) {
            throw new ValidationException("外部标识已被其他类型对象使用");
        }
        List<Command> changes = new ArrayList<>();
        if (!existing.ownerId().equals(owner)) changes.add(command("MOVE_REQUIREMENT", Map.of("id", id, "ownerId", owner)));
        if (!existing.name().equals(name)) changes.add(command("RENAME_ELEMENT", Map.of("id", id, "name", name)));
        properties.forEach((field, value) -> {
            if (!Objects.equals(existing.properties().get(field), value)) {
                changes.add(command("UPDATE_PROPERTY", Map.of("id", id, "key", field, "value", value)));
            }
        });
        return changes;
    }

    static Command command(String type, Map<String, Object> payload) {
        return Command.of(type, 0, null, payload);
    }

    private static String stableId(String source, String externalId) {
        return "req-" + UUID.nameUUIDFromBytes((source + "\u0000" + externalId).getBytes(StandardCharsets.UTF_8));
    }

    private static int count(List<RowResult> rows, String action) {
        return (int) rows.stream().filter(row -> row.action().equals(action)).count();
    }

    private static String trim(String value) {
        return Objects.toString(value, "").trim();
    }
}
