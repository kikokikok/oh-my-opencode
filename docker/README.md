# Oh-My-OpenCode Docker Stack

Self-sufficient Docker setup for oh-my-opencode with Letta memory server. Uses GitHub Copilot API by default (free with subscription) - no API keys required!

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Host Machine                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  OpenCode + oh-my-opencode                                    │   │
│  │  (runs on host, connects to Docker services)                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         │                              │                            │
│         ▼                              ▼                            │
│    localhost:8283                 localhost:4141                    │
│         │                              │                            │
├─────────┼──────────────────────────────┼────────────────────────────┤
│         ▼                              │                            │
│  ┌────────────┐                        │                            │
│  │   Letta    │◄───────────────────────┘                            │
│  │  Server    │   (connects to Copilot API                          │
│  │  :8283     │    via host.docker.internal:4141)                   │
│  └─────┬──────┘                                                     │
│        │                                                            │
│        ▼                                                            │
│  ┌────────────┐      ┌─────────────┐      ┌──────────────────┐     │
│  │ PostgreSQL │      │ Copilot API │      │  LiteLLM         │     │
│  │  (Letta)   │      │ (on host)   │      │  (alternative)   │     │
│  └────────────┘      └─────────────┘      └──────────────────┘     │
│     Docker               Host                Docker (optional)      │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start (Copilot API - Default)

**Prerequisites:** GitHub Copilot subscription (Individual, Business, or Enterprise)

```bash
# 1. Start Copilot API proxy on port 4141 (in one terminal)
npx copilot-api@latest start --port 4141

# 2. Start Letta (in another terminal)
cd docker
docker compose up -d

# 3. Verify Letta can reach Copilot API
curl http://localhost:8283/v1/health

# 4. Run OpenCode
opencode
```

**That's it!** Letta automatically connects to Copilot API at `host.docker.internal:4141` for both LLM and embeddings. No API keys needed.

## Devcontainer Setup (VS Code)

For a fully self-contained development environment using VS Code devcontainers:

### Architecture (Devcontainer)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Host Machine                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Copilot API (npx copilot-api@latest start --port 4141)    │ │
│  │  localhost:4141                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│         ▲                                                       │
│         │ (forwarded into container)                            │
├─────────┼───────────────────────────────────────────────────────┤
│         ▼                     Devcontainer                      │
│  ┌────────────┐    ┌────────────┐    ┌────────────────────────┐│
│  │ PostgreSQL │◄───│   Letta    │◄───│ OpenCode+oh-my-opencode││
│  │   :5432    │    │   :8283    │    │   (terminal)           ││
│  └────────────┘    └────────────┘    └────────────────────────┘│
│                           │                                     │
│                           ▼                                     │
│                    localhost:4141 (Copilot API)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Quick Start (Devcontainer)

```bash
# 1. On your host machine, start Copilot API
npx copilot-api@latest start --port 4141

# 2. Open the docker folder in VS Code
code docker/

# 3. When prompted, click "Reopen in Container"
#    Or use Command Palette: "Dev Containers: Reopen in Container"

# 4. Wait for the container to build and services to start
#    PostgreSQL and Letta will start automatically

# 5. Open a terminal in VS Code and run:
opencode
```

### What's Included

The devcontainer comes pre-configured with:

| Component | Description |
|-----------|-------------|
| **PostgreSQL** | Letta's database (auto-initialized) |
| **Letta Server** | Memory server on port 8283 |
| **OpenCode** | Latest version with oh-my-opencode plugin |
| **Bun** | JavaScript runtime |
| **VS Code Extensions** | ESLint, Prettier, Tailwind CSS, Python, Go, Rust |

### Configuration Files

The devcontainer includes pre-configured:

- `.devcontainer/opencode.json` - Registers oh-my-opencode plugin
- `.devcontainer/oh-my-opencode.json` - Configures Letta + Copilot API models

### Services Startup

When the container starts, `start-services.sh` automatically:
1. Initializes PostgreSQL (if first run)
2. Starts PostgreSQL
3. Creates the Letta database and user
4. Starts Letta server on port 8283

Logs are available at:
- PostgreSQL: `/var/log/postgresql/postgresql.log`
- Letta: `/var/log/letta/letta.log`

### Troubleshooting (Devcontainer)

**Container won't build:**
```bash
# Rebuild without cache
docker compose -f .devcontainer/docker-compose.yml build --no-cache
```

**Services didn't start:**
```bash
# Manually run the startup script
/usr/local/bin/start-services.sh

# Check service status
sudo -u postgres /usr/lib/postgresql/*/bin/pg_isready
curl http://localhost:8283/v1/health
```

**Copilot API not accessible:**
```bash
# Verify port forwarding is working
curl http://localhost:4141/v1/models

# If not, ensure Copilot API is running on host
# and port 4141 is forwarded in devcontainer.json
```

### Copilot API Provides Everything

GitHub Copilot API includes:
- **LLM models**: GPT-5, Claude Opus 4.5, Gemini, Grok, etc.
- **Embedding models**: `text-embedding-3-small`, `text-embedding-ada-002`

Letta uses these for memory operations (archival search, summarization).

## Alternative: Using LiteLLM

If you have API keys and prefer LiteLLM:

```bash
# 1. Create .env with your API keys
cat > .env << 'EOF'
OPENAI_API_KEY=sk-your-key
OPENAI_API_BASE=http://litellm:4141/v1
EOF

# 2. Start with LiteLLM profile
docker compose --profile litellm up -d

# 3. Run OpenCode
opencode
```

## Components

| Service | Port | Description |
|---------|------|-------------|
| **Letta** | 8283 | Memory server with archival/core memory |
| **PostgreSQL** | 5432 | Letta's database (internal) |
| **Copilot API** | 4141 | GitHub Copilot proxy (default, runs on host) |
| **LiteLLM** | 4141 | LLM/Embedding proxy (alternative, `--profile litellm`) |

## Configuration

### oh-my-opencode Configuration

Create `~/.config/opencode/oh-my-opencode.json`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",

  "letta": {
    "enabled": true,
    "endpoint": "http://localhost:8283",
    "userId": "default-user",
    "autoRehydrate": true,
    "rehydrateLayers": ["user", "project"]
    // Embedding model is auto-detected from Copilot API
  },

  "agents": {
    "Sisyphus": { "model": "github-copilot/claude-opus-4.5" },
    "oracle": { "model": "github-copilot/gpt-5.2" },
    "librarian": { "model": "github-copilot/claude-sonnet-4.5" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },
    "frontend-ui-ux-engineer": { "model": "github-copilot/gemini-3-flash-preview" },
    "document-writer": { "model": "github-copilot/claude-sonnet-4.5" },
    "multimodal-looker": { "model": "github-copilot/claude-opus-4.5" }
  }
}
```

### Environment Variables

The `.env` file is optional for Copilot API setup. Only needed for customization:

```bash
# Default: Copilot API on host (no changes needed)
# OPENAI_API_BASE=http://host.docker.internal:4141/v1
# OPENAI_API_KEY=dummy

# For LiteLLM: Override these
# OPENAI_API_BASE=http://litellm:4141/v1
# OPENAI_API_KEY=sk-your-actual-key

# Letta PostgreSQL (defaults are fine for local dev)
LETTA_POSTGRES_USER=letta
LETTA_POSTGRES_PASSWORD=letta
LETTA_POSTGRES_DB=letta
```

### LiteLLM Configuration (Optional)

Only needed if using `--profile litellm`. Edit `litellm-config.yaml`:

```yaml
model_list:
  - model_name: text-embedding-3-small
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      mode: embedding

  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

## How Letta Uses the API

Letta needs an OpenAI-compatible API for:

1. **Embeddings** - Semantic search in archival memory (`/v1/embeddings`)
2. **LLM** - Agent reasoning for memory operations (`/v1/chat/completions`)

Both Copilot API and LiteLLM provide these endpoints. The Docker setup defaults to Copilot API because:
- Free with GitHub Copilot subscription
- No API keys to manage
- Full model selection (GPT, Claude, Gemini, Grok)

## Memory Layers

Letta organizes memories into layers:

| Layer | Scope | Use Case |
|-------|-------|----------|
| `user` | Per user across all projects | Personal preferences, coding style |
| `session` | Current session only | Temporary context, current task |
| `project` | Per project | Project conventions, architecture |
| `team` | Team-wide | Team standards, shared knowledge |
| `org` | Organization | Company policies, guidelines |

Configure auto-rehydration:

```json
{
  "letta": {
    "autoRehydrate": true,
    "rehydrateLayers": ["user", "project"]
  }
}
```

## Troubleshooting

### Letta Can't Connect to Copilot API

```bash
# 1. Verify Copilot API is running on port 4141
curl http://localhost:4141/v1/models | jq '.data[].id' | head -5

# 2. Check Letta logs
docker logs omo-letta --tail 50

# 3. Test from inside Letta container
docker exec omo-letta curl http://host.docker.internal:4141/v1/models
```

**Common issues:**
- Copilot API not running → Start with `npx copilot-api@latest start --port 4141`
- Wrong port → Copilot API must be on port 4141 (Letta's default)
- Docker network → `host.docker.internal` should resolve to host machine

### Embedding Errors

```bash
# Test embeddings directly
curl -X POST http://localhost:4141/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": ["test"], "model": "text-embedding-3-small"}'
```

If embeddings fail, check that Copilot API supports the model:
```bash
curl http://localhost:4141/v1/models | jq '.data[] | select(.id | contains("embedding"))'
```

### Port Conflicts

If port 4141 is in use:

```bash
# Check what's using port 4141
lsof -i :4141

# Use a different port for Copilot API
npx copilot-api@latest start --port 4142

# Update docker-compose or .env
echo "OPENAI_API_BASE=http://host.docker.internal:4142/v1" >> .env
docker compose up -d
```

### Reset Letta Data

```bash
# Stop and remove containers + volumes
docker compose down -v

# Restart fresh
docker compose up -d
```

## Backup and Restore

### Backup

```bash
# Backup PostgreSQL database
docker exec omo-postgres pg_dump -U letta letta > backup.sql

# Or backup the entire volume
docker run --rm -v omo-postgres-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/letta-backup.tar.gz /data
```

### Restore

```bash
# Restore from SQL dump
cat backup.sql | docker exec -i omo-postgres psql -U letta letta

# Or restore volume
docker run --rm -v omo-postgres-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/letta-backup.tar.gz -C /
```

## Production Deployment

For production, use the production compose override:

```bash
# Create production .env
cp .env.example .env
# Edit with secure passwords

# Start with production config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Production config adds:
- Resource limits (CPU, memory)
- Log rotation
- Proper restart policies

## Upgrading

```bash
# Pull latest images
docker compose pull

# Restart services
docker compose up -d

# Update oh-my-opencode
bunx oh-my-opencode@latest install
```
