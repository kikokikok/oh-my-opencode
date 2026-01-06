import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { KnowledgeProviderRegistry } from "../../features/knowledge-provider"
import type { KnowledgeItemType } from "../../features/knowledge-provider/types"
import { DEFAULT_QUERY_LIMIT } from "./constants"

export function createKnowledgeProviderTools(
  registry: KnowledgeProviderRegistry
): Record<string, ToolDefinition> {
  const knowledge_query: ToolDefinition = tool({
    description:
      "Search and query the knowledge repository. " +
      "Find ADRs, policies, patterns, and specs by keywords, type, layer, or full-text search. " +
      "Returns summaries to conserve context - use knowledge_show for full details.",
    args: {
      query: tool.schema
        .string()
        .optional()
        .describe("Full-text search query across knowledge summaries"),
      type: tool.schema
        .enum(["adr", "policy", "pattern", "spec"])
        .optional()
        .describe("Filter by knowledge type"),
      layer: tool.schema
        .enum(["company", "org", "project"])
        .optional()
        .describe("Filter by organizational layer"),
      severity: tool.schema
        .enum(["info", "warn", "block"])
        .optional()
        .describe("Filter by severity level"),
      tags: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Filter by tags"),
      limit: tool.schema
        .number()
        .optional()
        .describe(`Maximum results to return (default: ${DEFAULT_QUERY_LIMIT})`),
    },
    execute: async (args) => {
      try {
        const types: KnowledgeItemType[] | undefined = args.type
          ? [args.type as KnowledgeItemType]
          : undefined

        const results = await registry.search({
          text: args.query ?? "",
          types,
          layers: args.layer ? [args.layer] : undefined,
          limit: args.limit ?? DEFAULT_QUERY_LIMIT,
          includeContent: false,
        })

        if (results.length === 0) {
          return "No knowledge items found matching the query."
        }

        const lines = [`Found ${results.length} knowledge items:`, ""]

        for (const { item, score } of results) {
          const severity = item.metadata.severity ?? "info"
          lines.push(
            `**${item.id}** [${item.type}/${item.layer ?? "unknown"}] ${severity.toUpperCase()} (score: ${score.toFixed(2)})`
          )
          lines.push(`  ${item.title}`)
          lines.push(`  ${item.summary}`)
          if (item.metadata.tags && item.metadata.tags.length > 0) {
            lines.push(`  Tags: ${item.metadata.tags.join(", ")}`)
          }
          lines.push(`  Provider: ${item.provider}`)
          lines.push("")
        }

        return lines.join("\n")
      } catch (e) {
        return `Error querying knowledge: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const knowledge_list: ToolDefinition = tool({
    description:
      "List all knowledge items in the repository with statistics. " +
      "Provides an overview of ADRs, policies, patterns, and specs organized by layer and type.",
    args: {
      layer: tool.schema
        .enum(["company", "org", "project"])
        .optional()
        .describe("Filter to specific layer"),
      type: tool.schema
        .enum(["adr", "policy", "pattern", "spec"])
        .optional()
        .describe("Filter to specific type"),
      verbose: tool.schema
        .boolean()
        .optional()
        .describe("Include item summaries (default: false)"),
    },
    execute: async (args) => {
      try {
        const health = await registry.healthCheck()
        const providers = registry.getProviders()

        const types: KnowledgeItemType[] | undefined = args.type
          ? [args.type as KnowledgeItemType]
          : undefined

        const results = await registry.search({
          text: "",
          types,
          layers: args.layer ? [args.layer] : undefined,
          limit: 200,
          includeContent: false,
        })

        const lines = [
          "# Knowledge Provider Statistics",
          "",
          `Total providers: ${providers.length}`,
          "",
          "## Providers",
        ]

        for (const provider of providers) {
          const status = health.get(provider.name)
          const statusStr = status?.status ?? "unknown"
          lines.push(`- ${provider.name} (${provider.type}): ${statusStr}`)
        }

        lines.push("")
        lines.push("## Items Found")
        lines.push(`Total: ${results.length}`)
        lines.push("")

        const byType: Record<string, number> = {}
        const byLayer: Record<string, number> = {}
        const byProvider: Record<string, number> = {}

        for (const { item } of results) {
          byType[item.type] = (byType[item.type] ?? 0) + 1
          byLayer[item.layer ?? "unknown"] = (byLayer[item.layer ?? "unknown"] ?? 0) + 1
          byProvider[item.provider] = (byProvider[item.provider] ?? 0) + 1
        }

        lines.push("### By Type")
        for (const [type, count] of Object.entries(byType)) {
          lines.push(`- ${type}: ${count}`)
        }

        lines.push("")
        lines.push("### By Layer")
        for (const [layer, count] of Object.entries(byLayer)) {
          lines.push(`- ${layer}: ${count}`)
        }

        lines.push("")
        lines.push("### By Provider")
        for (const [provider, count] of Object.entries(byProvider)) {
          lines.push(`- ${provider}: ${count}`)
        }

        if (args.verbose && results.length > 0) {
          lines.push("")
          lines.push("## Items")
          for (const { item } of results) {
            lines.push(
              `- **${item.id}** [${item.type}/${item.layer ?? "unknown"}] ${item.title}`
            )
          }
        }

        return lines.join("\n")
      } catch (e) {
        return `Error listing knowledge: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const knowledge_show: ToolDefinition = tool({
    description:
      "Show full details of a specific knowledge item by ID. " +
      "Includes complete content, constraints, metadata, and optionally version history.",
    args: {
      id: tool.schema.string().describe("The knowledge item ID to retrieve"),
      includeConstraints: tool.schema
        .boolean()
        .optional()
        .describe("Include constraint details (default: true)"),
      includeHistory: tool.schema
        .boolean()
        .optional()
        .describe("Include version history (default: false)"),
    },
    execute: async (args) => {
      try {
        const item = await registry.getById(args.id)
        if (!item) {
          return `Knowledge item not found: ${args.id}`
        }

        const includeConstraints = args.includeConstraints ?? true

        const lines = [
          `# ${item.title}`,
          "",
          `**ID:** ${item.id}`,
          `**Type:** ${item.type}`,
          `**Layer:** ${item.layer ?? "unknown"}`,
          `**Provider:** ${item.provider}`,
        ]

        if (item.metadata.severity) {
          lines.push(`**Severity:** ${item.metadata.severity}`)
        }

        if (item.createdAt) {
          lines.push(`**Created:** ${item.createdAt}`)
        }

        lines.push("")

        if (item.metadata.tags && item.metadata.tags.length > 0) {
          lines.push(`**Tags:** ${item.metadata.tags.join(", ")}`)
          lines.push("")
        }

        lines.push("## Summary")
        lines.push("")
        lines.push(item.summary)
        lines.push("")

        if (item.content) {
          lines.push("## Content")
          lines.push("")
          lines.push(item.content)
          lines.push("")
        }

        if (
          includeConstraints &&
          item.metadata.extra?.constraints &&
          Array.isArray(item.metadata.extra.constraints)
        ) {
          const constraints = item.metadata.extra.constraints as Array<{
            id?: string
            operator?: string
            target?: string
            pattern?: string
            severity?: string
            message?: string
            appliesTo?: string[]
            excludes?: string[]
          }>

          if (constraints.length > 0) {
            lines.push("## Constraints")
            lines.push("")
            for (const c of constraints) {
              lines.push(`### ${c.id ?? "constraint"}`)
              if (c.operator) lines.push(`- **Operator:** ${c.operator}`)
              if (c.target) lines.push(`- **Target:** ${c.target}`)
              if (c.pattern) lines.push(`- **Pattern:** \`${c.pattern}\``)
              if (c.severity) lines.push(`- **Severity:** ${c.severity}`)
              if (c.message) lines.push(`- **Message:** ${c.message}`)
              if (c.appliesTo?.length)
                lines.push(`- **Applies To:** ${c.appliesTo.join(", ")}`)
              if (c.excludes?.length)
                lines.push(`- **Excludes:** ${c.excludes.join(", ")}`)
              lines.push("")
            }
          }
        }

        return lines.join("\n")
      } catch (e) {
        return `Error showing knowledge: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return {
    knowledge_query,
    knowledge_list,
    knowledge_show,
  }
}
