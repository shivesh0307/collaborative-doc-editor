# ---------- build stage ----------
FROM maven:3.9.4-eclipse-temurin-17 AS build
WORKDIR /workspace

# copy maven metadata first to utilize docker cache
COPY pom.xml .
# Download dependencies first (better caching)
RUN mvn dependency:go-offline -B

# Then copy source and build
COPY src ./src
RUN mvn -B -DskipTests package

# ---------- runtime stage ----------
FROM eclipse-temurin:17-jre
WORKDIR /app
ARG JAR_FILE=/workspace/target/*.jar
COPY --from=build ${JAR_FILE} app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
    