package com.scofen.model.web.project;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.scofen.model.web.persistence.MysqlSchema;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Project metadata has its own lifecycle and is not rolled back with model commands. */
@Component
public final class ProjectRecords {
    private record Key(String project, String kind, String id) {}

    private final Map<Key, String> memory = new ConcurrentHashMap<>();
    private final ObjectMapper json = new ObjectMapper();
    private final JdbcTemplate jdbc;

    public ProjectRecords(ObjectProvider<JdbcTemplate> templates) {
        jdbc = templates.getIfAvailable();
    }

    public <T> Optional<T> find(String project, String kind, String id, Class<T> type) {
        if (jdbc == null) {
            return Optional.ofNullable(memory.get(new Key(project, kind, id))).map(value -> decode(value, type));
        }
        MysqlSchema.ensure(jdbc);
        return jdbc.query("SELECT payload FROM scofen_project_record WHERE project_id=? AND kind=? AND record_id=?",
                (row, index) -> decode(row.getString(1), type), project, kind, id).stream().findFirst();
    }

    public <T> List<T> list(String project, String kind, Class<T> type) {
        if (jdbc == null) {
            return memory.entrySet().stream()
                    .filter(entry -> entry.getKey().project().equals(project) && entry.getKey().kind().equals(kind))
                    .map(entry -> decode(entry.getValue(), type)).toList();
        }
        MysqlSchema.ensure(jdbc);
        return jdbc.query("SELECT payload FROM scofen_project_record WHERE project_id=? AND kind=?",
                (row, index) -> decode(row.getString(1), type), project, kind);
    }

    public void save(String project, String kind, String id, Object value) {
        String payload;
        try {
            payload = json.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("项目记录序列化失败", ex);
        }
        if (jdbc == null) {
            memory.put(new Key(project, kind, id), payload);
            return;
        }
        MysqlSchema.ensure(jdbc);
        jdbc.update("INSERT INTO scofen_project_record (project_id, kind, record_id, payload) VALUES (?, ?, ?, ?) "
                        + "AS incoming ON DUPLICATE KEY UPDATE payload=incoming.payload",
                project, kind, id, payload);
    }

    public void delete(String project, String kind, String id) {
        if (jdbc == null) {
            memory.remove(new Key(project, kind, id));
            return;
        }
        MysqlSchema.ensure(jdbc);
        jdbc.update("DELETE FROM scofen_project_record WHERE project_id=? AND kind=? AND record_id=?", project, kind, id);
    }

    public void forget(String project) {
        memory.keySet().removeIf(key -> key.project().equals(project));
    }

    private <T> T decode(String value, Class<T> type) {
        try {
            return json.readValue(value, type);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("项目记录反序列化失败", ex);
        }
    }
}
