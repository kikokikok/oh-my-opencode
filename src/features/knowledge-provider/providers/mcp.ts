import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
  MCPProviderConfig,
  KnowledgeItemType,
} from "../types"

export interface MCPInvoker {
  invoke(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown>
  isServerAvailable(serverName: string): Promise<boolean>
}

export class MCPKnowledgeProvider implements KnowledgeProvider {
  readonly name: string
  readonly type = "mcp" as const
  readonly description: string

  private config: MCPProviderConfig
  private invoker: MCPInvoker
  private initialized = false

  constructor(config: MCPProviderConfig, invoker: MCPInvoker) {
    this.config = config
    this.invoker = invoker
    this.name = `mcp:${config.name}`
    this.description = `MCP knowledge provider via ${config.name}`
  }

  async initialize(): Promise<void> {
    const available = await this.invoker.isServerAvailable(this.config.name)
    if (!available) {
      throw new Error(`MCP server "${this.config.name}" is not available`)
    }
    this.initialized = true
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]> {
    if (!this.initialized) {
      return []
    }

    try {
      const result = await this.invoker.invoke(
        this.config.name,
        this.config.searchTool,
        {
          query: query.text,
          limit: query.limit ?? 10,
          ...this.config.config,
        }
      )

      return this.parseSearchResponse(result, query.includeContent)
    } catch {
      return []
    }
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    if (!this.initialized || !this.config.getTool) {
      return null
    }

    try {
      const result = await this.invoker.invoke(
        this.config.name,
        this.config.getTool,
        { id }
      )

      return this.parseGetResponse(result)
    } catch {
      return null
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const now = new Date().toISOString()

    try {
      const start = Date.now()
      const available = await this.invoker.isServerAvailable(this.config.name)
      const latencyMs = Date.now() - start

      if (!available) {
        return {
          status: "unavailable",
          message: `MCP server "${this.config.name}" is not available`,
          lastChecked: now,
        }
      }

      return {
        status: "healthy",
        latencyMs,
        lastChecked: now,
      }
    } catch (error) {
      return {
        status: "degraded",
        message: error instanceof Error ? error.message : "Unknown error",
        lastChecked: now,
      }
    }
  }

  async dispose(): Promise<void> {
    this.initialized = false
  }

  private parseSearchResponse(
    response: unknown,
    includeContent?: boolean
  ): KnowledgeSearchResult[] {
    if (!response) {
      return []
    }

    if (Array.isArray(response)) {
      return response.map((item, index) =>
        this.responseItemToSearchResult(item, index, includeContent)
      )
    }

    const obj = response as Record<string, unknown>
    if (obj.results && Array.isArray(obj.results)) {
      return (obj.results as unknown[]).map((item, index) =>
        this.responseItemToSearchResult(item, index, includeContent)
      )
    }

    if (obj.items && Array.isArray(obj.items)) {
      return (obj.items as unknown[]).map((item, index) =>
        this.responseItemToSearchResult(item, index, includeContent)
      )
    }

    return [this.responseItemToSearchResult(response, 0, includeContent)]
  }

  private responseItemToSearchResult(
    item: unknown,
    index: number,
    includeContent?: boolean
  ): KnowledgeSearchResult {
    const obj = (item ?? {}) as Record<string, unknown>

    const id = String(obj.id ?? obj.document_id ?? obj.url ?? `result-${index}`)
    const title = String(obj.title ?? obj.name ?? "Untitled")
    const summary = String(
      obj.summary ?? obj.snippet ?? obj.excerpt ?? obj.description ?? ""
    )
    const content = obj.content ?? obj.text ?? obj.body
    const score = Number(obj.score ?? obj.relevance ?? obj.similarity ?? 0.5)
    const url = obj.url ? String(obj.url) : undefined

    const knowledgeItem: KnowledgeItem = {
      id: `${this.name}::${id}`,
      provider: this.name,
      title,
      summary: summary.slice(0, 200),
      content: includeContent && content ? String(content) : undefined,
      type: this.inferType(obj),
      metadata: {
        sourceType: "mcp",
        sourceId: id,
        url,
        extra: obj,
      },
    }

    return {
      item: knowledgeItem,
      score: Math.min(Math.max(score, 0), 1),
      highlights: obj.highlights
        ? (obj.highlights as string[])
        : obj.snippet
          ? [String(obj.snippet)]
          : undefined,
    }
  }

  private parseGetResponse(response: unknown): KnowledgeItem | null {
    if (!response) {
      return null
    }

    const obj = response as Record<string, unknown>
    const id = String(obj.id ?? obj.document_id ?? "unknown")
    const title = String(obj.title ?? obj.name ?? "Untitled")
    const content = String(obj.content ?? obj.text ?? obj.body ?? "")

    return {
      id: `${this.name}::${id}`,
      provider: this.name,
      title,
      summary: content.slice(0, 200),
      content,
      type: this.inferType(obj),
      metadata: {
        sourceType: "mcp",
        sourceId: id,
        url: obj.url ? String(obj.url) : undefined,
        extra: obj,
      },
    }
  }

  private inferType(obj: Record<string, unknown>): KnowledgeItemType {
    const typeField = obj.type ?? obj.kind ?? obj.category
    if (typeof typeField === "string") {
      const lowerType = typeField.toLowerCase()
      if (["adr", "policy", "pattern", "spec"].includes(lowerType)) {
        return lowerType as KnowledgeItemType
      }
      if (lowerType.includes("doc")) return "document"
      if (lowerType.includes("article")) return "article"
      if (lowerType.includes("snippet") || lowerType.includes("code"))
        return "snippet"
    }

    if (obj.url && String(obj.url).includes("github")) {
      return "snippet"
    }

    return "document"
  }
}
