export const TOOL_PREFIX = "memory"

export const MEMORY_LAYERS = [
  "user",
  "session", 
  "project",
  "team",
  "org",
  "company",
  "agent",
] as const

export const DEFAULT_SEARCH_LIMIT = 10
export const DEFAULT_SEARCH_THRESHOLD = 0.5
export const MAX_CONTENT_LENGTH = 10000
