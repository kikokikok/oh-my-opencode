import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  KnowledgeProviderRegistry,
  resetKnowledgeProviderRegistry,
  getKnowledgeProviderRegistry,
} from "./registry"
import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeSearchResult,
  KnowledgeItem,
  ProviderHealth,
} from "./types"

function createMockProvider(
  name: string,
  results: KnowledgeSearchResult[] = []
): KnowledgeProvider {
  return {
    name,
    type: "local",
    description: `Mock provider ${name}`,
    initialize: mock(() => Promise.resolve()),
    search: mock(() => Promise.resolve(results)),
    getById: mock((id: string) => {
      const found = results.find((r) => {
        const itemId = r.item.id
        const strippedId = itemId.includes("::") ? itemId.split("::")[1] : itemId
        return strippedId === id || itemId === id
      })
      return Promise.resolve(found?.item ?? null)
    }),
    healthCheck: mock(() =>
      Promise.resolve({
        status: "healthy",
        latencyMs: 10,
        lastChecked: new Date().toISOString(),
      } as ProviderHealth)
    ),
    dispose: mock(() => Promise.resolve()),
  }
}

function createMockItem(
  provider: string,
  id: string,
  title: string,
  score: number
): KnowledgeSearchResult {
  return {
    item: {
      id: `${provider}::${id}`,
      provider,
      title,
      summary: `Summary for ${title}`,
      type: "adr",
      metadata: { sourceType: "local" },
    },
    score,
  }
}

describe("KnowledgeProviderRegistry", () => {
  beforeEach(() => {
    resetKnowledgeProviderRegistry()
  })

  describe("register", () => {
    it("should register a provider and initialize it", async () => {
      // #given a registry and a mock provider
      const registry = new KnowledgeProviderRegistry()
      const provider = createMockProvider("test")

      // #when registering the provider
      await registry.register(provider)

      // #then provider should be initialized and retrievable
      expect(provider.initialize).toHaveBeenCalled()
      expect(registry.getProvider("test")).toBe(provider)
      expect(registry.getProviders()).toHaveLength(1)
    })

    it("should throw when registering duplicate provider name", async () => {
      // #given a registry with an existing provider
      const registry = new KnowledgeProviderRegistry()
      const provider1 = createMockProvider("test")
      const provider2 = createMockProvider("test")
      await registry.register(provider1)

      // #when attempting to register another provider with same name
      // #then it should throw
      await expect(registry.register(provider2)).rejects.toThrow(
        'Provider "test" is already registered'
      )
    })
  })

  describe("unregister", () => {
    it("should unregister a provider and call dispose", async () => {
      // #given a registry with a registered provider
      const registry = new KnowledgeProviderRegistry()
      const provider = createMockProvider("test")
      await registry.register(provider)

      // #when unregistering the provider
      await registry.unregister("test")

      // #then provider should be disposed and removed
      expect(provider.dispose).toHaveBeenCalled()
      expect(registry.getProvider("test")).toBeUndefined()
      expect(registry.getProviders()).toHaveLength(0)
    })

    it("should silently handle unregistering non-existent provider", async () => {
      // #given an empty registry
      const registry = new KnowledgeProviderRegistry()

      // #when unregistering a non-existent provider
      // #then it should not throw
      await expect(registry.unregister("nonexistent")).resolves.toBeUndefined()
    })
  })

  describe("search", () => {
    it("should return empty array when no providers registered", async () => {
      // #given an empty registry
      const registry = new KnowledgeProviderRegistry()

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should return empty array
      expect(results).toEqual([])
    })

    it("should aggregate results from multiple providers", async () => {
      // #given a registry with two providers returning different results
      const registry = new KnowledgeProviderRegistry()
      const provider1 = createMockProvider("p1", [
        createMockItem("p1", "1", "Result A", 0.9),
      ])
      const provider2 = createMockProvider("p2", [
        createMockItem("p2", "2", "Result B", 0.8),
      ])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should return results from both providers
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.item.title)).toContain("Result A")
      expect(results.map((r) => r.item.title)).toContain("Result B")
    })

    it("should filter by specific providers when specified", async () => {
      // #given a registry with two providers
      const registry = new KnowledgeProviderRegistry()
      const provider1 = createMockProvider("p1", [
        createMockItem("p1", "1", "Result A", 0.9),
      ])
      const provider2 = createMockProvider("p2", [
        createMockItem("p2", "2", "Result B", 0.8),
      ])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching with provider filter
      const results = await registry.search({ text: "test", providers: ["p1"] })

      // #then should only return results from specified provider
      expect(results).toHaveLength(1)
      expect(results[0].item.title).toBe("Result A")
    })

    it("should handle provider search errors gracefully", async () => {
      // #given a registry with a failing provider and a working provider
      const registry = new KnowledgeProviderRegistry()
      const failingProvider = createMockProvider("failing")
      ;(failingProvider.search as ReturnType<typeof mock>).mockImplementation(
        () => Promise.reject(new Error("Search failed"))
      )
      const workingProvider = createMockProvider("working", [
        createMockItem("working", "1", "Result", 0.9),
      ])
      await registry.register(failingProvider)
      await registry.register(workingProvider)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should return results from working provider only
      expect(results).toHaveLength(1)
      expect(results[0].item.title).toBe("Result")
    })
  })

  describe("merge strategies", () => {
    it("should sort by score with 'score' strategy (default)", async () => {
      // #given a registry with score merge strategy and mixed results
      const registry = new KnowledgeProviderRegistry({ mergeStrategy: "score" })
      const provider1 = createMockProvider("p1", [
        createMockItem("p1", "1", "Low Score", 0.5),
      ])
      const provider2 = createMockProvider("p2", [
        createMockItem("p2", "2", "High Score", 0.9),
      ])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should be sorted by score descending
      expect(results[0].item.title).toBe("High Score")
      expect(results[1].item.title).toBe("Low Score")
    })

    it("should alternate providers with 'round-robin' strategy", async () => {
      // #given a registry with round-robin strategy and multiple results per provider
      const registry = new KnowledgeProviderRegistry({
        mergeStrategy: "round-robin",
      })
      const provider1 = createMockProvider("p1", [
        createMockItem("p1", "1", "P1 First", 0.9),
        createMockItem("p1", "2", "P1 Second", 0.8),
      ])
      const provider2 = createMockProvider("p2", [
        createMockItem("p2", "3", "P2 First", 0.85),
        createMockItem("p2", "4", "P2 Second", 0.75),
      ])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test", limit: 4 })

      // #then should alternate between providers
      expect(results[0].item.provider).toBe("p1")
      expect(results[1].item.provider).toBe("p2")
      expect(results[2].item.provider).toBe("p1")
      expect(results[3].item.provider).toBe("p2")
    })

    it("should respect provider order with 'provider-priority' strategy", async () => {
      // #given a registry with provider-priority strategy
      const registry = new KnowledgeProviderRegistry({
        mergeStrategy: "provider-priority",
        providerPriority: ["p2", "p1"],
      })
      const provider1 = createMockProvider("p1", [
        createMockItem("p1", "1", "P1 Result", 0.9),
      ])
      const provider2 = createMockProvider("p2", [
        createMockItem("p2", "2", "P2 Result", 0.5),
      ])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then p2 should come first despite lower score
      expect(results[0].item.provider).toBe("p2")
      expect(results[1].item.provider).toBe("p1")
    })
  })

  describe("deduplication", () => {
    it("should deduplicate results by content hash when enabled", async () => {
      // #given a registry with deduplication enabled and duplicate content
      const registry = new KnowledgeProviderRegistry({ deduplicate: true })

      const item1: KnowledgeSearchResult = {
        item: {
          id: "p1::1",
          provider: "p1",
          title: "Same Title",
          summary: "Same content summary",
          type: "adr",
          metadata: { sourceType: "local" },
        },
        score: 0.9,
      }
      const item2: KnowledgeSearchResult = {
        item: {
          id: "p2::2",
          provider: "p2",
          title: "Same Title",
          summary: "Same content summary",
          type: "adr",
          metadata: { sourceType: "mem0" },
        },
        score: 0.8,
      }

      const provider1 = createMockProvider("p1", [item1])
      const provider2 = createMockProvider("p2", [item2])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should only return one result (higher score)
      expect(results).toHaveLength(1)
      expect(results[0].score).toBe(0.9)
    })

    it("should keep all results when deduplication is disabled", async () => {
      // #given a registry with deduplication disabled and duplicate content
      const registry = new KnowledgeProviderRegistry({ deduplicate: false })

      const item1: KnowledgeSearchResult = {
        item: {
          id: "p1::1",
          provider: "p1",
          title: "Same Title",
          summary: "Same content summary",
          type: "adr",
          metadata: { sourceType: "local" },
        },
        score: 0.9,
      }
      const item2: KnowledgeSearchResult = {
        item: {
          id: "p2::2",
          provider: "p2",
          title: "Same Title",
          summary: "Same content summary",
          type: "adr",
          metadata: { sourceType: "mem0" },
        },
        score: 0.8,
      }

      const provider1 = createMockProvider("p1", [item1])
      const provider2 = createMockProvider("p2", [item2])
      await registry.register(provider1)
      await registry.register(provider2)

      // #when searching
      const results = await registry.search({ text: "test" })

      // #then should return both results
      expect(results).toHaveLength(2)
    })
  })

  describe("getById", () => {
    it("should find item by provider-prefixed ID", async () => {
      // #given a registry with a provider containing an item
      const registry = new KnowledgeProviderRegistry()
      const provider = createMockProvider("test", [
        createMockItem("test", "123", "Test Item", 0.9),
      ])
      await registry.register(provider)

      // #when getting by prefixed ID
      const item = await registry.getById("test::123")

      // #then should return the item
      expect(item).not.toBeNull()
      expect(item?.title).toBe("Test Item")
    })

    it("should search all providers for non-prefixed ID", async () => {
      // #given a registry with multiple providers
      const registry = new KnowledgeProviderRegistry()
      const mockItem: KnowledgeItem = {
        id: "found",
        provider: "p2",
        title: "Found Item",
        summary: "Summary",
        type: "adr",
        metadata: { sourceType: "local" },
      }

      const provider1 = createMockProvider("p1")
      ;(provider1.getById as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(null)
      )

      const provider2 = createMockProvider("p2")
      ;(provider2.getById as ReturnType<typeof mock>).mockImplementation(
        (id: string) => Promise.resolve(id === "found" ? mockItem : null)
      )

      await registry.register(provider1)
      await registry.register(provider2)

      // #when getting by non-prefixed ID
      const item = await registry.getById("found")

      // #then should find the item from any provider
      expect(item).not.toBeNull()
      expect(item?.title).toBe("Found Item")
    })

    it("should return null when item not found", async () => {
      // #given a registry with providers but no matching item
      const registry = new KnowledgeProviderRegistry()
      const provider = createMockProvider("test")
      ;(provider.getById as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(null)
      )
      await registry.register(provider)

      // #when getting non-existent ID
      const item = await registry.getById("nonexistent")

      // #then should return null
      expect(item).toBeNull()
    })
  })

  describe("healthCheck", () => {
    it("should return health status for all providers", async () => {
      // #given a registry with multiple providers
      const registry = new KnowledgeProviderRegistry()
      const provider1 = createMockProvider("healthy")
      const provider2 = createMockProvider("degraded")
      ;(provider2.healthCheck as ReturnType<typeof mock>).mockImplementation(
        () =>
          Promise.resolve({
            status: "degraded",
            message: "High latency",
            lastChecked: new Date().toISOString(),
          } as ProviderHealth)
      )

      await registry.register(provider1)
      await registry.register(provider2)

      // #when checking health
      const health = await registry.healthCheck()

      // #then should return status for each provider
      expect(health.size).toBe(2)
      expect(health.get("healthy")?.status).toBe("healthy")
      expect(health.get("degraded")?.status).toBe("degraded")
    })

    it("should handle provider health check errors", async () => {
      // #given a registry with a provider that throws on health check
      const registry = new KnowledgeProviderRegistry()
      const provider = createMockProvider("failing")
      ;(provider.healthCheck as ReturnType<typeof mock>).mockImplementation(
        () => Promise.reject(new Error("Connection failed"))
      )
      await registry.register(provider)

      // #when checking health
      const health = await registry.healthCheck()

      // #then should return unavailable status with error message
      expect(health.get("failing")?.status).toBe("unavailable")
      expect(health.get("failing")?.message).toBe("Connection failed")
    })
  })

  describe("singleton", () => {
    it("should return same instance from getKnowledgeProviderRegistry", () => {
      // #given nothing
      // #when getting registry twice
      const registry1 = getKnowledgeProviderRegistry()
      const registry2 = getKnowledgeProviderRegistry()

      // #then should be same instance
      expect(registry1).toBe(registry2)
    })

    it("should create new instance after reset", () => {
      // #given an existing registry instance
      const registry1 = getKnowledgeProviderRegistry()

      // #when resetting and getting new instance
      resetKnowledgeProviderRegistry()
      const registry2 = getKnowledgeProviderRegistry()

      // #then should be different instance
      expect(registry1).not.toBe(registry2)
    })
  })
})
