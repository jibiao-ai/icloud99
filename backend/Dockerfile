# ===== build =====
FROM golang:1.22-alpine AS build
WORKDIR /src
# 国内服务器无法直连 proxy.golang.org，默认使用 goproxy.cn；可用 --build-arg GOPROXY=... 覆盖
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/icloud99-api ./cmd/server

# ===== runtime =====
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
USER app
COPY --from=build /out/icloud99-api /usr/local/bin/icloud99-api
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/icloud99-api"]
