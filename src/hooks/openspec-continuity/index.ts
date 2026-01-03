import type { PluginInput } from "@opencode-ai/plugin"
import { OpenSpecClient } from "../../features/openspec"
import type { OpenSpecChange, TasksDocument } from "../../features/openspec"

interface UserPromptSubmitInput {
  sessionID: string
  prompt: string
}

interface UserPromptSubmitOutput {
  messages?: Array<{
    role: "user" | "assistant"
    content: string
  }>
}

export function createOpenSpecContinuityHook(ctx: PluginInput) {
  const sessionInjected = new Set<string>()

  async function formatActiveChangeContext(
    change: OpenSpecChange,
    tasksDoc: TasksDocument | null
  ): Promise<string> {
    const completedTasks = tasksDoc?.tasks.filter((t) => t.status === "completed").length ?? 0
    const totalTasks = tasksDoc?.tasks.length ?? 0
    const currentTask = tasksDoc?.tasks.find((t) => t.status === "in_progress")
    const pendingTasks = tasksDoc?.tasks.filter((t) => t.status === "pending") ?? []

    let context = `[ACTIVE OPENSPEC: ${change.title}]
Status: ${change.status}
Change Type: ${change.changeType ?? "unspecified"}
Progress: ${completedTasks}/${totalTasks} tasks completed`

    if (currentTask) {
      context += `\nCurrent Task: ${currentTask.content}`
    }

    if (pendingTasks.length > 0 && pendingTasks.length <= 5) {
      context += `\n\nPending Tasks:`
      for (const task of pendingTasks) {
        context += `\n- [${task.priority}] ${task.content}`
      }
    } else if (pendingTasks.length > 5) {
      context += `\n\n${pendingTasks.length} tasks pending. Use \`/openspec status\` for full list.`
    }

    if (change.amendments.length > 0) {
      const lastAmendment = change.amendments[change.amendments.length - 1]
      context += `\n\n⚠️ Spec has ${change.amendments.length} amendment(s). Latest: ${lastAmendment.reason}`
    }

    context += `\n\nYou are continuing work on this specification. Review the spec and pending tasks before proceeding.
Commands: \`/openspec status\` (details), \`/openspec tasks\` (task list), \`/openspec amend\` (record changes)`

    return context
  }

  return {
    UserPromptSubmit: async (
      input: UserPromptSubmitInput
    ): Promise<UserPromptSubmitOutput> => {
      const sessionKey = input.sessionID

      if (sessionInjected.has(sessionKey)) {
        return {}
      }

      try {
        const client = new OpenSpecClient(ctx.directory)
        await client.initialize()

        const activeChange = await client.getActive()
        if (!activeChange) {
          sessionInjected.add(sessionKey)
          return {}
        }

        const tasksDoc = await client.getTasks(activeChange.id)
        const context = await formatActiveChangeContext(activeChange, tasksDoc)

        sessionInjected.add(sessionKey)

        return {
          messages: [
            {
              role: "user",
              content: context,
            },
          ],
        }
      } catch {
        sessionInjected.add(sessionKey)
        return {}
      }
    },
  }
}
