import { describe, test, expect, mock, beforeEach } from "bun:test"
import { createMemoryTools } from "./tools"
import { Mem0Adapter } from "../../features/mem0-memory/adapter"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

describe("createMemoryTools", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("memory_add", () => {
    test("stores memory and returns success", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "mem-123",
            memory: "test content",
            created_at: "2026-01-03T00:00:00Z",
          }),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
        userId: "user-1",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_add.execute({
        content: "test content",
        layer: "user",
      }, mockContext)

      // #then
      expect(result).toContain("Memory stored successfully")
      expect(result).toContain("mem-123")
      expect(result).toContain("user")
    })

    test("truncates content over max length", async () => {
      // #given
      let capturedBody: string | undefined

      globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
        capturedBody = options?.body as string
        return new Response(
          JSON.stringify({
            id: "mem-123",
            memory: "truncated",
            created_at: "2026-01-03T00:00:00Z",
          }),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      const longContent = "x".repeat(15000)

      // #when
      await tools.memory_add.execute({
        content: longContent,
        layer: "user",
      }, mockContext)

      // #then
      const body = JSON.parse(capturedBody!)
      expect(body.messages[0].content.length).toBeLessThanOrEqual(10000)
    })

    test("handles error gracefully", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response("Server Error", { status: 500, statusText: "Internal Server Error" })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_add.execute({
        content: "test",
        layer: "user",
      }, mockContext)

      // #then
      expect(result).toContain("Error storing memory")
    })
  })

  describe("memory_search", () => {
    test("searches and returns formatted results", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify([
            { id: "mem-1", memory: "first memory", score: 0.9, created_at: "2026-01-01" },
            { id: "mem-2", memory: "second memory", score: 0.7, created_at: "2026-01-02" },
          ]),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_search.execute({
        query: "test query",
        layer: "user",
      }, mockContext)

      // #then
      expect(result).toContain("Found 2 relevant memories")
      expect(result).toContain("mem-1")
      expect(result).toContain("mem-2")
      expect(result).toContain("0.90")
      expect(result).toContain("0.70")
    })

    test("returns message when no memories found", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify([]), { status: 200 })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_search.execute({
        query: "nonexistent",
        layer: "user",
      }, mockContext)

      // #then
      expect(result).toBe("No memories found matching your query.")
    })

    test("supports searching multiple layers", async () => {
      // #given
      let callCount = 0
      globalThis.fetch = mock(async () => {
        callCount++
        return new Response(
          JSON.stringify([
            { id: `mem-${callCount}`, memory: `memory ${callCount}`, score: 0.8 },
          ]),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
        userId: "user-1",
        projectId: "proj-1",
      })
      const tools = createMemoryTools(adapter)

      // #when
      await tools.memory_search.execute({
        query: "test",
        layers: ["user", "project"],
      }, mockContext)

      // #then - should have called fetch for each layer
      expect(callCount).toBe(2)
    })
  })

  describe("memory_get", () => {
    test("retrieves memory by ID", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "mem-123",
            memory: "full content here",
            metadata: { layer: "user", tag: "important" },
            created_at: "2026-01-03T00:00:00Z",
          }),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_get.execute({ id: "mem-123" }, mockContext)

      // #then
      expect(result).toContain("Memory: mem-123")
      expect(result).toContain("full content here")
      expect(result).toContain("Metadata")
    })

    test("returns not found for missing memory", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response("Not found", { status: 404 })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_get.execute({ id: "nonexistent" }, mockContext)

      // #then
      expect(result).toBe("Memory not found: nonexistent")
    })
  })

  describe("memory_update", () => {
    test("updates memory content", async () => {
      // #given
      let callCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        callCount++
        const urlStr = url.toString()
        if (callCount === 1 && urlStr.includes("/memories/mem-123")) {
          return new Response(
            JSON.stringify({
              id: "mem-123",
              memory: "old content",
              metadata: { layer: "user" },
              created_at: "2026-01-03T00:00:00Z",
            }),
            { status: 200 }
          )
        }
        return new Response(
          JSON.stringify({
            id: "mem-123",
            memory: "new content",
            metadata: { layer: "user" },
            updated_at: "2026-01-03T12:00:00Z",
          }),
          { status: 200 }
        )
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_update.execute({
        id: "mem-123",
        content: "new content",
      }, mockContext)

      // #then
      expect(result).toContain("Memory updated successfully")
      expect(result).toContain("mem-123")
    })

    test("requires content or metadata", async () => {
      // #given
      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_update.execute({ id: "mem-123" }, mockContext)

      // #then
      expect(result).toBe("Error: Provide at least content or metadata to update.")
    })
  })

  describe("memory_delete", () => {
    test("deletes memory successfully", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_delete.execute({ id: "mem-123" }, mockContext)

      // #then
      expect(result).toBe("Memory mem-123 deleted successfully.")
    })

    test("handles delete error", async () => {
      // #given
      globalThis.fetch = mock(async () => {
        return new Response("Not found", { status: 404, statusText: "Not Found" })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_delete.execute({ id: "nonexistent" }, mockContext)

      // #then
      expect(result).toContain("Error deleting memory")
    })
  })

  describe("memory_stats", () => {
    test("returns formatted statistics", async () => {
      // #given
      let callCount = 0
      globalThis.fetch = mock(async () => {
        callCount++
        if (callCount <= 3) {
          return new Response(
            JSON.stringify([
              { id: `mem-${callCount}`, memory: `memory ${callCount}` },
            ]),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }) as unknown as typeof fetch

      const adapter = new Mem0Adapter({
        enabled: true,
        apiKey: "test-key",
        userId: "user-1",
        projectId: "proj-1",
        orgId: "org-1",
      })
      const tools = createMemoryTools(adapter)

      // #when
      const result = await tools.memory_stats.execute({}, mockContext)

      // #then
      expect(result).toContain("Memory Statistics")
      expect(result).toContain("Total Memories")
      expect(result).toContain("By Layer")
    })
  })
})
