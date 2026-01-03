import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
  IKnowledgeProviderRegistry,
  KnowledgeProviderRegistryConfig,
  MergeStrategy,
} from "./types"

const DEFAULT_CONFIG: KnowledgeProviderRegistryConfig = {
  defaultLimit: 10,
  defaultThreshold: 0.5,
  mergeStrategy: "score",
  deduplicate: true,
}

export class KnowledgeProviderRegistry implements IKnowledgeProviderRegistry {
  private providers: Map<string, KnowledgeProvider> = new Map()
  private config: KnowledgeProviderRegistryConfig

  constructor(config?: Partial<KnowledgeProviderRegistryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async register(provider: KnowledgeProvider): Promise<void> {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider "${provider.name}" is already registered`)
    }

    await provider.initialize()
    this.providers.set(provider.name, provider)
  }

  async unregister(name: string): Promise<void> {
    const provider = this.providers.get(name)
    if (!provider) {
      return
    }

    if (provider.dispose) {
      await provider.dispose()
    }
    this.providers.delete(name)
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]> {
    const targetProviders = this.getTargetProviders(query.providers)
    if (targetProviders.length === 0) {
      return []
    }

    const limit = query.limit ?? this.config.defaultLimit
    const threshold = query.threshold ?? this.config.defaultThreshold

    const searchPromises = targetProviders.map(async (provider) => {
      try {
        const results = await provider.search({
          ...query,
          limit: limit * 2,
          threshold,
        })
        return { provider: provider.name, results }
      } catch {
        return { provider: provider.name, results: [] }
      }
    })

    const allResults = await Promise.all(searchPromises)

    const merged = this.mergeResults(
      allResults.flatMap((r) => r.results),
      this.config.mergeStrategy,
      limit
    )

    if (this.config.deduplicate) {
      return this.deduplicateResults(merged)
    }

    return merged.slice(0, limit)
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    const [providerName, itemId] = this.parseId(id)

    if (providerName) {
      const provider = this.providers.get(providerName)
      if (provider?.getById) {
        return provider.getById(itemId)
      }
      return null
    }

    for (const provider of this.providers.values()) {
      if (provider.getById) {
        const item = await provider.getById(id)
        if (item) {
          return item
        }
      }
    }

    return null
  }

  getProviders(): KnowledgeProvider[] {
    return Array.from(this.providers.values())
  }

  getProvider(name: string): KnowledgeProvider | undefined {
    return this.providers.get(name)
  }

  async healthCheck(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>()

    const checks = Array.from(this.providers.entries()).map(
      async ([name, provider]) => {
        try {
          const health = await provider.healthCheck()
          results.set(name, health)
        } catch (error) {
          results.set(name, {
            status: "unavailable",
            message: error instanceof Error ? error.message : "Unknown error",
            lastChecked: new Date().toISOString(),
          })
        }
      }
    )

    await Promise.all(checks)
    return results
  }

  private getTargetProviders(filterNames?: string[]): KnowledgeProvider[] {
    if (!filterNames || filterNames.length === 0) {
      return Array.from(this.providers.values())
    }

    return filterNames
      .map((name) => this.providers.get(name))
      .filter((p): p is KnowledgeProvider => p !== undefined)
  }

  private mergeResults(
    results: KnowledgeSearchResult[],
    strategy: MergeStrategy,
    limit: number
  ): KnowledgeSearchResult[] {
    switch (strategy) {
      case "score":
        return results.sort((a, b) => b.score - a.score).slice(0, limit)

      case "round-robin":
        return this.roundRobinMerge(results, limit)

      case "provider-priority":
        return this.priorityMerge(results, limit)

      default:
        return results.sort((a, b) => b.score - a.score).slice(0, limit)
    }
  }

  private roundRobinMerge(
    results: KnowledgeSearchResult[],
    limit: number
  ): KnowledgeSearchResult[] {
    const byProvider = new Map<string, KnowledgeSearchResult[]>()

    for (const result of results) {
      const provider = result.item.provider
      const existing = byProvider.get(provider) ?? []
      existing.push(result)
      byProvider.set(provider, existing)
    }

    for (const [provider, items] of byProvider) {
      byProvider.set(
        provider,
        items.sort((a, b) => b.score - a.score)
      )
    }

    const merged: KnowledgeSearchResult[] = []
    const providers = Array.from(byProvider.keys())
    let index = 0

    while (merged.length < limit) {
      let added = false
      for (const provider of providers) {
        const items = byProvider.get(provider)!
        if (index < items.length) {
          merged.push(items[index])
          added = true
          if (merged.length >= limit) break
        }
      }
      if (!added) break
      index++
    }

    return merged
  }

  private priorityMerge(
    results: KnowledgeSearchResult[],
    limit: number
  ): KnowledgeSearchResult[] {
    const priority = this.config.providerPriority ?? []

    return results
      .sort((a, b) => {
        const aPriority = priority.indexOf(a.item.provider)
        const bPriority = priority.indexOf(b.item.provider)

        const aOrder = aPriority === -1 ? Infinity : aPriority
        const bOrder = bPriority === -1 ? Infinity : bPriority

        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }

        return b.score - a.score
      })
      .slice(0, limit)
  }

  private deduplicateResults(
    results: KnowledgeSearchResult[]
  ): KnowledgeSearchResult[] {
    const seen = new Set<string>()
    const deduplicated: KnowledgeSearchResult[] = []

    for (const result of results) {
      const hash = this.contentHash(result.item)
      if (!seen.has(hash)) {
        seen.add(hash)
        deduplicated.push(result)
      }
    }

    return deduplicated
  }

  private contentHash(item: KnowledgeItem): string {
    const content = item.content ?? item.summary
    return `${item.title}:${content.slice(0, 200)}`
  }

  private parseId(id: string): [string | null, string] {
    const separator = "::"
    const index = id.indexOf(separator)
    if (index === -1) {
      return [null, id]
    }
    return [id.slice(0, index), id.slice(index + separator.length)]
  }
}

let globalRegistry: KnowledgeProviderRegistry | null = null

export function getKnowledgeProviderRegistry(): KnowledgeProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new KnowledgeProviderRegistry()
  }
  return globalRegistry
}

export function resetKnowledgeProviderRegistry(): void {
  globalRegistry = null
}
