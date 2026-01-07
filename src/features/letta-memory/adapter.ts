import type {
  LettaConfig,
  LettaAgent,
  LettaBlock,
  LettaPassage,
  LettaSearchResponse,
  Memory,
  MemorySearchResult,
  AddMemoryInput,
  SearchMemoryInput,
  UpdateMemoryInput,
  MemoryStats,
  MemoryLayer,
} from "./types"

const DEFAULT_ENDPOINT = "http://localhost:8283"
const DEFAULT_AGENT_PREFIX = "opencode"
const DEFAULT_LLM_MODEL = "letta/letta-free"
const DEFAULT_EMBEDDING_MODEL = "letta/letta-free"

interface LettaModel {
  handle: string
  name: string
  model_endpoint: string
  model_type?: string
  provider_name?: string
}

export class LettaAdapter {
  private config: LettaConfig
  private endpoint: string
  private agentCache: Map<string, LettaAgent> = new Map()
  private detectedEmbeddingModel: string | null = null
  private modelDetectionPromise: Promise<void> | null = null

  constructor(config: LettaConfig) {
    this.config = config
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  }

  private async detectEmbeddingModel(): Promise<string> {
    if (this.config.embeddingModel) {
      return this.config.embeddingModel
    }

    if (this.detectedEmbeddingModel) {
      return this.detectedEmbeddingModel
    }

    if (this.modelDetectionPromise) {
      await this.modelDetectionPromise
      return this.detectedEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL
    }

    this.modelDetectionPromise = (async () => {
      try {
        const response = await fetch(`${this.endpoint}/v1/models`, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          return
        }

        const models = (await response.json()) as LettaModel[]

        const proxyEmbeddingModels = models.filter(
          (m) =>
            m.name.includes("embedding") &&
            m.model_endpoint.includes("host.docker.internal") &&
            m.provider_name === "openai"
        )

        if (proxyEmbeddingModels.length > 0) {
          const preferredName = this.config.preferredEmbeddingModel ?? "text-embedding-3-small"
          const preferred = proxyEmbeddingModels.find((m) => m.name.includes(preferredName))
          const model = preferred ?? proxyEmbeddingModels[0]
          this.detectedEmbeddingModel = `openai/${model.name}`
        }
      } catch {
        // Fall back to default
      }
    })()

    await this.modelDetectionPromise
    return this.detectedEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL
  }

  async add(input: AddMemoryInput): Promise<Memory> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    const agent = await this.getOrCreateAgent(input.layer)
    const tags = [
      `layer:${input.layer}`,
      ...(input.tags ?? []),
      ...(input.metadata ? Object.entries(input.metadata).map(([k, v]) => `${k}:${v}`) : []),
    ]

    const response = await this.request(`/v1/agents/${agent.id}/archival-memory`, {
      method: "POST",
      body: JSON.stringify({
        text: input.content,
        tags,
      }),
    })

    const data = await response.json()
    const passage = (Array.isArray(data) ? data[0] : data) as LettaPassage
    return this.passageToMemory(passage, input.layer, agent.id)
  }

  async search(input: SearchMemoryInput): Promise<MemorySearchResult[]> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    const layers = this.normalizeLayers(input.layer)
    const results: MemorySearchResult[] = []

    for (const layer of layers) {
      try {
        const agent = await this.getAgent(layer)
        if (!agent) continue

        const params = new URLSearchParams()
        params.set("query", input.query)
        if (input.limit) params.set("limit", String(input.limit))
        if (input.tags?.length) {
          params.set("tags", input.tags.join(","))
          params.set("tag_match_mode", input.tagMatchMode ?? "any")
        }

        const response = await this.request(
          `/v1/agents/${agent.id}/archival-memory/search?${params.toString()}`,
          { method: "GET" }
        )

        const data = (await response.json()) as LettaSearchResponse
        const searchResults = data.results ?? []
        const layerResults = searchResults.map((item, index) => ({
          memory: {
            id: `search-${agent.id}-${item.timestamp}-${index}`,
            content: item.content,
            layer,
            metadata: item.tags ? { tags: item.tags } : undefined,
            createdAt: item.timestamp,
            source: "passage" as const,
            agentId: agent.id,
          },
          score: 1 - index * 0.05,
        }))
        results.push(...layerResults)
      } catch {
        continue
      }
    }

    return results
      .filter((r) => !input.threshold || r.score >= input.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 10)
  }

  async get(id: string): Promise<Memory | null> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    for (const layer of this.getAllLayers()) {
      try {
        const agent = await this.getAgent(layer)
        if (!agent) continue

        const response = await this.request(
          `/v1/agents/${agent.id}/archival-memory`,
          { method: "GET" }
        )

        const passages = (await response.json()) as LettaPassage[]
        const passage = passages.find((p) => p.id === id)
        if (passage) {
          return this.passageToMemory(passage, layer, agent.id)
        }
      } catch {
        continue
      }
    }

    return null
  }

  async update(input: UpdateMemoryInput): Promise<Memory> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    const existing = await this.get(input.id)
    if (!existing) {
      throw new Error(`Memory not found: ${input.id}`)
    }

    await this.delete(input.id)

    return this.add({
      content: input.content ?? existing.content,
      layer: existing.layer,
      metadata: input.metadata
        ? { ...existing.metadata, ...input.metadata }
        : existing.metadata,
      tags: input.tags,
    })
  }

  async delete(id: string): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    for (const layer of this.getAllLayers()) {
      try {
        const agent = await this.getAgent(layer)
        if (!agent) continue

        await this.request(`/v1/agents/${agent.id}/archival-memory/${id}`, {
          method: "DELETE",
        })
        return
      } catch {
        continue
      }
    }

    throw new Error(`Memory not found: ${id}`)
  }

  async getAll(layer?: MemoryLayer): Promise<Memory[]> {
    if (!this.config.enabled) {
      throw new Error("Letta is not enabled")
    }

    const layers = layer ? [layer] : this.getAllLayers()
    const memories: Memory[] = []

    for (const l of layers) {
      try {
        const agent = await this.getAgent(l)
        if (!agent) continue

        const response = await this.request(
          `/v1/agents/${agent.id}/archival-memory`,
          { method: "GET" }
        )

        const passages = (await response.json()) as LettaPassage[]
        memories.push(...passages.map((p) => this.passageToMemory(p, l, agent.id)))
      } catch {
        continue
      }
    }

    return memories
  }

  async getStats(): Promise<MemoryStats> {
    const memories = await this.getAll()
    const byLayer: Record<MemoryLayer, number> = {
      user: 0,
      session: 0,
      project: 0,
      team: 0,
      org: 0,
      company: 0,
      agent: 0,
    }

    for (const memory of memories) {
      byLayer[memory.layer]++
    }

    const agents = await this.listAgents()

    return {
      totalMemories: memories.length,
      byLayer,
      totalAgents: agents.length,
      totalPassages: memories.length,
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/v1/health`, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async getOrCreateAgent(layer: MemoryLayer): Promise<LettaAgent> {
    const existing = await this.getAgent(layer)
    if (existing) {
      const needsUpdate = await this.agentNeedsEmbeddingUpdate(existing)
      if (needsUpdate) {
        return this.recreateAgentWithCorrectEmbedding(existing, layer)
      }
      return existing
    }

    const embeddingModel = await this.detectEmbeddingModel()
    const agentName = this.getAgentName(layer)
    
    const response = await this.request("/v1/agents", {
      method: "POST",
      body: JSON.stringify({
        name: agentName,
        model: this.config.llmModel ?? DEFAULT_LLM_MODEL,
        embedding: embeddingModel,
        memory_blocks: [
          { label: "persona", value: `OpenCode memory agent for ${layer} layer` },
          { label: "human", value: this.getUserId(layer) },
        ],
        metadata: {
          layer,
          user_id: this.getUserId(layer),
          created_by: "oh-my-opencode",
        },
      }),
    })

    const agent = (await response.json()) as LettaAgent
    this.agentCache.set(layer, agent)
    return agent
  }

  private async agentNeedsEmbeddingUpdate(agent: LettaAgent): Promise<boolean> {
    if (this.config.embeddingModel) {
      return false
    }

    const embeddingHandle = agent.embedding_config?.handle ?? agent.embedding
    if (!embeddingHandle) return false

    if (embeddingHandle === "letta/letta-free") {
      const detected = await this.detectEmbeddingModel()
      return detected !== "letta/letta-free"
    }

    return false
  }

  private async recreateAgentWithCorrectEmbedding(
    existingAgent: LettaAgent,
    layer: MemoryLayer
  ): Promise<LettaAgent> {
    await this.request(`/v1/agents/${existingAgent.id}`, { method: "DELETE" }).catch(() => {})

    this.agentCache.delete(layer)

    const embeddingModel = await this.detectEmbeddingModel()
    const agentName = this.getAgentName(layer)
    const response = await this.request("/v1/agents", {
      method: "POST",
      body: JSON.stringify({
        name: agentName,
        model: this.config.llmModel ?? DEFAULT_LLM_MODEL,
        embedding: embeddingModel,
        memory_blocks: [
          { label: "persona", value: `OpenCode memory agent for ${layer} layer` },
          { label: "human", value: this.getUserId(layer) },
        ],
        metadata: {
          layer,
          user_id: this.getUserId(layer),
          created_by: "oh-my-opencode",
        },
      }),
    })

    const agent = (await response.json()) as LettaAgent
    this.agentCache.set(layer, agent)
    return agent
  }

  private async getAgent(layer: MemoryLayer): Promise<LettaAgent | null> {
    if (this.agentCache.has(layer)) {
      return this.agentCache.get(layer)!
    }

    const agentName = this.getAgentName(layer)
    const agents = await this.listAgents()
    const agent = agents.find((a) => a.name === agentName)

    if (agent) {
      this.agentCache.set(layer, agent)
    }

    return agent ?? null
  }

  private async listAgents(): Promise<LettaAgent[]> {
    try {
      const response = await this.request("/v1/agents", { method: "GET" })
      const data = (await response.json()) as LettaAgent[]
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  private async request(
    path: string,
    options: {
      method: string
      body?: string
    }
  ): Promise<Response> {
    // Letta API requires trailing slashes on all endpoints
    // Without them, the API returns 307 redirects which cause empty responses
    const basePath = path.split("?")[0]
    const queryString = path.includes("?") ? path.slice(path.indexOf("?")) : ""
    const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`
    const normalizedPath = `${normalizedBase}${queryString}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    const response = await fetch(`${this.endpoint}${normalizedPath}`, {
      method: options.method,
      headers,
      body: options.body,
      redirect: "follow",
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Letta API error: ${response.status} ${response.statusText} - ${text}`)
    }

    return response
  }

  private getAgentName(layer: MemoryLayer): string {
    const prefix = this.config.agentPrefix ?? DEFAULT_AGENT_PREFIX
    const userId = this.getUserId(layer)
    return `${prefix}-${layer}-${userId}`
  }

  private getUserId(layer: MemoryLayer): string {
    switch (layer) {
      case "user":
        return this.config.userId ?? "default-user"
      case "session":
        return `session-${this.config.userId ?? "default"}`
      case "project":
        return this.config.projectId ?? "default-project"
      case "team":
        return this.config.teamId ?? "default-team"
      case "org":
        return this.config.orgId ?? "default-org"
      case "company":
        return this.config.companyId ?? "default-company"
      case "agent":
        return "default-agent"
    }
  }

  private normalizeLayers(layer?: MemoryLayer | MemoryLayer[]): MemoryLayer[] {
    if (!layer) return this.getAllLayers()
    return Array.isArray(layer) ? layer : [layer]
  }

  private getAllLayers(): MemoryLayer[] {
    return ["user", "session", "project", "team", "org", "company", "agent"]
  }

  private passageToMemory(
    passage: LettaPassage,
    layer: MemoryLayer,
    agentId: string
  ): Memory {
    return {
      id: passage.id,
      content: passage.text,
      layer,
      metadata: passage.metadata,
      createdAt: passage.created_at,
      source: "passage",
      agentId,
    }
  }
}
