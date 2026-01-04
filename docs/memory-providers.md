# Memory Providers

oh-my-opencode supports persistent memory for AI agents, enabling them to remember context across sessions. This guide covers the available memory providers and how to configure them.

## Overview

Memory providers give your agents long-term memory capabilities:
- Remember user preferences and project context
- Recall previous conversations and decisions
- Build knowledge over time

## Available Providers

| Provider | Type | Cost | Best For |
|----------|------|------|----------|
| **Mem0 Cloud** | Managed SaaS | Paid | Quick setup, no infrastructure |
| **Mem0 Local** | Self-hosted | Free | Privacy, full control |
| **Letta** | Self-hosted | Free | Advanced features, Copilot integration |

## Installation

### Interactive Installer

```bash
bunx oh-my-opencode install
```

Select your memory provider when prompted.

### Non-Interactive (CLI Flags)

```bash
# No memory provider
bunx oh-my-opencode install --no-tui --claude=yes --memory=no

# Mem0 Cloud (requires MEM0_API_KEY environment variable)
bunx oh-my-opencode install --no-tui --claude=yes --memory=mem0-cloud

# Mem0 Self-hosted
bunx oh-my-opencode install --no-tui --claude=yes --memory=mem0-local --memory-endpoint=http://localhost:8000/v1

# Letta
bunx oh-my-opencode install --no-tui --claude=yes --memory=letta --memory-endpoint=http://localhost:8283
```

## Provider Configuration

### Mem0 Cloud

The easiest option - managed service with no infrastructure to maintain.

**Requirements:**
- Mem0 API key (get one at [mem0.ai](https://mem0.ai))

**Setup:**
1. Set the `MEM0_API_KEY` environment variable
2. Run the installer with `--memory=mem0-cloud`

**Generated Config:**
```json
{
  "mem0": {
    "enabled": true,
    "userId": "default-user",
    "autoRehydrate": true,
    "rehydrateLayers": ["user", "project"]
  }
}
```

### Mem0 Self-Hosted

Run Mem0 on your own infrastructure for full control and privacy.

**Setup:**
1. Deploy Mem0 server (see [Mem0 docs](https://docs.mem0.ai/self-hosting))
2. Run the installer with `--memory=mem0-local --memory-endpoint=<your-endpoint>`

**Default Endpoint:** `http://localhost:8000/v1`

**Generated Config:**
```json
{
  "mem0": {
    "enabled": true,
    "endpoint": "http://localhost:8000/v1",
    "userId": "default-user",
    "autoRehydrate": true,
    "rehydrateLayers": ["user", "project"]
  }
}
```

### Letta

[Letta](https://docs.letta.com) is an open-source framework for building stateful AI agents with advanced memory capabilities.

**Setup:**
1. Run Letta server (Docker recommended)
2. Run the installer with `--memory=letta --memory-endpoint=<your-endpoint>`

**Default Endpoint:** `http://localhost:8283`

**Generated Config:**
```json
{
  "letta": {
    "enabled": true,
    "endpoint": "http://localhost:8283",
    "userId": "default-user",
    "autoRehydrate": true,
    "rehydrateLayers": ["user", "project"]
  }
}
```

## Letta with GitHub Copilot Models

Letta requires both an LLM (for reasoning) and an embedding model (for memory search). You can use GitHub Copilot models for both via the [copilot-api](https://github.com/ericc-ch/copilot-api) proxy.

### Architecture

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|      Letta       |---->|   copilot-api    |---->|  GitHub Copilot  |
|  localhost:8283  |     |  localhost:4141  |     |       API        |
|                  |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
        |
        | (optional alternative for embeddings)
        v
+------------------+
|                  |
|     Ollama       |
| localhost:11434  |
| nomic-embed-text |
|                  |
+------------------+
```

### Prerequisites

- GitHub account with active Copilot subscription
- Docker (for Letta)
- Node.js/Bun (for copilot-api)

### Step 1: Start copilot-api Proxy

The copilot-api proxy exposes GitHub Copilot as an OpenAI-compatible API.

```bash
npx copilot-api@latest start
```

On first run, it will guide you through GitHub authentication. The proxy runs on port 4141 by default.

**Supported Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (LLM) |
| `/v1/models` | GET | List available models |
| `/v1/embeddings` | POST | Text embeddings |

### Step 2: Start Letta with Copilot

Run Letta configured to use copilot-api as its LLM provider:

```bash
docker run \
  -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
  -p 8283:8283 \
  -e OPENAI_API_BASE="http://host.docker.internal:4141/v1" \
  -e OPENAI_API_KEY="dummy" \
  letta/letta:latest
```

**Note:** `host.docker.internal` allows the Docker container to reach services on your host machine. On Linux, you may need to use `--network=host` or the actual host IP.

### Step 3: Configure oh-my-opencode

```bash
bunx oh-my-opencode install --no-tui --claude=yes --memory=letta --memory-endpoint=http://localhost:8283
```

### Alternative: Ollama for Embeddings

If copilot-api embeddings are slow or you prefer local embeddings, use Ollama:

1. **Install Ollama and pull an embedding model:**
   ```bash
   # Install Ollama (macOS)
   brew install ollama
   
   # Start Ollama
   ollama serve
   
   # Pull embedding model
   ollama pull nomic-embed-text
   ```

2. **Run Letta with both providers:**
   ```bash
   docker run \
     -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
     -p 8283:8283 \
     -e OPENAI_API_BASE="http://host.docker.internal:4141/v1" \
     -e OPENAI_API_KEY="dummy" \
     -e OLLAMA_BASE_URL="http://host.docker.internal:11434" \
     letta/letta:latest
   ```

3. **Configure Letta to use Ollama for embeddings:**
   In the Letta web UI or API, set the embedding model to use Ollama's `nomic-embed-text`.

## Troubleshooting

### copilot-api: Authentication Failed

```bash
# Re-authenticate
npx copilot-api@latest auth
```

### Letta: Cannot Connect to copilot-api

1. Verify copilot-api is running: `curl http://localhost:4141/v1/models`
2. On Linux with Docker, try `--network=host` instead of `host.docker.internal`
3. Check firewall settings

### Letta: Embeddings Not Working

1. Verify the embeddings endpoint: `curl -X POST http://localhost:4141/v1/embeddings -H "Content-Type: application/json" -d '{"input": "test", "model": "text-embedding-ada-002"}'`
2. If slow, consider using Ollama for embeddings instead

### Mem0: API Key Not Found

Ensure `MEM0_API_KEY` is set in your environment:
```bash
export MEM0_API_KEY="your-api-key"
```

Or add it to your shell profile (`~/.bashrc`, `~/.zshrc`).

## CLI Reference

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--memory` | `no`, `mem0-cloud`, `mem0-local`, `letta` | `no` | Memory provider to use |
| `--memory-endpoint` | URL | Provider-specific | Custom endpoint URL |

**Default Endpoints:**
- Mem0 Local: `http://localhost:8000/v1`
- Letta: `http://localhost:8283`

## See Also

- [Letta Documentation](https://docs.letta.com)
- [Mem0 Documentation](https://docs.mem0.ai)
- [copilot-api Repository](https://github.com/ericc-ch/copilot-api)
- [Ollama](https://ollama.ai)
