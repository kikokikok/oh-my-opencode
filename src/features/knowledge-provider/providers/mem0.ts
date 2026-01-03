import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
  Mem0ProviderConfig,
  KnowledgeItemType,
} from "../types"
import { Mem0Adapter } from "../../mem0-memory/adapter"
import type {
  Mem0Config,
  MemoryLayer,
  MemorySearchResult,
  Memory,
} from "../../mem0-memory/types"

const DEFAULT_SEARCH_LAYERS: MemoryLayer[] = [
  "user",
  "project",
  "team",
  "org",
  "company",
]

export class Mem0KnowledgeProvider implements KnowledgeProvider {
  readonly name = "mem0"
  readonly type = "mem0" as const
  readonly description = "Vector-based semantic memory via Mem0"

  private config: Mem0ProviderConfig
  private adapter: Mem0Adapter | null = null
  private initialized = false

  constructor(
    config: Mem0ProviderConfig,
    private mem0Config: Mem0Config
  ) {
    this.config = config
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || !this.mem0Config.enabled) {
      return
    }

    this.adapter = new Mem0Adapter(this.mem0Config)
    this.initialized = true
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]> {
    if (!this.initialized || !this.adapter) {
      return []
    }

    const layers = this.resolveSearchLayers(query.layers)

    const results = await this.adapter.search({
      query: query.text,
      layer: layers,
      limit: query.limit ?? 10,
      threshold: query.threshold ?? 0.5,
    })

    return results.map((result) => ({
      item: this.memoryToItem(result.memory, query.includeContent),
      score: result.score,
    }))
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    if (!this.initialized || !this.adapter) {
      return null
    }

    const memory = await this.adapter.get(id)
    if (!memory) {
      return null
    }

    return this.memoryToItem(memory, true)
  }

  async index(item: KnowledgeItem): Promise<void> {
    if (!this.initialized || !this.adapter) {
      return
    }

    const layer = this.itemLayerToMemoryLayer(item.layer)
    if (!layer) {
      return
    }

    await this.adapter.add({
      content: `${item.title}\n\n${item.summary}\n\n${item.content ?? ""}`,
      layer,
      metadata: {
        sourceProvider: item.provider,
        sourceId: item.metadata.sourceId,
        type: item.type,
        tags: item.metadata.tags,
      },
    })
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

    if (!this.initialized || !this.adapter) {
      return {
        status: "unavailable",
        message: "Provider not initialized",
        lastChecked: now,
      }
    }

    try {
      const start = Date.now()
      await this.adapter.getStats()
      const latencyMs = Date.now() - start

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

  private memoryToItem(memory: Memory, includeContent?: boolean): KnowledgeItem {
    const metadata = memory.metadata ?? {}

    return {
      id: `mem0::${memory.id}`,
      provider: this.name,
      title: this.extractTitle(memory.content),
      summary: this.extractSummary(memory.content),
      content: includeContent ? memory.content : undefined,
      type: (metadata.type as KnowledgeItemType) ?? "memory",
      layer: memory.layer,
      metadata: {
        sourceType: "mem0",
        sourceId: memory.id,
        tags: metadata.tags as string[] | undefined,
        memoryLayer: memory.layer,
        extra: metadata,
      },
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    }
  }

  private extractTitle(content: string): string {
    const firstLine = content.split("\n")[0] ?? ""
    return firstLine.slice(0, 100).trim() || "Untitled Memory"
  }

  private extractSummary(content: string): string {
    const lines = content.split("\n").filter((l) => l.trim())
    const summary = lines.slice(0, 2).join(" ")
    return summary.slice(0, 200).trim() || content.slice(0, 200).trim()
  }

  private resolveSearchLayers(queryLayers?: string[]): MemoryLayer[] {
    if (!queryLayers || queryLayers.length === 0) {
      return this.config.searchLayers ?? DEFAULT_SEARCH_LAYERS
    }

    return queryLayers.filter(this.isMemoryLayer) as MemoryLayer[]
  }

  private itemLayerToMemoryLayer(layer?: string): MemoryLayer | null {
    if (!layer) return "project"

    const mapping: Record<string, MemoryLayer> = {
      company: "company",
      org: "org",
      team: "team",
      project: "project",
      user: "user",
      session: "session",
      agent: "agent",
    }

    return mapping[layer] ?? "project"
  }

  private isMemoryLayer(layer: string): layer is MemoryLayer {
    return ["user", "session", "project", "team", "org", "company", "agent"].includes(
      layer
    )
  }
}
