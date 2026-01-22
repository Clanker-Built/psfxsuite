# PSFXSuite

A modern web application for managing Postfix.

## Features

- **Configuration Management**: Structured UI for Postfix relay settings with validation and rollback
- **Real-time Log Viewer**: Live streaming of mail logs with search and filtering
- **Alerting**: Configurable alerts for queue growth, delivery failures, and more
- **Queue Management**: Inspect and manage the mail queue
- **Audit Trail**: Complete history of administrative actions
- **Role-Based Access**: Admin, Operator, and Auditor roles

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for frontend development)
- Go 1.21+ (for backend development)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/postfixrelay/postfixrelay.git
cd postfixrelay

# Start all services
docker-compose up -d

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:8080
# Default login: admin / admin
```

### Project Structure

```
postfixrelay/
├── backend/           # Go backend service
│   ├── internal/      # Internal packages
│   │   ├── api/       # HTTP handlers
│   │   ├── config/    # Configuration
│   │   └── database/  # Database layer
│   └── main.go        # Entry point
├── frontend/          # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── pages/       # Page components
│   │   ├── stores/      # Zustand stores
│   │   └── lib/         # Utilities
│   └── package.json
├── docker/            # Docker configurations
│   └── postfix/       # Test Postfix container
├── docs/              # Documentation
│   ├── 01-DEBATE-TRANSCRIPT.md
│   ├── 02-SYSTEM-DESIGN-SPEC.md
│   ├── 03-IMPLEMENTATION-PLAN.md
│   └── 04-TEST-PLAN.md
└── docker-compose.yml
```

## Documentation

- [Debate Transcript](docs/01-DEBATE-TRANSCRIPT.md) - Design decisions and rationale
- [System Design Spec](docs/02-SYSTEM-DESIGN-SPEC.md) - Technical specification
- [Implementation Plan](docs/03-IMPLEMENTATION-PLAN.md) - Development roadmap
- [Test Plan](docs/04-TEST-PLAN.md) - Testing strategy

## Development

### Backend

```bash
cd backend
go run main.go
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Running Tests

```bash
# Backend tests
cd backend
go test -v ./...

# Frontend tests
cd frontend
npm test
```

## Configuration

Environment variables for the backend:

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_ADDR` | `:8080` | Server listen address |
| `DB_PATH` | `./data/postfixrelay.db` | SQLite database path |
| `APP_SECRET` | (required) | Application secret for sessions |
| `DB_ENCRYPTION_KEY` | (required) | Key for encrypting secrets |
| `POSTFIX_CONFIG_DIR` | `/etc/postfix` | Postfix configuration directory |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## Security

- All secrets are encrypted at rest using AES-256-GCM
- Passwords are hashed with Argon2id
- Session tokens are 256-bit random values
- RBAC enforced on all API endpoints
- CSRF protection enabled

## License

MIT License - see LICENSE file for details.
