/**
 * Knowledge Provider Types
 *
 * Unified abstraction layer for aggregating knowledge from multiple sources:
 * - Local Knowledge Repository (file-based ADRs, policies, patterns)
 * - Mem0 (vector-based semantic memory)
 * - MCP servers (Dust.tt, NotebookLM, custom)
 */

import type { KnowledgeLayer, KnowledgeType, Severity } from "../knowledge-repo/types"
import type { MemoryLayer } from "../mem0-memory/types"

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Types of knowledge providers.
 */
export type KnowledgeProviderType = "local" | "mem0" | "mcp"

/**
 * Health status for a provider.
 */
export type ProviderHealthStatus = "healthy" | "degraded" | "unavailable"

/**
 * Provider health check result.
 */
export interface ProviderHealth {
  status: ProviderHealthStatus
  latencyMs?: number
  message?: string
  lastChecked: string
}

// =============================================================================
// Knowledge Item Types
// =============================================================================

/**
 * Normalized knowledge item from any provider.
 * Common interface across all knowledge sources.
 */
export interface KnowledgeItem {
  /** Unique identifier (provider-prefixed) */
  id: string
  /** Provider that owns this item */
  provider: string
  /** Human-readable title */
  title: string
  /** Brief summary for context efficiency */
  summary: string
  /** Full content (may be lazy-loaded) */
  content?: string
  /** Item type for categorization */
  type: KnowledgeItemType
  /** Organizational layer if applicable */
  layer?: string
  /** Relevance score (0-1) for search results */
  score?: number
  /** Source-specific metadata */
  metadata: KnowledgeItemMetadata
  /** ISO 8601 creation timestamp */
  createdAt?: string
  /** ISO 8601 update timestamp */
  updatedAt?: string
}

/**
 * Type of knowledge item (normalized across providers).
 */
export type KnowledgeItemType =
  // From local knowledge repo
  | "adr"
  | "policy"
  | "pattern"
  | "spec"
  // From Mem0
  | "memory"
  // From MCP
  | "document"
  | "article"
  | "snippet"
  | "unknown"

/**
 * Metadata for knowledge items.
 */
export interface KnowledgeItemMetadata {
  /** Original source type */
  sourceType: KnowledgeProviderType
  /** Source-specific identifier */
  sourceId?: string
  /** URL for external sources */
  url?: string
  /** Tags for categorization */
  tags?: string[]
  /** Severity level (for policies/constraints) */
  severity?: Severity
  /** Layer mapping */
  knowledgeLayer?: KnowledgeLayer
  memoryLayer?: MemoryLayer
  /** Additional provider-specific data */
  extra?: Record<string, unknown>
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Query parameters for searching knowledge.
 */
export interface KnowledgeQuery {
  /** Full-text search query */
  text: string
  /** Filter by organizational layers */
  layers?: string[]
  /** Filter by knowledge types */
  types?: KnowledgeItemType[]
  /** Filter to specific providers (by name) */
  providers?: string[]
  /** Maximum number of results */
  limit?: number
  /** Minimum similarity threshold (0-1) for vector search */
  threshold?: number
  /** Include full content in results */
  includeContent?: boolean
}

/**
 * Search result from a knowledge provider.
 */
export interface KnowledgeSearchResult {
  /** The knowledge item */
  item: KnowledgeItem
  /** Relevance score (0-1) */
  score: number
  /** Highlighted snippets matching query */
  highlights?: string[]
}

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Interface for knowledge providers.
 * Implementations wrap specific knowledge sources (local repo, Mem0, MCP).
 */
export interface KnowledgeProvider {
  /** Unique provider name */
  readonly name: string
  /** Provider type */
  readonly type: KnowledgeProviderType
  /** Human-readable description */
  readonly description?: string

  /**
   * Initialize the provider.
   * Called once when the provider is registered.
   */
  initialize(): Promise<void>

  /**
   * Search for knowledge items.
   * @param query Search parameters
   * @returns Matching items with scores
   */
  search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]>

  /**
   * Get a specific knowledge item by ID.
   * @param id The item identifier
   * @returns The item or null if not found
   */
  getById?(id: string): Promise<KnowledgeItem | null>

  /**
   * Index a new knowledge item (for providers that support write).
   * @param item The item to index
   */
  index?(item: KnowledgeItem): Promise<void>

  /**
   * Check provider health.
   * @returns Health status and metrics
   */
  healthCheck(): Promise<ProviderHealth>

  /**
   * Clean up resources.
   * Called when the provider is unregistered.
   */
  dispose?(): Promise<void>
}

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Merge strategy for combining results from multiple providers.
 */
export type MergeStrategy =
  | "score" // Sort by relevance score (default)
  | "round-robin" // Alternate between providers
  | "provider-priority" // Prefer results from higher-priority providers

/**
 * Configuration for the knowledge provider registry.
 */
export interface KnowledgeProviderRegistryConfig {
  /** Default result limit */
  defaultLimit: number
  /** Default similarity threshold */
  defaultThreshold: number
  /** Strategy for merging results */
  mergeStrategy: MergeStrategy
  /** Provider priority order (highest first) */
  providerPriority?: string[]
  /** Enable deduplication by content hash */
  deduplicate: boolean
}

/**
 * Interface for the knowledge provider registry.
 * Aggregates and coordinates multiple knowledge providers.
 */
export interface IKnowledgeProviderRegistry {
  /**
   * Register a knowledge provider.
   * @param provider The provider to register
   */
  register(provider: KnowledgeProvider): Promise<void>

  /**
   * Unregister a knowledge provider by name.
   * @param name Provider name
   */
  unregister(name: string): Promise<void>

  /**
   * Search across all registered providers.
   * @param query Search parameters
   * @returns Aggregated and ranked results
   */
  search(query: KnowledgeQuery): Promise<KnowledgeSearchResult[]>

  /**
   * Get a knowledge item by ID from any provider.
   * @param id Item ID (may be provider-prefixed)
   * @returns The item or null
   */
  getById(id: string): Promise<KnowledgeItem | null>

  /**
   * Get all registered providers.
   * @returns Array of providers
   */
  getProviders(): KnowledgeProvider[]

  /**
   * Get a specific provider by name.
   * @param name Provider name
   * @returns The provider or undefined
   */
  getProvider(name: string): KnowledgeProvider | undefined

  /**
   * Check health of all providers.
   * @returns Map of provider name to health status
   */
  healthCheck(): Promise<Map<string, ProviderHealth>>
}

// =============================================================================
// Provider Configuration Types
// =============================================================================

/**
 * Configuration for the local knowledge provider.
 */
export interface LocalProviderConfig {
  enabled: boolean
  /** Root directory for knowledge repository */
  rootDir?: string
}

/**
 * Configuration for the Mem0 knowledge provider.
 */
export interface Mem0ProviderConfig {
  enabled: boolean
  /** Auto-index knowledge repo items to Mem0 */
  indexKnowledgeRepo: boolean
  /** Layers to search */
  searchLayers?: MemoryLayer[]
}

/**
 * Transport type for MCP connections.
 * - stdio: Spawns a local process and communicates via stdin/stdout (default)
 * - sse: Connects to an HTTP/SSE endpoint (for servers like Dust CLI that run as HTTP servers)
 */
export type MCPTransportType = "stdio" | "sse"

/**
 * Configuration for an MCP knowledge provider.
 */
export interface MCPProviderConfig {
  /** MCP server name (unique identifier) */
  name: string

  /**
   * Transport type for connecting to the MCP server.
   * - "stdio" (default): Spawn a local process
   * - "sse": Connect to an HTTP/SSE endpoint
   */
  transport?: MCPTransportType

  // === Stdio transport options (when transport is "stdio" or undefined) ===

  /** Command to start the MCP server (e.g., 'npx'). Required for stdio transport. */
  command?: string
  /** Arguments for the command */
  args?: string[]
  /** Environment variables for the MCP process */
  env?: Record<string, string>

  // === SSE transport options (when transport is "sse") ===

  /** URL for SSE transport (e.g., 'http://localhost:60062/sse'). Required for sse transport. */
  url?: string

  // === Common options ===

  /** Tool name for search operations */
  searchTool: string
  /** Tool name for get-by-id operations */
  getTool?: string
  /** Additional config passed to MCP tools */
  config?: Record<string, unknown>
}

/**
 * Top-level configuration for the knowledge provider system.
 */
export interface KnowledgeProviderSystemConfig {
  enabled: boolean
  providers: {
    local?: LocalProviderConfig
    mem0?: Mem0ProviderConfig
    mcp?: {
      enabled: boolean
      servers: MCPProviderConfig[]
    }
  }
  search: {
    defaultLimit: number
    defaultThreshold: number
    mergeStrategy: MergeStrategy
  }
}
