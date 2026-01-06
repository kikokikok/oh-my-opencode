import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { MCPInvoker } from "./providers/mcp"
import type { MCPProviderConfig, MCPTransportType } from "./types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import { createCleanMcpEnvironment } from "../skill-mcp-manager/env-cleaner"

type Transport = StdioClientTransport | SSEClientTransport

interface ManagedClient {
  client: Client
  transport: Transport
  transportType: MCPTransportType
  serverName: string
  lastUsedAt: number
}

/**
 * Manages MCP server connections for knowledge providers.
 * Implements MCPInvoker interface to allow MCPKnowledgeProvider to invoke tools.
 *
 * Based on SkillMcpManager pattern but simplified for knowledge provider use case.
 */
export class KnowledgeMcpManager implements MCPInvoker {
  private clients: Map<string, ManagedClient> = new Map()
  private pendingConnections: Map<string, Promise<Client>> = new Map()
  private serverConfigs: Map<string, MCPProviderConfig> = new Map()
  private cleanupRegistered = false
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000

  /**
   * Register an MCP server configuration.
   * The server will be started lazily on first invoke.
   */
  registerServer(config: MCPProviderConfig): void {
    this.serverConfigs.set(config.name, config)
  }

  /**
   * Unregister an MCP server and disconnect if connected.
   */
  async unregisterServer(serverName: string): Promise<void> {
    this.serverConfigs.delete(serverName)
    await this.disconnectServer(serverName)
  }

  /**
   * Check if an MCP server is available (registered and can connect).
   */
  async isServerAvailable(serverName: string): Promise<boolean> {
    const config = this.serverConfigs.get(serverName)
    if (!config) {
      return false
    }

    try {
      const client = await this.getOrCreateClient(serverName)
      return client !== null
    } catch {
      return false
    }
  }

  /**
   * Invoke a tool on an MCP server.
   */
  async invoke(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.getOrCreateClient(serverName)
    if (!client) {
      throw new Error(`MCP server "${serverName}" is not available`)
    }

    const result = await client.callTool({ name: toolName, arguments: args })
    return result.content
  }

  /**
   * Get or create a client for the given server.
   */
  private async getOrCreateClient(serverName: string): Promise<Client | null> {
    const existing = this.clients.get(serverName)
    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing.client
    }

    const pending = this.pendingConnections.get(serverName)
    if (pending) {
      return pending
    }

    const config = this.serverConfigs.get(serverName)
    if (!config) {
      return null
    }

    const expandedConfig = expandEnvVarsInObject(config) as MCPProviderConfig
    const connectionPromise = this.createClient(serverName, expandedConfig)
    this.pendingConnections.set(serverName, connectionPromise)

    try {
      const client = await connectionPromise
      return client
    } finally {
      this.pendingConnections.delete(serverName)
    }
  }

  /**
   * Create a new MCP client connection.
   */
  private async createClient(
    serverName: string,
    config: MCPProviderConfig
  ): Promise<Client> {
    const transportType = config.transport ?? "stdio"

    this.registerProcessCleanup()

    const client = new Client(
      { name: `knowledge-mcp-${serverName}`, version: "1.0.0" },
      { capabilities: {} }
    )

    let transport: Transport

    if (transportType === "sse") {
      transport = await this.createSseTransport(serverName, config, client)
    } else {
      transport = await this.createStdioTransport(serverName, config, client)
    }

    this.clients.set(serverName, {
      client,
      transport,
      transportType,
      serverName,
      lastUsedAt: Date.now(),
    })
    this.startCleanupTimer()
    return client
  }

  private async createStdioTransport(
    serverName: string,
    config: MCPProviderConfig,
    client: Client
  ): Promise<StdioClientTransport> {
    if (!config.command) {
      throw new Error(
        `MCP server "${serverName}" is missing required 'command' field for stdio transport.\n\n` +
          `Example:\n` +
          `  {\n` +
          `    "name": "${serverName}",\n` +
          `    "command": "npx",\n` +
          `    "args": ["-y", "@some/mcp-server"],\n` +
          `    "searchTool": "search"\n` +
          `  }`
      )
    }

    const command = config.command
    const args = config.args || []
    const mergedEnv = createCleanMcpEnvironment(config.env)

    const transport = new StdioClientTransport({
      command,
      args,
      env: mergedEnv,
      stderr: "ignore",
    })

    try {
      await client.connect(transport)
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // Process may already be terminated
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to connect to MCP server "${serverName}" via stdio.\n\n` +
          `Command: ${command} ${args.join(" ")}\n` +
          `Reason: ${errorMessage}\n\n` +
          `Hints:\n` +
          `  - Ensure the command is installed and available in PATH\n` +
          `  - Check if the MCP server package exists\n` +
          `  - Verify the args are correct for this server`
      )
    }

    return transport
  }

  private async createSseTransport(
    serverName: string,
    config: MCPProviderConfig,
    client: Client
  ): Promise<SSEClientTransport> {
    if (!config.url) {
      throw new Error(
        `MCP server "${serverName}" is missing required 'url' field for SSE transport.\n\n` +
          `Example:\n` +
          `  {\n` +
          `    "name": "${serverName}",\n` +
          `    "transport": "sse",\n` +
          `    "url": "http://localhost:60062/sse",\n` +
          `    "searchTool": "search"\n` +
          `  }\n\n` +
          `Note: SSE servers must be started manually before connecting.`
      )
    }

    const transport = new SSEClientTransport(new URL(config.url))

    try {
      await client.connect(transport)
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // Transport may already be closed
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to connect to MCP server "${serverName}" via SSE.\n\n` +
          `URL: ${config.url}\n` +
          `Reason: ${errorMessage}\n\n` +
          `Hints:\n` +
          `  - Ensure the MCP server is running at ${config.url}\n` +
          `  - SSE servers (like Dust CLI) must be started manually\n` +
          `  - Check if the port is correct (Dust uses dynamic ports)\n` +
          `  - Verify the URL ends with /sse if required by the server`
      )
    }

    return transport
  }

  /**
   * Disconnect a specific server.
   */
  private async disconnectServer(serverName: string): Promise<void> {
    const managed = this.clients.get(serverName)
    if (!managed) {
      return
    }

    this.clients.delete(serverName)
    try {
      await managed.client.close()
    } catch {
      // Ignore close errors - process may already be terminated
    }
    try {
      await managed.transport.close()
    } catch {
      // Transport may already be terminated
    }
  }

  /**
   * Disconnect all servers and clean up.
   */
  async disconnectAll(): Promise<void> {
    this.stopCleanupTimer()
    const clients = Array.from(this.clients.values())
    this.clients.clear()
    for (const managed of clients) {
      try {
        await managed.client.close()
      } catch {
        // Process may already be terminated
      }
      try {
        await managed.transport.close()
      } catch {
        // Transport may already be terminated
      }
    }
  }

  private registerProcessCleanup(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true

    const cleanup = async () => {
      for (const [, managed] of this.clients) {
        try {
          await managed.client.close()
        } catch {
          // Ignore errors during cleanup
        }
        try {
          await managed.transport.close()
        } catch {
          // Transport may already be terminated
        }
      }
      this.clients.clear()
      this.pendingConnections.clear()
    }

    process.on("SIGINT", async () => {
      await cleanup()
      process.exit(0)
    })
    process.on("SIGTERM", async () => {
      await cleanup()
      process.exit(0)
    })
    if (process.platform === "win32") {
      process.on("SIGBREAK", async () => {
        await cleanup()
        process.exit(0)
      })
    }
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleClients()
    }, 60_000)
    this.cleanupInterval.unref()
  }

  private stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  private async cleanupIdleClients(): Promise<void> {
    const now = Date.now()
    for (const [serverName, managed] of this.clients) {
      if (now - managed.lastUsedAt > this.IDLE_TIMEOUT) {
        this.clients.delete(serverName)
        try {
          await managed.client.close()
        } catch {
          // Process may already be terminated
        }
        try {
          await managed.transport.close()
        } catch {
          // Transport may already be terminated
        }
      }
    }
  }

  /**
   * Get list of registered server names.
   */
  getRegisteredServers(): string[] {
    return Array.from(this.serverConfigs.keys())
  }

  /**
   * Get list of connected server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Check if a server is currently connected.
   */
  isConnected(serverName: string): boolean {
    return this.clients.has(serverName)
  }
}
