import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
  KnowledgeItemType,
} from "../types"
import type { MCPInvoker } from "./mcp"

export interface NotebookLMProviderConfig {
  enabled: boolean
  defaultNotebookId?: string
}

interface NotebookInfo {
  id: string
  title: string
  description?: string
  sourceCount?: number
  createdAt?: string
  updatedAt?: string
}

interface NotebookSource {
  id: string
  title: string
  type: string
  url?: string
  snippet?: string
}

interface NotebookQueryResponse {
  answer: string
  sources?: Array<{
    id: string
    title: string
    snippet?: string
  }>
}

export class NotebookLMKnowledgeProvider implements KnowledgeProvider {
  readonly name = "notebooklm"
  readonly type = "mcp" as const
  readonly description = "Google NotebookLM AI-powered knowledge notebooks"

  private config: NotebookLMProviderConfig
  private invoker: MCPInvoker
  private initialized = false
  private notebooks: Map<string, NotebookInfo> = new Map()

  constructor(config: NotebookLMProviderConfig, invoker: MCPInvoker) {
    this.config = config
    this.invoker = invoker
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    const available = await this.invoker.isServerAvailable("notebooklm-mcp")
    if (!available) {
      throw new Error("NotebookLM MCP server is not available")
    }

    await this.refreshNotebooks()
    this.initialized = true
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]> {
    if (!this.initialized) {
      return []
    }

    const results: KnowledgeSearchResult[] = []
    const notebookIds = this.getTargetNotebooks(query)

    for (const notebookId of notebookIds) {
      try {
        const response = await this.invoker.invoke(
          "notebooklm-mcp",
          "notebook_query",
          {
            notebook_id: notebookId,
            query: query.text,
          }
        ) as NotebookQueryResponse

        if (response?.answer) {
          const notebook = this.notebooks.get(notebookId)
          results.push({
            item: {
              id: `notebooklm::${notebookId}::query`,
              provider: this.name,
              title: `Answer from "${notebook?.title ?? notebookId}"`,
              summary: response.answer.slice(0, 200),
              content: query.includeContent ? response.answer : undefined,
              type: "document",
              metadata: {
                sourceType: "mcp",
                sourceId: notebookId,
                extra: {
                  notebookId,
                  notebookTitle: notebook?.title,
                  citedSources: response.sources,
                },
              },
            },
            score: 0.9,
            highlights: response.sources?.map((s) => s.snippet).filter(Boolean) as string[] | undefined,
          })
        }
      } catch {
        continue
      }
    }

    return results.slice(0, query.limit ?? 10)
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    if (!this.initialized) {
      return null
    }

    const parts = id.split("::")
    if (parts.length < 2) {
      return null
    }

    const notebookId = parts[0]
    const itemType = parts[1]

    try {
      if (itemType === "notebook") {
        const response = await this.invoker.invoke(
          "notebooklm-mcp",
          "notebook_describe",
          { notebook_id: notebookId }
        ) as { description: string; keywords?: string[] }

        const notebook = this.notebooks.get(notebookId)
        return {
          id: `notebooklm::${notebookId}::notebook`,
          provider: this.name,
          title: notebook?.title ?? "Notebook",
          summary: response.description?.slice(0, 200) ?? "",
          content: response.description,
          type: "document",
          metadata: {
            sourceType: "mcp",
            sourceId: notebookId,
            tags: response.keywords,
            extra: { notebookId },
          },
        }
      }

      if (itemType === "source") {
        const sourceId = parts[2]
        const response = await this.invoker.invoke(
          "notebooklm-mcp",
          "source_describe",
          { notebook_id: notebookId, source_id: sourceId }
        ) as { summary: string; keywords?: string[] }

        return {
          id: `notebooklm::${notebookId}::source::${sourceId}`,
          provider: this.name,
          title: `Source ${sourceId}`,
          summary: response.summary?.slice(0, 200) ?? "",
          content: response.summary,
          type: "document",
          metadata: {
            sourceType: "mcp",
            sourceId: `${notebookId}/${sourceId}`,
            tags: response.keywords,
            extra: { notebookId, sourceId },
          },
        }
      }
    } catch {
      return null
    }

    return null
  }

  async index(item: KnowledgeItem): Promise<void> {
    if (!this.initialized) {
      return
    }

    const notebookId = this.config.defaultNotebookId
    if (!notebookId) {
      return
    }

    try {
      if (item.metadata.url) {
        await this.invoker.invoke("notebooklm-mcp", "notebook_add_url", {
          notebook_id: notebookId,
          url: item.metadata.url,
        })
      } else if (item.content) {
        await this.invoker.invoke("notebooklm-mcp", "notebook_add_text", {
          notebook_id: notebookId,
          text: `# ${item.title}\n\n${item.content}`,
          title: item.title,
        })
      }
    } catch {
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const now = new Date().toISOString()

    if (!this.config.enabled) {
      return {
        status: "unavailable",
        message: "Provider is disabled",
        lastChecked: now,
      }
    }

    try {
      const start = Date.now()
      const available = await this.invoker.isServerAvailable("notebooklm-mcp")
      const latencyMs = Date.now() - start

      if (!available) {
        return {
          status: "unavailable",
          message: "NotebookLM MCP server is not available",
          lastChecked: now,
        }
      }

      return {
        status: "healthy",
        latencyMs,
        message: `${this.notebooks.size} notebooks cached`,
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
    this.notebooks.clear()
  }

  async listNotebooks(): Promise<NotebookInfo[]> {
    await this.refreshNotebooks()
    return Array.from(this.notebooks.values())
  }

  private async refreshNotebooks(): Promise<void> {
    try {
      const response = await this.invoker.invoke(
        "notebooklm-mcp",
        "notebook_list",
        {}
      ) as { notebooks: NotebookInfo[] }

      this.notebooks.clear()
      if (response?.notebooks) {
        for (const nb of response.notebooks) {
          this.notebooks.set(nb.id, nb)
        }
      }
    } catch {
    }
  }

  private getTargetNotebooks(query: KnowledgeQuery): string[] {
    if (this.config.defaultNotebookId) {
      return [this.config.defaultNotebookId]
    }

    const notebookIds = Array.from(this.notebooks.keys())
    return notebookIds.slice(0, 3)
  }
}
