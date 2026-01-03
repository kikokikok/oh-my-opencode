import { describe, it, expect, beforeEach, mock } from "bun:test"
import { NotebookLMKnowledgeProvider } from "./notebooklm"
import type { MCPInvoker } from "./mcp"

const createMockInvoker = (): MCPInvoker => ({
  invoke: mock(() => Promise.resolve({})),
  isServerAvailable: mock(() => Promise.resolve(true)),
})

describe("NotebookLMKnowledgeProvider", () => {
  let mockInvoker: MCPInvoker

  beforeEach(() => {
    mockInvoker = createMockInvoker()
  })

  describe("initialize", () => {
    it("should skip initialization when disabled", async () => {
      // #given a provider with enabled=false
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: false },
        mockInvoker
      )

      // #when initializing
      await provider.initialize()

      // #then MCP server should not be checked
      expect(mockInvoker.isServerAvailable).not.toHaveBeenCalled()
    })

    it("should throw when MCP server is unavailable", async () => {
      // #given a provider with unavailable MCP server
      ;(mockInvoker.isServerAvailable as ReturnType<typeof mock>).mockResolvedValue(false)
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )

      // #when initializing
      // #then should throw error
      await expect(provider.initialize()).rejects.toThrow(
        "NotebookLM MCP server is not available"
      )
    })

    it("should initialize and refresh notebooks when available", async () => {
      // #given a provider with available MCP server
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [
          { id: "nb-1", title: "Test Notebook" },
          { id: "nb-2", title: "Another Notebook" },
        ],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )

      // #when initializing
      await provider.initialize()

      // #then notebook_list should be called
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "notebook_list",
        {}
      )

      // #then notebooks should be cached
      const notebooks = await provider.listNotebooks()
      expect(notebooks).toHaveLength(2)
    })
  })

  describe("search", () => {
    it("should return empty array when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )

      // #when searching
      const results = await provider.search({ text: "test query" })

      // #then should return empty array
      expect(results).toEqual([])
    })

    it("should query notebooks and return results", async () => {
      // #given an initialized provider with notebooks
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          notebooks: [{ id: "nb-1", title: "Test Notebook" }],
        })
        .mockResolvedValueOnce({
          answer: "This is the AI-generated answer from NotebookLM",
          sources: [
            { id: "src-1", title: "Source 1", snippet: "relevant text" },
          ],
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when searching
      const results = await provider.search({ text: "test query" })

      // #then should return transformed results
      expect(results).toHaveLength(1)
      expect(results[0].item.id).toContain("notebooklm::nb-1")
      expect(results[0].item.provider).toBe("notebooklm")
      expect(results[0].item.title).toContain("Test Notebook")
      expect(results[0].score).toBe(0.9)
    })

    it("should use defaultNotebookId when configured", async () => {
      // #given a provider with defaultNotebookId
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ notebooks: [] })
        .mockResolvedValueOnce({
          answer: "Answer from specific notebook",
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true, defaultNotebookId: "specific-nb" },
        mockInvoker
      )
      await provider.initialize()

      // #when searching
      await provider.search({ text: "test" })

      // #then should query the specific notebook
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "notebook_query",
        { notebook_id: "specific-nb", query: "test" }
      )
    })

    it("should include content when requested", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          notebooks: [{ id: "nb-1", title: "Test" }],
        })
        .mockResolvedValueOnce({
          answer: "Full detailed answer content",
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when searching with includeContent
      const results = await provider.search({
        text: "test",
        includeContent: true,
      })

      // #then content should be included
      expect(results[0].item.content).toBe("Full detailed answer content")
    })

    it("should extract highlights from sources", async () => {
      // #given an initialized provider with sources
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          notebooks: [{ id: "nb-1", title: "Test" }],
        })
        .mockResolvedValueOnce({
          answer: "Answer",
          sources: [
            { id: "s1", title: "S1", snippet: "First snippet" },
            { id: "s2", title: "S2", snippet: "Second snippet" },
          ],
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when searching
      const results = await provider.search({ text: "test" })

      // #then highlights should contain snippets
      expect(results[0].highlights).toEqual(["First snippet", "Second snippet"])
    })

    it("should handle query errors gracefully", async () => {
      // #given an initialized provider where query fails
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          notebooks: [{ id: "nb-1", title: "Test" }],
        })
        .mockRejectedValueOnce(new Error("Query failed"))

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when searching
      const results = await provider.search({ text: "test" })

      // #then should return empty results (error handled)
      expect(results).toEqual([])
    })
  })

  describe("getById", () => {
    it("should return null when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )

      // #when getting by ID
      const item = await provider.getById("nb-1::notebook")

      // #then should return null
      expect(item).toBeNull()
    })

    it("should return null for invalid ID format", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when getting by invalid ID
      const item = await provider.getById("invalid-id")

      // #then should return null
      expect(item).toBeNull()
    })

    it("should fetch notebook description for notebook items", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          notebooks: [{ id: "nb-1", title: "My Notebook" }],
        })
        .mockResolvedValueOnce({
          description: "This notebook contains AI research notes",
          keywords: ["ai", "research"],
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when getting notebook item
      const item = await provider.getById("nb-1::notebook")

      // #then should return notebook with description
      expect(item).not.toBeNull()
      expect(item?.id).toBe("notebooklm::nb-1::notebook")
      expect(item?.title).toBe("My Notebook")
      expect(item?.content).toBe("This notebook contains AI research notes")
      expect(item?.metadata.tags).toEqual(["ai", "research"])
    })

    it("should fetch source description for source items", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ notebooks: [] })
        .mockResolvedValueOnce({
          summary: "Source about machine learning",
          keywords: ["ml", "neural-networks"],
        })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when getting source item
      const item = await provider.getById("nb-1::source::src-123")

      // #then should return source with summary
      expect(item).not.toBeNull()
      expect(item?.id).toBe("notebooklm::nb-1::source::src-123")
      expect(item?.content).toBe("Source about machine learning")
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "source_describe",
        { notebook_id: "nb-1", source_id: "src-123" }
      )
    })

    it("should return null on fetch errors", async () => {
      // #given an initialized provider where describe fails
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ notebooks: [] })
        .mockRejectedValueOnce(new Error("Fetch failed"))

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when getting item
      const item = await provider.getById("nb-1::notebook")

      // #then should return null
      expect(item).toBeNull()
    })
  })

  describe("index", () => {
    it("should not index when not initialized", async () => {
      // #given a provider that was never initialized
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true, defaultNotebookId: "nb-1" },
        mockInvoker
      )

      // #when indexing
      await provider.index({
        id: "test",
        provider: "notebooklm",
        title: "Test Item",
        summary: "Summary",
        type: "document",
        metadata: { sourceType: "mcp", sourceId: "test" },
      })

      // #then should not call invoke
      expect(mockInvoker.invoke).not.toHaveBeenCalled()
    })

    it("should not index without defaultNotebookId", async () => {
      // #given an initialized provider without defaultNotebookId
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when indexing
      await provider.index({
        id: "test",
        provider: "notebooklm",
        title: "Test Item",
        summary: "Summary",
        content: "Content",
        type: "document",
        metadata: { sourceType: "mcp", sourceId: "test" },
      })

      // #then should only call notebook_list, not add methods
      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1)
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "notebook_list",
        {}
      )
    })

    it("should add URL source when url is present", async () => {
      // #given an initialized provider with defaultNotebookId
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true, defaultNotebookId: "nb-1" },
        mockInvoker
      )
      await provider.initialize()

      // #when indexing item with URL
      await provider.index({
        id: "test",
        provider: "notebooklm",
        title: "Test Item",
        summary: "Summary",
        type: "document",
        metadata: { sourceType: "mcp", sourceId: "test", url: "https://example.com" },
      })

      // #then should call notebook_add_url
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "notebook_add_url",
        { notebook_id: "nb-1", url: "https://example.com" }
      )
    })

    it("should add text source when content is present without URL", async () => {
      // #given an initialized provider with defaultNotebookId
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true, defaultNotebookId: "nb-1" },
        mockInvoker
      )
      await provider.initialize()

      // #when indexing item with content
      await provider.index({
        id: "test",
        provider: "notebooklm",
        title: "Test Document",
        summary: "Summary",
        content: "This is the document content",
        type: "document",
        metadata: { sourceType: "mcp", sourceId: "test" },
      })

      // #then should call notebook_add_text
      expect(mockInvoker.invoke).toHaveBeenCalledWith(
        "notebooklm-mcp",
        "notebook_add_text",
        {
          notebook_id: "nb-1",
          text: "# Test Document\n\nThis is the document content",
          title: "Test Document",
        }
      )
    })
  })

  describe("healthCheck", () => {
    it("should return unavailable when disabled", async () => {
      // #given a disabled provider
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: false },
        mockInvoker
      )

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return unavailable
      expect(health.status).toBe("unavailable")
      expect(health.message).toBe("Provider is disabled")
    })

    it("should return unavailable when MCP server is down", async () => {
      // #given a provider with unavailable MCP server
      ;(mockInvoker.isServerAvailable as ReturnType<typeof mock>).mockResolvedValue(false)
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return unavailable
      expect(health.status).toBe("unavailable")
      expect(health.message).toBe("NotebookLM MCP server is not available")
    })

    it("should return healthy with latency when operational", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [{ id: "nb-1" }, { id: "nb-2" }],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return healthy with latency
      expect(health.status).toBe("healthy")
      expect(health.latencyMs).toBeDefined()
      expect(health.message).toBe("2 notebooks cached")
      expect(health.lastChecked).toBeDefined()
    })

    it("should return degraded on health check errors", async () => {
      // #given an initialized provider where isServerAvailable fails
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()
      ;(mockInvoker.isServerAvailable as ReturnType<typeof mock>).mockRejectedValue(
        new Error("Connection timeout")
      )

      // #when checking health
      const health = await provider.healthCheck()

      // #then should return degraded
      expect(health.status).toBe("degraded")
      expect(health.message).toBe("Connection timeout")
    })
  })

  describe("dispose", () => {
    it("should clear state on dispose", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [{ id: "nb-1" }],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when disposing
      await provider.dispose()

      // #then should be uninitialized and notebooks cleared
      const results = await provider.search({ text: "test" })
      expect(results).toEqual([])
    })
  })

  describe("listNotebooks", () => {
    it("should return cached notebooks", async () => {
      // #given an initialized provider with notebooks
      ;(mockInvoker.invoke as ReturnType<typeof mock>).mockResolvedValue({
        notebooks: [
          { id: "nb-1", title: "First Notebook" },
          { id: "nb-2", title: "Second Notebook", description: "Desc" },
        ],
      })
      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when listing notebooks
      const notebooks = await provider.listNotebooks()

      // #then should return all notebooks
      expect(notebooks).toHaveLength(2)
      expect(notebooks[0].id).toBe("nb-1")
      expect(notebooks[0].title).toBe("First Notebook")
      expect(notebooks[1].id).toBe("nb-2")
      expect(notebooks[1].description).toBe("Desc")
    })

    it("should refresh notebooks on each call", async () => {
      // #given an initialized provider
      ;(mockInvoker.invoke as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ notebooks: [{ id: "nb-1" }] })
        .mockResolvedValueOnce({ notebooks: [{ id: "nb-1" }, { id: "nb-2" }] })

      const provider = new NotebookLMKnowledgeProvider(
        { enabled: true },
        mockInvoker
      )
      await provider.initialize()

      // #when listing notebooks again
      const notebooks = await provider.listNotebooks()

      // #then should have refreshed data
      expect(notebooks).toHaveLength(2)
      expect(mockInvoker.invoke).toHaveBeenCalledTimes(2)
    })
  })
})
