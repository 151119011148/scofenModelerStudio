FROM eclipse-temurin:17-jre

WORKDIR /app
COPY scofen-web/target/scofen-server.jar /app/scofen-server.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/scofen-server.jar"]
