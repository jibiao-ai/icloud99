# ===== build =====
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cloudwatch-api ./cmd/server

# ===== runtime =====
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
USER app
COPY --from=build /out/cloudwatch-api /usr/local/bin/cloudwatch-api
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/cloudwatch-api"]
