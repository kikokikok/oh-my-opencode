export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"
export type MemoryProvider = "no" | "mem0-cloud" | "mem0-local" | "letta"

export interface InstallArgs {
  tui: boolean
  claude?: ClaudeSubscription
  chatgpt?: BooleanArg
  gemini?: BooleanArg
  memory?: MemoryProvider
  memoryEndpoint?: string
  skipAuth?: boolean
}

export interface InstallConfig {
  hasClaude: boolean
  isMax20: boolean
  hasChatGPT: boolean
  hasGemini: boolean
  memoryProvider: MemoryProvider
  memoryEndpoint?: string
}

export interface ConfigMergeResult {
  success: boolean
  configPath: string
  error?: string
}

export interface DetectedConfig {
  isInstalled: boolean
  hasClaude: boolean
  isMax20: boolean
  hasChatGPT: boolean
  hasGemini: boolean
  memoryProvider: MemoryProvider
  memoryEndpoint?: string
}
