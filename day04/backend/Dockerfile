# 多阶段构建：构建期 Maven，运行期只保留 JRE + jar。
# ARG 必须在第一个 FROM 之前声明，才能在 FROM 里引用（用于切换镜像源）。
ARG MAVEN_BASE=maven:3.9-eclipse-temurin-17
ARG JRE_BASE=eclipse-temurin:17-jre

FROM ${MAVEN_BASE} AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests

FROM ${JRE_BASE} AS runtime
WORKDIR /app
COPY --from=build /build/target/blog-backend.jar app.jar
EXPOSE 8081
ENV SERVER_PORT=8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
