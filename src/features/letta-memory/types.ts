/**
 * Letta (formerly MemGPT) Memory Types
 *
 * Letta organizes memory around Agents with:
 * - Core Memory (Blocks): Always in-context, editable by agent
 * - Archival Memory (Passages): Out-of-context, searchable via embeddings
 */

export type MemoryLayer =
  | "user"
  | "session"
  | "project"
  | "team"
  | "org"
  | "company"
  | "agent"

export interface LettaConfig {
  enabled: boolean
  /** Letta server endpoint (default: http://localhost:8283) */
  endpoint?: string
  /** Optional API key for cloud Letta (not needed for self-hosted) */
  apiKey?: string
  /** User identifier for scoping agents */
  userId?: string
  /** Project identifier */
  projectId?: string
  /** Team identifier */
  teamId?: string
  /** Organization identifier */
  orgId?: string
  /** Company identifier */
  companyId?: string
  /** Default agent name prefix */
  agentPrefix?: string
  /** LLM model for agent (e.g., "openai/gpt-4.1") */
  llmModel?: string
  /**
   * Embedding model for semantic search.
   * Use format "provider/model" e.g.:
   * - "openai/text-embedding-3-large" (best quality, 3072 dimensions)
   * - "openai/text-embedding-3-small" (good balance, 1536 dimensions)
   * - "openai/text-embedding-ada-002" (legacy)
   * - "letta/letta-free" (default, requires Letta cloud auth)
   *
   * If not set, auto-detects local proxy models with "openai" provider.
   */
  embeddingModel?: string
  /**
   * Preferred embedding model for auto-detection.
   * When embeddingModel is not set and multiple proxy models are available,
   * this determines which one to prefer. Partial match on model name.
   * Default: "text-embedding-3-small"
   * Set to "text-embedding-3-large" for better quality.
   */
  preferredEmbeddingModel?: string
  /** Auto-rehydrate memories on session start */
  autoRehydrate?: boolean
  /** Layers to rehydrate */
  rehydrateLayers?: MemoryLayer[]
}

/** Letta Agent representation */
export interface LettaAgent {
  id: string
  name: string
  description?: string
  created_at: string
  user_id?: string
  metadata?: Record<string, unknown>
  memory_blocks?: LettaBlock[]
  tools?: string[]
  embedding?: string
  embedding_config?: {
    handle?: string
    embedding_model?: string
    embedding_endpoint?: string
  }
}

/** Letta Memory Block (Core Memory - always in-context) */
export interface LettaBlock {
  id: string
  label: string
  value: string
  description?: string
  limit?: number
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

/** Letta Passage (Archival Memory - searchable) */
export interface LettaPassage {
  id: string
  text: string
  agent_id?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  created_at: string
  embedding?: number[]
}

/** Letta Archive container for passages */
export interface LettaArchive {
  id: string
  name: string
  description?: string
  agent_id?: string
  created_at: string
}

/** Unified memory representation (compatible with existing tools) */
export interface Memory {
  id: string
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt?: string
  /** Letta-specific: source type */
  source?: "block" | "passage"
  /** Letta-specific: agent ID */
  agentId?: string
}

export interface MemorySearchResult {
  memory: Memory
  score: number
}

export interface AddMemoryInput {
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
  /** Store as block (core memory) or passage (archival). Default: passage */
  type?: "block" | "passage"
  /** Block label if storing as block */
  blockLabel?: string
  /** Tags for passage search */
  tags?: string[]
}

export interface SearchMemoryInput {
  query: string
  layer?: MemoryLayer | MemoryLayer[]
  limit?: number
  threshold?: number
  /** Filter by tags */
  tags?: string[]
  /** Tag match mode */
  tagMatchMode?: "any" | "all"
}

export interface UpdateMemoryInput {
  id: string
  content?: string
  metadata?: Record<string, unknown>
  tags?: string[]
}

export interface MemoryStats {
  totalMemories: number
  byLayer: Record<MemoryLayer, number>
  /** Letta-specific stats */
  totalAgents?: number
  totalBlocks?: number
  totalPassages?: number
}

/** Letta API response types */
export interface LettaApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

export interface LettaSearchResponse {
  passages: LettaPassage[]
  total?: number
}

export interface LettaAgentListResponse {
  agents: LettaAgent[]
}
