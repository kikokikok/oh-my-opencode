import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
  LocalProviderConfig,
  KnowledgeItemType,
} from "../types"
import { KnowledgeRepository } from "../../knowledge-repo/client"
import type {
  KnowledgeCommit,
  KnowledgeQueryFilter,
  KnowledgeType,
  KnowledgeLayer,
} from "../../knowledge-repo/types"

const DEFAULT_CONFIG: LocalProviderConfig = {
  enabled: true,
  rootDir: ".opencode/knowledge",
}

export class LocalKnowledgeProvider implements KnowledgeProvider {
  readonly name = "local"
  readonly type = "local" as const
  readonly description = "Local file-based knowledge repository"

  private config: LocalProviderConfig
  private repository: KnowledgeRepository | null = null
  private initialized = false

  constructor(config?: Partial<LocalProviderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    this.repository = new KnowledgeRepository({
      rootDir: this.config.rootDir ?? DEFAULT_CONFIG.rootDir!,
    })

    await this.repository.initialize()
    this.initialized = true
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]> {
    if (!this.initialized || !this.repository) {
      return []
    }

    const filter: KnowledgeQueryFilter = {
      search: query.text,
      limit: query.limit ?? 10,
    }

    if (query.layers && query.layers.length > 0) {
      const validLayers = query.layers.filter(this.isKnowledgeLayer)
      if (validLayers.length > 0) {
        filter.layer = validLayers as KnowledgeLayer[]
      }
    }

    if (query.types && query.types.length > 0) {
      const validTypes = query.types.filter(this.isKnowledgeType)
      if (validTypes.length > 0) {
        filter.type = validTypes as KnowledgeType[]
      }
    }

    const result = await this.repository.query(filter)

    return result.items.map((commit) => ({
      item: this.commitToItem(commit, query.includeContent),
      score: this.calculateScore(commit, query.text),
    }))
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    if (!this.initialized || !this.repository) {
      return null
    }

    const commit = await this.repository.getCommitById(id)
    if (!commit) {
      return null
    }

    return this.commitToItem(commit, true)
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

    if (!this.initialized || !this.repository) {
      return {
        status: "unavailable",
        message: "Provider not initialized",
        lastChecked: now,
      }
    }

    try {
      const start = Date.now()
      await this.repository.getStats()
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

  private commitToItem(
    commit: KnowledgeCommit,
    includeContent?: boolean
  ): KnowledgeItem {
    return {
      id: `local::${commit.id}`,
      provider: this.name,
      title: commit.title,
      summary: commit.summary,
      content: includeContent ? commit.content : undefined,
      type: commit.type as KnowledgeItemType,
      layer: commit.layer,
      metadata: {
        sourceType: "local",
        sourceId: commit.id,
        tags: commit.tags,
        severity: commit.severity,
        knowledgeLayer: commit.layer,
        extra: {
          constraints: commit.constraints,
          triggerKeywords: commit.triggerKeywords,
          author: commit.author,
        },
      },
      createdAt: commit.createdAt,
    }
  }

  private calculateScore(commit: KnowledgeCommit, searchText: string): number {
    if (!searchText) {
      return 0.5
    }

    const lowerSearch = searchText.toLowerCase()
    const titleMatch = commit.title.toLowerCase().includes(lowerSearch)
    const summaryMatch = commit.summary.toLowerCase().includes(lowerSearch)
    const contentMatch = commit.content.toLowerCase().includes(lowerSearch)
    const tagMatch = commit.tags.some((t) =>
      t.toLowerCase().includes(lowerSearch)
    )
    const keywordMatch = commit.triggerKeywords.some((k) =>
      k.toLowerCase().includes(lowerSearch)
    )

    let score = 0.3

    if (titleMatch) score += 0.3
    if (summaryMatch) score += 0.15
    if (contentMatch) score += 0.1
    if (tagMatch) score += 0.1
    if (keywordMatch) score += 0.05

    return Math.min(score, 1.0)
  }

  private isKnowledgeType(type: string): type is KnowledgeType {
    return ["adr", "policy", "pattern", "spec"].includes(type)
  }

  private isKnowledgeLayer(layer: string): layer is KnowledgeLayer {
    return ["company", "org", "team", "project"].includes(layer)
  }
}
