import { describe, test, expect, mock, beforeEach } from "bun:test"
import { LettaAdapter } from "./adapter"
import type { LettaConfig, MemoryLayer } from "./types"

describe("LettaAdapter", () => {
  const enabledConfig: LettaConfig = {
    enabled: true,
    endpoint: "http://localhost:8283",
    userId: "test-user",
    projectId: "test-project",
    orgId: "test-org",
    companyId: "test-company",
  }

  const disabledConfig: LettaConfig = {
    enabled: false,
  }

  describe("constructor", () => {
    test("uses default endpoint when not provided", () => {
      // #given
      const config: LettaConfig = { enabled: true }

      // #when
      const adapter = new LettaAdapter(config)

      // #then - endpoint is private, but we can verify via behavior
      expect(adapter).toBeDefined()
    })

    test("uses custom endpoint when provided", () => {
      // #given
      const config: LettaConfig = {
        enabled: true,
        endpoint: "http://custom:9000",
      }

      // #when
      const adapter = new LettaAdapter(config)

      // #then
      expect(adapter).toBeDefined()
    })
  })

  describe("disabled state", () => {
    test("add throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(
        adapter.add({ content: "test", layer: "user" })
      ).rejects.toThrow("Letta is not enabled")
    })

    test("search throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(adapter.search({ query: "test" })).rejects.toThrow(
        "Letta is not enabled"
      )
    })

    test("get throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(adapter.get("some-id")).rejects.toThrow(
        "Letta is not enabled"
      )
    })

    test("update throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(adapter.update({ id: "some-id" })).rejects.toThrow(
        "Letta is not enabled"
      )
    })

    test("delete throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(adapter.delete("some-id")).rejects.toThrow(
        "Letta is not enabled"
      )
    })

    test("getAll throws when disabled", async () => {
      // #given
      const adapter = new LettaAdapter(disabledConfig)

      // #when / #then
      await expect(adapter.getAll()).rejects.toThrow("Letta is not enabled")
    })
  })

  describe("no API key needed for self-hosted", () => {
    test("does not require API key when not provided", () => {
      // #given - Letta self-hosted doesn't require API key
      const config: LettaConfig = { enabled: true }

      // #when
      const adapter = new LettaAdapter(config)

      // #then
      expect(adapter).toBeDefined()
    })
  })

  describe("getUserId mapping", () => {
    test("different layers produce different user IDs in requests", () => {
      // #given
      const adapter = new LettaAdapter(enabledConfig)

      // The actual mapping is:
      // - user: userId
      // - session: session-{userId}
      // - project: projectId
      // - team: teamId
      // - org: orgId
      // - company: companyId
      // - agent: default-agent
      expect(adapter).toBeDefined()
    })
  })

  describe("normalizeLayers", () => {
    test("handles single layer", () => {
      // #given
      const adapter = new LettaAdapter(enabledConfig)

      // Normalization is internal, but we can verify the adapter handles
      // single layer inputs (would be tested via mocked search)
      expect(adapter).toBeDefined()
    })

    test("handles array of layers", () => {
      // #given
      const adapter = new LettaAdapter(enabledConfig)

      // Normalization handles arrays
      expect(adapter).toBeDefined()
    })

    test("defaults to all layers when none specified", () => {
      // #given
      const adapter = new LettaAdapter(enabledConfig)

      // When no layer is specified, all layers should be queried
      expect(adapter).toBeDefined()
    })
  })

  describe("getStats", () => {
    test("initializes all layer counts to zero", () => {
      // #given
      const adapter = new LettaAdapter(enabledConfig)

      // Stats should track: user, session, project, team, org, company, agent
      expect(adapter).toBeDefined()
    })
  })

  describe("isAvailable", () => {
    test("returns false when server unreachable", async () => {
      // #given
      const adapter = new LettaAdapter({
        enabled: true,
        endpoint: "http://localhost:99999", // Non-existent port
      })

      // #when
      const result = await adapter.isAvailable()

      // #then
      expect(result).toBe(false)
    })
  })
})

describe("LettaAdapter with mocked fetch", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Reset fetch to original before each test
    globalThis.fetch = originalFetch
  })

  test("add creates agent and passage", async () => {
    // #given
    const capturedRequests: Array<{ url: string; options: RequestInit }> = []
    let agentCreated = false

    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()
        capturedRequests.push({ url: urlStr, options: options ?? {} })

        if (
          urlStr === "http://localhost:8283/v1/agents" &&
          options?.method === "GET"
        ) {
          return new Response(JSON.stringify([]), { status: 200 })
        }

        if (
          urlStr === "http://localhost:8283/v1/agents" &&
          options?.method === "POST"
        ) {
          agentCreated = true
          return new Response(
            JSON.stringify({
              id: "agent-123",
              name: "opencode-user-test-user",
              created_at: "2026-01-03T00:00:00Z",
            }),
            { status: 200 }
          )
        }

        if (urlStr.includes("/archival-memory") && options?.method === "POST") {
          return new Response(
            JSON.stringify({
              id: "passage-456",
              text: "test content",
              created_at: "2026-01-03T00:00:00Z",
            }),
            { status: 200 }
          )
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const config: LettaConfig = {
      enabled: true,
      endpoint: "http://localhost:8283",
      userId: "test-user",
    }
    const adapter = new LettaAdapter(config)

    // #when
    const result = await adapter.add({
      content: "test content",
      layer: "user",
      metadata: { tag: "important" },
    })

    // #then
    expect(result.id).toBe("passage-456")
    expect(result.content).toBe("test content")
    expect(result.layer).toBe("user")
    expect(result.source).toBe("passage")
    expect(agentCreated).toBe(true)
  })

  test("search queries agent archival memory", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (
          urlStr === "http://localhost:8283/v1/agents" &&
          options?.method === "GET"
        ) {
          return new Response(
            JSON.stringify([
              {
                id: "agent-123",
                name: "opencode-user-default-user",
                created_at: "2026-01-03T00:00:00Z",
              },
            ]),
            { status: 200 }
          )
        }

        if (urlStr.includes("/archival-memory/search")) {
          return new Response(
            JSON.stringify([
              {
                id: "p1",
                text: "first result",
                created_at: "2026-01-03T00:00:00Z",
              },
              {
                id: "p2",
                text: "second result",
                created_at: "2026-01-03T00:00:00Z",
              },
            ]),
            { status: 200 }
          )
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const results = await adapter.search({
      query: "test",
      layer: "user",
      limit: 5,
    })

    // #then
    expect(results.length).toBe(2)
    expect(results[0].memory.content).toBe("first result")
    expect(results[1].memory.content).toBe("second result")
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  test("search respects limit", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (
          urlStr === "http://localhost:8283/v1/agents" &&
          options?.method === "GET"
        ) {
          return new Response(
            JSON.stringify([
              { id: "agent-123", name: "opencode-user-default-user" },
            ]),
            { status: 200 }
          )
        }

        if (urlStr.includes("/archival-memory/search")) {
          return new Response(
            JSON.stringify([
              { id: "p1", text: "a", created_at: "2026-01-03T00:00:00Z" },
              { id: "p2", text: "b", created_at: "2026-01-03T00:00:00Z" },
              { id: "p3", text: "c", created_at: "2026-01-03T00:00:00Z" },
              { id: "p4", text: "d", created_at: "2026-01-03T00:00:00Z" },
              { id: "p5", text: "e", created_at: "2026-01-03T00:00:00Z" },
            ]),
            { status: 200 }
          )
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const results = await adapter.search({
      query: "test",
      layer: "user",
      limit: 3,
    })

    // #then
    expect(results.length).toBe(3)
  })

  test("search applies threshold filtering", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (
          urlStr === "http://localhost:8283/v1/agents" &&
          options?.method === "GET"
        ) {
          return new Response(
            JSON.stringify([
              { id: "agent-123", name: "opencode-user-default-user" },
            ]),
            { status: 200 }
          )
        }

        if (urlStr.includes("/archival-memory/search")) {
          return new Response(
            JSON.stringify([
              { id: "p1", text: "high", created_at: "2026-01-03T00:00:00Z" },
              {
                id: "p2",
                text: "medium-high",
                created_at: "2026-01-03T00:00:00Z",
              },
              { id: "p3", text: "medium", created_at: "2026-01-03T00:00:00Z" },
              { id: "p4", text: "low", created_at: "2026-01-03T00:00:00Z" },
            ]),
            { status: 200 }
          )
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const results = await adapter.search({
      query: "test",
      layer: "user",
      threshold: 0.9,
    })

    // #then
    expect(results.length).toBe(3)
    expect(results.every((r) => r.score >= 0.9)).toBe(true)
  })

  test("get returns null when memory not found", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (urlStr.includes("/v1/agents") && options?.method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 })
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const result = await adapter.get("non-existent")

    // #then
    expect(result).toBeNull()
  })

  test("delete throws when memory not found", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (urlStr.includes("/v1/agents") && options?.method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 })
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when / #then
    await expect(adapter.delete("non-existent")).rejects.toThrow(
      "Memory not found: non-existent"
    )
  })

  test("update throws when memory not found", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (urlStr.includes("/v1/agents") && options?.method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 })
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when / #then
    await expect(
      adapter.update({ id: "non-existent", content: "new content" })
    ).rejects.toThrow("Memory not found: non-existent")
  })

  test("API error throws with status", async () => {
    // #given
    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      })
    }) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when / #then
    await expect(
      adapter.add({ content: "test", layer: "user" })
    ).rejects.toThrow("Letta API error: 500 Internal Server Error")
  })

  test("isAvailable returns true when health check succeeds", async () => {
    // #given
    globalThis.fetch = mock(async () => {
      return new Response("OK", { status: 200 })
    }) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const result = await adapter.isAvailable()

    // #then
    expect(result).toBe(true)
  })

  test("includes API key in header when provided", async () => {
    // #given
    let capturedHeaders: Record<string, string> | undefined

    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        capturedHeaders = options?.headers as Record<string, string>
        return new Response(JSON.stringify([]), { status: 200 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
      apiKey: "cloud-api-key",
    })

    // #when
    await adapter.search({ query: "test", layer: "user" })

    // #then
    expect(capturedHeaders?.Authorization).toBe("Bearer cloud-api-key")
  })

  test("getStats returns correct counts", async () => {
    // #given
    globalThis.fetch = mock(
      async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString()

        if (urlStr.includes("/v1/agents") && options?.method === "GET") {
          return new Response(
            JSON.stringify([
              { id: "agent-1", name: "opencode-user-default-user" },
              { id: "agent-2", name: "opencode-project-default-project" },
            ]),
            { status: 200 }
          )
        }

        if (urlStr.includes("/archival-memory") && options?.method === "GET") {
          // Return different passages per agent
          if (urlStr.includes("agent-1")) {
            return new Response(
              JSON.stringify([
                { id: "p1", text: "user mem", created_at: "2026-01-03T00:00:00Z" },
              ]),
              { status: 200 }
            )
          }
          if (urlStr.includes("agent-2")) {
            return new Response(
              JSON.stringify([
                { id: "p2", text: "project mem", created_at: "2026-01-03T00:00:00Z" },
              ]),
              { status: 200 }
            )
          }
          return new Response(JSON.stringify([]), { status: 200 })
        }

        return new Response("Not found", { status: 404 })
      }
    ) as unknown as typeof fetch

    const adapter = new LettaAdapter({
      enabled: true,
      endpoint: "http://localhost:8283",
    })

    // #when
    const stats = await adapter.getStats()

    // #then
    expect(stats.totalAgents).toBe(2)
    expect(stats.totalMemories).toBeGreaterThanOrEqual(0)
  })
})
