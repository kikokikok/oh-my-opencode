import { describe, it, expect, beforeEach, mock } from "bun:test"
import { LocalKnowledgeProvider } from "./local"
import type { KnowledgeCommit } from "../../knowledge-repo/types"

const mockCommit: KnowledgeCommit = {
  id: "test-commit-123",
  title: "Test ADR",
  summary: "This is a test ADR summary",
  content: "Full content of the test ADR with detailed information",
  type: "adr",
  layer: "project",
  tags: ["testing", "architecture"],
  triggerKeywords: ["test", "adr"],
  severity: "block",
  constraints: [],
  author: { id: "author-1", name: "Test Author", email: "test@example.com" },
  createdAt: "2026-01-01T00:00:00Z",
}

const mockRepository = {
  initialize: mock(() => Promise.resolve()),
  query: mock(() =>
    Promise.resolve({
      items: [mockCommit],
      total: 1,
      hasMore: false,
    })
  ),
  getCommitById: mock((id: string) =>
    Promise.resolve(id === "test-commit-123" ? mockCommit : null)
  ),
  getStats: mock(() =>
    Promise.resolve({
      totalCommits: 1,
      byType: { adr: 1 },
      byLayer: { project: 1 },
    })
  ),
}

const originalKnowledgeRepository = await import("../../knowledge-repo/client")
mock.module("../../knowledge-repo/client", () => ({
  KnowledgeRepository: class MockKnowledgeRepository {
    constructor() {
      return mockRepository
    }
  },
}))

describe("LocalKnowledgeProvider", () => {
  beforeEach(() => {
    mockRepository.initialize.mockClear()
    mockRepository.query.mockClear()
    mockRepository.getCommitById.mockClear()
    mockRepository.getStats.mockClear()
  })

  describe("initialize", () => {
    it("should initialize the knowledge repository", async () => {
      // #given a local provider with default config
      const provider = new LocalKnowledgeProvider()

      // #when initializing
      await provider.initialize()

      // #then repository should be initialized
      expect(mockRepository.initialize).toHaveBeenCalled()
    })

    it("should skip initialization when disabled", async () => {
      // #given a local provider with enabled=false
      const provider = new LocalKnowledgeProvider({ enabled: false })

      // #when initializing
      await provider.initialize()

      // #then repository should not be initialized
      expect(mockRepository.initialize).not.toHaveBeenCalled()
    })
  })

  describe("search", () => {
    it("should return empty array when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new LocalKnowledgeProvider()

      // #when searching
      const results = await provider.search({ text: "test" })

      // #then should return empty array
      expect(results).toEqual([])
    })

    it("should query repository and transform results", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching
      const results = await provider.search({ text: "test" })

      // #then should return transformed results
      expect(results).toHaveLength(1)
      expect(results[0].item.id).toBe("local::test-commit-123")
      expect(results[0].item.provider).toBe("local")
      expect(results[0].item.title).toBe("Test ADR")
      expect(results[0].item.type).toBe("adr")
    })

    it("should calculate higher score for title matches", async () => {
      // #given an initialized provider and a search matching title
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching with text matching title
      const results = await provider.search({ text: "Test ADR" })

      // #then score should be high (title match adds 0.3)
      expect(results[0].score).toBeGreaterThan(0.5)
    })

    it("should include content when requested", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching with includeContent
      const results = await provider.search({ text: "test", includeContent: true })

      // #then content should be included
      expect(results[0].item.content).toBeDefined()
      expect(results[0].item.content).toContain("Full content")
    })

    it("should filter by knowledge layers", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching with layer filter
      await provider.search({ text: "test", layers: ["project", "team"] })

      // #then query should include layer filter
      expect(mockRepository.query).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: ["project", "team"],
        })
      )
    })

    it("should filter by knowledge types", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching with type filter
      await provider.search({ text: "test", types: ["adr", "policy"] })

      // #then query should include type filter
      expect(mockRepository.query).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ["adr", "policy"],
        })
      )
    })
  })

  describe("getById", () => {
    it("should return null when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new LocalKnowledgeProvider()

      // #when getting by ID
      const item = await provider.getById("test-commit-123")

      // #then should return null
      expect(item).toBeNull()
    })

    it("should return transformed item when found", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when getting by ID
      const item = await provider.getById("test-commit-123")

      // #then should return transformed item
      expect(item).not.toBeNull()
      expect(item?.id).toBe("local::test-commit-123")
      expect(item?.content).toBeDefined()
    })

    it("should return null when not found", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when getting non-existent ID
      const item = await provider.getById("nonexistent")

      // #then should return null
      expect(item).toBeNull()
    })
  })

  describe("healthCheck", () => {
    it("should return unavailable when disabled", async () => {
      // #given a disabled provider
      const provider = new LocalKnowledgeProvider({ enabled: false })

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return unavailable
      expect(health.status).toBe("unavailable")
      expect(health.message).toBe("Provider is disabled")
    })

    it("should return unavailable when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new LocalKnowledgeProvider()

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return unavailable
      expect(health.status).toBe("unavailable")
      expect(health.message).toBe("Provider not initialized")
    })

    it("should return healthy with latency when operational", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return healthy with latency
      expect(health.status).toBe("healthy")
      expect(health.latencyMs).toBeDefined()
      expect(health.lastChecked).toBeDefined()
    })

    it("should return degraded on repository errors", async () => {
      // #given an initialized provider with failing getStats
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()
      mockRepository.getStats.mockImplementationOnce(() =>
        Promise.reject(new Error("Database error"))
      )

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return degraded
      expect(health.status).toBe("degraded")
      expect(health.message).toBe("Database error")
    })
  })

  describe("metadata transformation", () => {
    it("should preserve all metadata fields", async () => {
      // #given an initialized provider
      const provider = new LocalKnowledgeProvider()
      await provider.initialize()

      // #when searching
      const results = await provider.search({ text: "test" })

      // #then metadata should contain all fields
      const metadata = results[0].item.metadata
      expect(metadata.sourceType).toBe("local")
      expect(metadata.sourceId).toBe("test-commit-123")
      expect(metadata.tags).toEqual(["testing", "architecture"])
      expect(metadata.severity).toBe("block")
      expect(metadata.knowledgeLayer).toBe("project")
      expect(metadata.extra).toEqual({
        constraints: [],
        triggerKeywords: ["test", "adr"],
        author: { id: "author-1", name: "Test Author", email: "test@example.com" },
      })
    })
  })
})
