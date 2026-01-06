import type { MemoryLayer } from "../../features/mem0-memory/types"

export interface Memory {
  id: string
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt?: string
}

export interface MemorySearchResult {
  memory: Memory
  score: number
}

export interface AddMemoryInput {
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
}

export interface SearchMemoryInput {
  query: string
  layer?: MemoryLayer | MemoryLayer[]
  limit?: number
  threshold?: number
}

export interface UpdateMemoryInput {
  id: string
  content?: string
  metadata?: Record<string, unknown>
}

export interface MemoryStats {
  totalMemories: number
  byLayer: Record<MemoryLayer, number>
}

export interface MemoryAdapter {
  add(input: AddMemoryInput): Promise<Memory>
  search(input: SearchMemoryInput): Promise<MemorySearchResult[]>
  get(id: string): Promise<Memory | null>
  update(input: UpdateMemoryInput): Promise<Memory>
  delete(id: string): Promise<void>
  getAll(layer?: MemoryLayer): Promise<Memory[]>
  getStats(): Promise<MemoryStats>
  isAvailable?(): Promise<boolean>
}

export type { MemoryLayer }
