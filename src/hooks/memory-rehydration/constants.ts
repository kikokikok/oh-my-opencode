export const HOOK_NAME = "memory-rehydration"

export const DEFAULT_REHYDRATE_LAYERS = ["user", "project", "team"] as const

export const DEFAULT_MEMORY_LIMIT = 20

export const REHYDRATION_PROMPT_HEADER = `[MEMORY REHYDRATION - Relevant memories from previous sessions]

The following memories have been retrieved from persistent storage. These represent learned patterns, preferences, and context from past interactions.
`
