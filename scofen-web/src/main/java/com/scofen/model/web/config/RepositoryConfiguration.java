package com.scofen.model.web.config;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import com.scofen.model.xmi.XmiExchangeService;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Map;

@Configuration
public class RepositoryConfiguration {

    @Bean
    public InMemoryModelRepository modelRepository() {
        return new InMemoryModelRepository();
    }

    @Bean
    public PatchWebSocketHandler patchWebSocketHandler() {
        return new PatchWebSocketHandler();
    }

    @Bean
    public PatchBroker patchBroker(PatchWebSocketHandler handler) {
        return new PatchBroker(handler);
    }

    @Bean
    public CommandExecutor commandExecutor(InMemoryModelRepository repository, PatchBroker broker) {
        return new CommandExecutor(repository, new ValidationEngine(), broker);
    }

    @Bean
    public XmiExchangeService xmiExchangeService() {
        return new XmiExchangeService();
    }

    /** 示例项目覆盖九大图，便于 M0 验收「A 改名、B 立即看到」。 */
    @Bean
    public ApplicationRunner sampleModel(CommandExecutor executor) {
        return args -> {
            run(executor, "CREATE_ELEMENT", Map.of("id", "pkg-1", "type", "Package",
                    "name", "车载动力系统", "ownerId", ""));
            run(executor, "CREATE_ELEMENT", Map.of("id", "e-vcu", "type", "Block",
                    "name", "整车控制器", "ownerId", "pkg-1"));
            run(executor, "CREATE_ELEMENT", Map.of("id", "e-bat", "type", "Block",
                    "name", "动力电池", "ownerId", "pkg-1"));
            run(executor, "CREATE_ELEMENT", Map.of("id", "e-motor", "type", "Block",
                    "name", "驱动电机", "ownerId", "pkg-1"));
            run(executor, "CREATE_ELEMENT", Map.of("id", "r-range", "type", "Requirement",
                    "name", "续航里程 ≥ 500km", "ownerId", "pkg-1"));
            run(executor, "CREATE_RELATIONSHIP", Map.of("id", "rel-1", "type", "satisfy",
                    "sourceId", "e-vcu", "targetId", "r-range"));

            List<String> refs = List.of("e-vcu", "e-bat", "e-motor", "r-range");
            int index = 0;
            for (DiagramKind kind : DiagramKind.values()) {
                run(executor, "CREATE_DIAGRAM", Map.of(
                        "id", "d-" + kind.code(),
                        "kind", kind.code(),
                        "name", kind.label() + "示例",
                        "elementIds", refs));
                index++;
            }
        };
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }
}
