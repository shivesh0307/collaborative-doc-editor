# ---------- build stage ----------
FROM maven:3.9.4-eclipse-temurin-17 AS build
WORKDIR /workspace

# copy maven metadata first to utilize docker cache
COPY pom.xml .
# if you have settings.xml or .m2 settings, copy them here
# COPY settings.xml /root/.m2/settings.xml

COPY src ./src
RUN mvn -B -DskipTests package

# ---------- runtime stage ----------
FROM eclipse-temurin:17-jre
WORKDIR /app
ARG JAR_FILE=/workspace/target/*.jar
COPY --from=build ${JAR_FILE} app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
    