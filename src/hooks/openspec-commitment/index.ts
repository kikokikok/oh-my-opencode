import type { PluginInput } from "@opencode-ai/plugin"
import { OpenSpecClient, type EnforcementLevel, type ChangeType } from "../../features/openspec"

interface OpenSpecCommitmentConfig {
  enforcement: EnforcementLevel
  requireSpecFor: ChangeType[]
}

interface ToolExecuteInput {
  tool: string
  sessionID: string
}

interface ToolExecuteBeforeOutput {
  args?: unknown
  blocked?: boolean
  message?: string
}

interface UserPromptSubmitInput {
  sessionID: string
  prompt: string
}

interface UserPromptSubmitOutput {
  blocked?: boolean
  message?: string
  messages?: Array<{
    role: "user" | "assistant"
    content: string
  }>
}

const IMPLEMENTATION_TOOLS = ["Write", "Edit", "Bash"]
const IMPLEMENTATION_PATTERNS = [
  /\b(implement|create|build|add|develop|code|write)\b.*\b(feature|function|component|api|endpoint|service)\b/i,
  /\b(new|add)\b.*\b(file|class|module|function)\b/i,
]

const SOFT_REMINDER_MESSAGE = `[OPENSPEC REMINDER]
You're implementing changes without an active specification.
Consider using \`/openspec propose\` to document this change.

This helps with:
- Multi-session continuity
- Team alignment  
- Amendment tracking

Proceed with your work. This reminder won't appear again this session.`

const HARD_BLOCK_MESSAGE = `[OPENSPEC REQUIRED]
This project requires specifications for new features.

To proceed:
1. Run \`/openspec propose "Your feature title"\`
2. Complete the proposal → design → spec workflow
3. Break down into tasks
4. Then implement

Bypass with: Include "bypass openspec" in your message.`

export function createOpenSpecCommitmentHook(
  ctx: PluginInput,
  config: OpenSpecCommitmentConfig
) {
  const reminderShown = new Set<string>()
  const bypassedSessions = new Set<string>()

  function detectsImplementationIntent(prompt: string): boolean {
    return IMPLEMENTATION_PATTERNS.some((pattern) => pattern.test(prompt))
  }

  function shouldEnforce(sessionID: string): boolean {
    if (config.enforcement === "off") return false
    if (bypassedSessions.has(sessionID)) return false
    return true
  }

  return {
    PreToolUse: async (input: ToolExecuteInput): Promise<ToolExecuteBeforeOutput> => {
      if (config.enforcement !== "hard") return {}
      if (!IMPLEMENTATION_TOOLS.includes(input.tool)) return {}
      if (bypassedSessions.has(input.sessionID)) return {}

      try {
        const client = new OpenSpecClient(ctx.directory)
        await client.initialize()
        const active = await client.getActive()

        if (!active) {
          return {
            blocked: true,
            message: HARD_BLOCK_MESSAGE,
          }
        }

        if (!["tasks", "implementing"].includes(active.status)) {
          return {
            blocked: true,
            message: `[OPENSPEC: Spec not ready]
Active spec "${active.title}" is in "${active.status}" status.
Complete the spec workflow before implementing.

Current: ${active.status}
Required: tasks or implementing

Use \`/openspec status\` for details.`,
          }
        }
      } catch {
        // Don't block if there's an error checking
      }

      return {}
    },

    UserPromptSubmit: async (
      input: UserPromptSubmitInput
    ): Promise<UserPromptSubmitOutput> => {
      if (!shouldEnforce(input.sessionID)) return {}

      if (input.prompt.toLowerCase().includes("bypass openspec")) {
        bypassedSessions.add(input.sessionID)
        return {
          messages: [
            {
              role: "user",
              content: "[OpenSpec bypass acknowledged for this session]",
            },
          ],
        }
      }

      if (!detectsImplementationIntent(input.prompt)) return {}

      try {
        const client = new OpenSpecClient(ctx.directory)
        await client.initialize()
        const active = await client.getActive()

        if (active) return {}

        if (config.enforcement === "soft") {
          if (reminderShown.has(input.sessionID)) return {}
          reminderShown.add(input.sessionID)

          return {
            messages: [
              {
                role: "user",
                content: SOFT_REMINDER_MESSAGE,
              },
            ],
          }
        }

        if (config.enforcement === "hard") {
          return {
            blocked: true,
            message: HARD_BLOCK_MESSAGE,
          }
        }
      } catch {
        // Don't block on errors
      }

      return {}
    },
  }
}
