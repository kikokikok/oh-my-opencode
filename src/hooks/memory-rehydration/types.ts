import type { MemoryLayer } from "../../features/mem0-memory/types"

export interface MemoryRehydrationConfig {
  enabled?: boolean
  layers?: MemoryLayer[]
  limit?: number
  threshold?: number
}

export interface RehydrationResult {
  count: number
  layers: MemoryLayer[]
  injected: boolean
}
