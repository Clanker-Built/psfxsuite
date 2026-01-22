# Build stage
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /postfixrelay .

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata sudo postfix su-exec

# Create non-root user
RUN adduser -D -u 1000 postfixrelay

# Copy binary
COPY --from=builder /postfixrelay /usr/local/bin/postfixrelay

# Copy sudoers config
COPY docker/sudoers.d/postfixrelay /etc/sudoers.d/postfixrelay
RUN chmod 0440 /etc/sudoers.d/postfixrelay

# Copy scripts
COPY docker/scripts/safe-postsuper.sh /opt/postfixrelay/scripts/safe-postsuper.sh
COPY docker/scripts/entrypoint.sh /opt/postfixrelay/scripts/entrypoint.sh
RUN chmod 0755 /opt/postfixrelay/scripts/safe-postsuper.sh /opt/postfixrelay/scripts/entrypoint.sh

# Create data directory
RUN mkdir -p /data && chown postfixrelay:postfixrelay /data

# Start as root, entrypoint will drop privileges after fixing permissions
EXPOSE 8080

ENV DB_PATH=/data/postfixrelay.db
ENV LOG_LEVEL=info

ENTRYPOINT ["/opt/postfixrelay/scripts/entrypoint.sh"]
CMD ["/usr/local/bin/postfixrelay"]
