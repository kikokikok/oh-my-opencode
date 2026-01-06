import { describe, expect, it, beforeEach, mock } from "bun:test"
import { createKnowledgeProviderTools } from "./provider-tools"
import { KnowledgeProviderRegistry } from "../../features/knowledge-provider"
import type { KnowledgeProvider, KnowledgeSearchResult, KnowledgeItem, ProviderHealth } from "../../features/knowledge-provider/types"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

class MockKnowledgeProvider implements KnowledgeProvider {
  readonly name = "mock"
  readonly type = "local" as const
  readonly description = "Mock provider for testing"

  private items: KnowledgeItem[] = []

  constructor(items: KnowledgeItem[] = []) {
    this.items = items
  }

  async initialize(): Promise<void> {}

  async search(): Promise<KnowledgeSearchResult[]> {
    return this.items.map((item) => ({
      item,
      score: 0.9,
    }))
  }

  async getById(id: string): Promise<KnowledgeItem | null> {
    const fullId = id.startsWith("mock::") ? id : `mock::${id}`
    return this.items.find((item) => item.id === fullId) ?? null
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      lastChecked: new Date().toISOString(),
    }
  }
}

describe("createKnowledgeProviderTools", () => {
  let registry: KnowledgeProviderRegistry
  let mockProvider: MockKnowledgeProvider

  const testItem: KnowledgeItem = {
    id: "mock::test-001",
    provider: "mock",
    title: "Test ADR",
    summary: "A test architecture decision record",
    content: "Full content of the test ADR",
    type: "adr",
    layer: "project",
    metadata: {
      sourceType: "local",
      sourceId: "test-001",
      tags: ["test", "architecture"],
      severity: "info",
    },
    createdAt: "2025-01-01T00:00:00Z",
  }

  beforeEach(async () => {
    registry = new KnowledgeProviderRegistry()
    mockProvider = new MockKnowledgeProvider([testItem])
    await registry.register(mockProvider)
  })

  describe("knowledge_query", () => {
    it("should return results from the registry", async () => {
      // #given
      const tools = createKnowledgeProviderTools(registry)
      const queryTool = tools.knowledge_query

      // #when
      const result = await queryTool.execute({ query: "test" }, mockContext)

      // #then
      expect(result).toContain("Found 1 knowledge items")
      expect(result).toContain("Test ADR")
      expect(result).toContain("mock::test-001")
      expect(result).toContain("Provider: mock")
    })

    it("should return message when no results found", async () => {
      // #given
      const emptyProvider = new MockKnowledgeProvider([])
      const emptyRegistry = new KnowledgeProviderRegistry()
      await emptyRegistry.register(emptyProvider)
      const tools = createKnowledgeProviderTools(emptyRegistry)
      const queryTool = tools.knowledge_query

      // #when
      const result = await queryTool.execute({ query: "nonexistent" }, mockContext)

      // #then
      expect(result).toContain("No knowledge items found")
    })
  })

  describe("knowledge_list", () => {
    it("should list providers and items", async () => {
      // #given
      const tools = createKnowledgeProviderTools(registry)
      const listTool = tools.knowledge_list

      // #when
      const result = await listTool.execute({}, mockContext)

      // #then
      expect(result).toContain("Knowledge Provider Statistics")
      expect(result).toContain("Total providers: 1")
      expect(result).toContain("mock (local): healthy")
      expect(result).toContain("Total: 1")
    })

    it("should show items when verbose is true", async () => {
      // #given
      const tools = createKnowledgeProviderTools(registry)
      const listTool = tools.knowledge_list

      // #when
      const result = await listTool.execute({ verbose: true }, mockContext)

      // #then
      expect(result).toContain("## Items")
      expect(result).toContain("Test ADR")
    })
  })

  describe("knowledge_show", () => {
    it("should show item details by ID", async () => {
      // #given
      const tools = createKnowledgeProviderTools(registry)
      const showTool = tools.knowledge_show

      // #when
      const result = await showTool.execute({ id: "mock::test-001" }, mockContext)

      // #then
      expect(result).toContain("# Test ADR")
      expect(result).toContain("**ID:** mock::test-001")
      expect(result).toContain("**Type:** adr")
      expect(result).toContain("**Layer:** project")
      expect(result).toContain("**Provider:** mock")
      expect(result).toContain("Full content of the test ADR")
    })

    it("should return not found for missing ID", async () => {
      // #given
      const tools = createKnowledgeProviderTools(registry)
      const showTool = tools.knowledge_show

      // #when
      const result = await showTool.execute({ id: "nonexistent" }, mockContext)

      // #then
      expect(result).toContain("Knowledge item not found: nonexistent")
    })
  })
})
