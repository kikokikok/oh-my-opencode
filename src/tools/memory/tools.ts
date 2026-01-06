import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { MemoryAdapter, MemoryLayer } from "./types"
import {
  MEMORY_LAYERS,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_THRESHOLD,
  MAX_CONTENT_LENGTH,
} from "./constants"

export function createMemoryTools(adapter: MemoryAdapter): Record<string, ToolDefinition> {
  const memory_add: ToolDefinition = tool({
    description:
      "Store a memory in Mem0. Use to remember facts, decisions, preferences, or context. " +
      "Memories are organized by layer: user (personal), session (current), project, team, org, company, agent (private to you). " +
      "For knowledge worth sharing, use knowledge_propose instead.",
    args: {
      content: tool.schema
        .string()
        .describe("The content to remember (max 10000 chars)"),
      layer: tool.schema
        .enum(MEMORY_LAYERS)
        .describe("Memory layer: user=personal, session=current session, project=this project, team=team-shared, org=organization, company=company-wide, agent=your private memory"),
      metadata: tool.schema
        .object({})
        .passthrough()
        .optional()
        .describe("Optional metadata key-value pairs"),
    },
    execute: async (args) => {
      try {
        const content = args.content.slice(0, MAX_CONTENT_LENGTH)
        const memory = await adapter.add({
          content,
          layer: args.layer as MemoryLayer,
          metadata: args.metadata as Record<string, unknown> | undefined,
        })

        return [
          "Memory stored successfully.",
          "",
          `**ID:** ${memory.id}`,
          `**Layer:** ${memory.layer}`,
          `**Created:** ${memory.createdAt}`,
        ].join("\n")
      } catch (e) {
        return `Error storing memory: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const memory_search: ToolDefinition = tool({
    description:
      "Search memories by semantic similarity. " +
      "Can search across multiple layers to find relevant context, decisions, or facts. " +
      "Use to recall information from previous sessions or shared team knowledge.",
    args: {
      query: tool.schema
        .string()
        .describe("Search query to find semantically similar memories"),
      layer: tool.schema
        .enum(MEMORY_LAYERS)
        .optional()
        .describe("Limit search to specific layer (default: search all)"),
      layers: tool.schema
        .array(tool.schema.enum(MEMORY_LAYERS))
        .optional()
        .describe("Search specific layers (alternative to single layer)"),
      limit: tool.schema
        .number()
        .optional()
        .describe(`Max results to return (default: ${DEFAULT_SEARCH_LIMIT})`),
      threshold: tool.schema
        .number()
        .optional()
        .describe(`Minimum similarity score 0-1 (default: ${DEFAULT_SEARCH_THRESHOLD})`),
    },
    execute: async (args) => {
      try {
        const layerParam = args.layers
          ? (args.layers as MemoryLayer[])
          : args.layer
            ? (args.layer as MemoryLayer)
            : undefined

        const results = await adapter.search({
          query: args.query,
          layer: layerParam,
          limit: args.limit ?? DEFAULT_SEARCH_LIMIT,
          threshold: args.threshold ?? DEFAULT_SEARCH_THRESHOLD,
        })

        if (results.length === 0) {
          return "No memories found matching your query."
        }

        const lines = [`Found ${results.length} relevant memories:`, ""]

        for (const { memory, score } of results) {
          lines.push(`**${memory.id}** [${memory.layer}] (score: ${score.toFixed(2)})`)
          lines.push(`  ${memory.content.slice(0, 200)}${memory.content.length > 200 ? "..." : ""}`)
          lines.push(`  Created: ${memory.createdAt}`)
          lines.push("")
        }

        return lines.join("\n")
      } catch (e) {
        return `Error searching memories: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const memory_get: ToolDefinition = tool({
    description:
      "Retrieve a specific memory by ID. " +
      "Use when you have a memory ID and need the full content and metadata.",
    args: {
      id: tool.schema.string().describe("The memory ID to retrieve"),
    },
    execute: async (args) => {
      try {
        const memory = await adapter.get(args.id)

        if (!memory) {
          return `Memory not found: ${args.id}`
        }

        const lines = [
          `# Memory: ${memory.id}`,
          "",
          `**Layer:** ${memory.layer}`,
          `**Created:** ${memory.createdAt}`,
        ]

        if (memory.updatedAt) {
          lines.push(`**Updated:** ${memory.updatedAt}`)
        }

        lines.push("")
        lines.push("## Content")
        lines.push("")
        lines.push(memory.content)

        if (memory.metadata && Object.keys(memory.metadata).length > 0) {
          lines.push("")
          lines.push("## Metadata")
          lines.push("")
          lines.push("```json")
          lines.push(JSON.stringify(memory.metadata, null, 2))
          lines.push("```")
        }

        return lines.join("\n")
      } catch (e) {
        return `Error retrieving memory: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const memory_update: ToolDefinition = tool({
    description:
      "Update an existing memory's content or metadata. " +
      "Use to correct or enrich a memory with new information.",
    args: {
      id: tool.schema.string().describe("The memory ID to update"),
      content: tool.schema
        .string()
        .optional()
        .describe("New content (replaces existing)"),
      metadata: tool.schema
        .object({})
        .passthrough()
        .optional()
        .describe("Metadata to merge with existing"),
    },
    execute: async (args) => {
      try {
        if (!args.content && !args.metadata) {
          return "Error: Provide at least content or metadata to update."
        }

        const memory = await adapter.update({
          id: args.id,
          content: args.content?.slice(0, MAX_CONTENT_LENGTH),
          metadata: args.metadata as Record<string, unknown> | undefined,
        })

        return [
          "Memory updated successfully.",
          "",
          `**ID:** ${memory.id}`,
          `**Layer:** ${memory.layer}`,
          `**Updated:** ${memory.updatedAt ?? new Date().toISOString()}`,
        ].join("\n")
      } catch (e) {
        return `Error updating memory: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const memory_delete: ToolDefinition = tool({
    description:
      "Delete a memory by ID. " +
      "Use with caution - deletion is permanent. " +
      "Only delete memories you created or have permission to remove.",
    args: {
      id: tool.schema.string().describe("The memory ID to delete"),
    },
    execute: async (args) => {
      try {
        await adapter.delete(args.id)
        return `Memory ${args.id} deleted successfully.`
      } catch (e) {
        return `Error deleting memory: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const memory_stats: ToolDefinition = tool({
    description:
      "Get statistics about memories across all layers. " +
      "Shows total counts and breakdown by layer.",
    args: {},
    execute: async () => {
      try {
        const stats = await adapter.getStats()

        const lines = [
          "# Memory Statistics",
          "",
          `**Total Memories:** ${stats.totalMemories}`,
          "",
          "## By Layer",
        ]

        for (const [layer, count] of Object.entries(stats.byLayer)) {
          lines.push(`- ${layer}: ${count}`)
        }

        return lines.join("\n")
      } catch (e) {
        return `Error getting memory stats: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return {
    memory_add,
    memory_search,
    memory_get,
    memory_update,
    memory_delete,
    memory_stats,
  }
}
