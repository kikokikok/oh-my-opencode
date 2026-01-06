import type { MemoryAdapter, MemoryLayer } from "../../tools/memory/types"
import type { MemoryRehydrationConfig, RehydrationResult } from "./types"
import {
  HOOK_NAME,
  DEFAULT_REHYDRATE_LAYERS,
  DEFAULT_MEMORY_LIMIT,
  REHYDRATION_PROMPT_HEADER,
} from "./constants"

const rehydratedSessions = new Set<string>()

export interface MemoryRehydrationHook {
  event: (input: {
    event: { type: string; properties?: unknown }
  }) => Promise<void>
  getRehydrationPrompt: (sessionID: string) => Promise<string | null>
  forceRehydrate: (sessionID: string) => Promise<RehydrationResult>
  clearSession: (sessionID: string) => void
}

export function createMemoryRehydrationHook(
  adapter: MemoryAdapter,
  config?: MemoryRehydrationConfig
): MemoryRehydrationHook {
  const enabled = config?.enabled ?? true
  const layers = (config?.layers ?? DEFAULT_REHYDRATE_LAYERS) as MemoryLayer[]
  const limit = config?.limit ?? DEFAULT_MEMORY_LIMIT
  const threshold = config?.threshold

  async function rehydrateMemories(
    sessionID: string
  ): Promise<RehydrationResult> {
    if (!enabled || rehydratedSessions.has(sessionID)) {
      return { count: 0, layers: [], injected: false }
    }

    try {
      const searchResults = await adapter.search({
        query: "relevant context and preferences",
        layer: layers,
        limit,
        threshold,
      })

      if (searchResults.length === 0) {
        rehydratedSessions.add(sessionID)
        return { count: 0, layers, injected: false }
      }

      rehydratedSessions.add(sessionID)
      return {
        count: searchResults.length,
        layers,
        injected: true,
      }
    } catch {
      return { count: 0, layers: [], injected: false }
    }
  }

  async function getRehydrationPrompt(
    sessionID: string
  ): Promise<string | null> {
    if (!enabled) return null

    try {
      const searchResults = await adapter.search({
        query: "relevant context preferences patterns decisions",
        layer: layers,
        limit,
        threshold,
      })

      if (searchResults.length === 0) {
        return null
      }

      const memoriesText = searchResults
        .map((r, i) => {
          const layer = r.memory.layer
          const content = r.memory.content
          const score = (r.score * 100).toFixed(1)
          return `[${i + 1}] (${layer}, relevance: ${score}%) ${content}`
        })
        .join("\n")

      rehydratedSessions.add(sessionID)

      return `${REHYDRATION_PROMPT_HEADER}\n${memoriesText}\n`
    } catch {
      return null
    }
  }

  const event = async (input: {
    event: { type: string; properties?: unknown }
  }) => {
    const { event: evt } = input
    const props = evt.properties as Record<string, unknown> | undefined

    if (evt.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; parentID?: string }
        | undefined
      if (sessionInfo?.id && !sessionInfo?.parentID) {
        await rehydrateMemories(sessionInfo.id)
      }
    }

    if (evt.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        rehydratedSessions.delete(sessionInfo.id)
      }
    }
  }

  return {
    event,
    getRehydrationPrompt,
    forceRehydrate: rehydrateMemories,
    clearSession: (sessionID: string) => {
      rehydratedSessions.delete(sessionID)
    },
  }
}

export { HOOK_NAME }
export type { MemoryRehydrationConfig } from "./types"
