import { describe, test, expect, beforeEach } from "bun:test"
import { createKnowledgeMonitorHook } from "./index"
import type { KnowledgeCommit, Constraint } from "../../features/knowledge-repo/types"

function createTestCommit(overrides: Partial<KnowledgeCommit> = {}): KnowledgeCommit {
  return {
    id: "test-commit-1",
    type: "policy",
    title: "Test Policy",
    summary: "A test policy for unit tests",
    content: "Test content",
    layer: "project",
    severity: "warn",
    constraints: [],
    author: { id: "test", name: "Test Author" },
    createdAt: new Date().toISOString(),
    tags: [],
    triggerKeywords: [],
    ...overrides,
  }
}

function createTestConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    id: "constraint-1",
    operator: "must_not_use",
    target: "code",
    pattern: "console\\.log",
    severity: "warn",
    ...overrides,
  }
}

describe("createKnowledgeMonitorHook", () => {
  describe("initialization", () => {
    test("creates hook with required methods", () => {
      // #given / #when
      const hook = createKnowledgeMonitorHook("/tmp/test-project")

      // #then
      expect(hook.setActiveKnowledge).toBeDefined()
      expect(hook.getActiveKnowledge).toBeDefined()
      expect(hook.hooks).toBeDefined()
      expect(hook.hooks["tool.execute.before"]).toBeDefined()
      expect(hook.hooks["tool.execute.after"]).toBeDefined()
    })

    test("initializes with empty knowledge", () => {
      // #given / #when
      const hook = createKnowledgeMonitorHook("/tmp/test-project")

      // #then
      expect(hook.getActiveKnowledge()).toEqual([])
    })
  })

  describe("setActiveKnowledge / getActiveKnowledge", () => {
    test("stores and retrieves knowledge", () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project")
      const commits = [createTestCommit({ id: "k1" }), createTestCommit({ id: "k2" })]

      // #when
      hook.setActiveKnowledge(commits)

      // #then
      expect(hook.getActiveKnowledge()).toEqual(commits)
    })

    test("replaces existing knowledge on subsequent calls", () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project")
      const commits1 = [createTestCommit({ id: "old" })]
      const commits2 = [createTestCommit({ id: "new" })]

      // #when
      hook.setActiveKnowledge(commits1)
      hook.setActiveKnowledge(commits2)

      // #then
      expect(hook.getActiveKnowledge()).toEqual(commits2)
    })
  })

  describe("tool.execute.before", () => {
    test("ignores non-monitored tools", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project")
      const constraint = createTestConstraint({ severity: "block" })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then - should not throw for unmonitored tools
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "grep", sessionID: "s1", callID: "c1" },
          { args: { pattern: "console.log" } }
        )
      ).resolves.toBeUndefined()
    })

    test("processes edit tool with checkPreTool enabled", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPreTool: true })
      const constraint = createTestConstraint({
        pattern: "FORBIDDEN",
        severity: "block",
        message: "FORBIDDEN pattern not allowed",
      })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then - should throw for blocking violation
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "edit", sessionID: "s1", callID: "c1" },
          {
            args: {
              filePath: "/tmp/test-project/src/file.ts",
              oldString: "old code",
              newString: "FORBIDDEN pattern here",
            },
          }
        )
      ).rejects.toThrow()
    })

    test("allows edit when no violations", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPreTool: true })
      const constraint = createTestConstraint({ pattern: "FORBIDDEN", severity: "block" })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then - should not throw for clean edit
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "edit", sessionID: "s1", callID: "c1" },
          {
            args: {
              filePath: "/tmp/test-project/src/file.ts",
              oldString: "old code",
              newString: "new clean code",
            },
          }
        )
      ).resolves.toBeUndefined()
    })

    test("skips check when disabled", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { enabled: false })
      const constraint = createTestConstraint({ pattern: "FORBIDDEN", severity: "block" })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then - should not throw when disabled
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "edit", sessionID: "s1", callID: "c1" },
          {
            args: {
              filePath: "/tmp/test-project/src/file.ts",
              oldString: "old",
              newString: "FORBIDDEN",
            },
          }
        )
      ).resolves.toBeUndefined()
    })
  })

  describe("tool.execute.after", () => {
    test("appends warning message for non-blocking violations", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", {
        checkPreTool: false,
        checkPostTool: true,
      })
      const constraint = createTestConstraint({
        pattern: "WARN_PATTERN",
        severity: "warn",
        message: "Warning: WARN_PATTERN detected",
      })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // First trigger before to register pending call
      await hook.hooks["tool.execute.before"](
        { tool: "edit", sessionID: "s1", callID: "c1" },
        {
          args: {
            filePath: "/tmp/test-project/src/file.ts",
            oldString: "old",
            newString: "WARN_PATTERN here",
          },
        }
      )

      // #when
      const output = { title: "Edit", output: "File edited successfully", metadata: {} }
      await hook.hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1" },
        output
      )

      // #then - output should have warning appended
      expect(output.output).toContain("KNOWLEDGE POLICY VIOLATION DETECTED")
    })

    test("ignores failed tool executions", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", {
        checkPreTool: false,
        checkPostTool: true,
      })
      const constraint = createTestConstraint({ pattern: "PATTERN", severity: "warn" })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // Register pending call
      await hook.hooks["tool.execute.before"](
        { tool: "edit", sessionID: "s1", callID: "c2" },
        {
          args: {
            filePath: "/tmp/test-project/src/file.ts",
            oldString: "old",
            newString: "PATTERN",
          },
        }
      )

      // #when - simulate tool failure
      const output = { title: "Edit", output: "Error: File not found", metadata: {} }
      await hook.hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2" },
        output
      )

      // #then - should not append violation message to failed output
      expect(output.output).toBe("Error: File not found")
    })

    test("handles missing pending call gracefully", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPostTool: true })

      // #when / #then - should not throw for unknown callID
      const output = { title: "Edit", output: "Success", metadata: {} }
      await expect(
        hook.hooks["tool.execute.after"](
          { tool: "edit", sessionID: "s1", callID: "unknown" },
          output
        )
      ).resolves.toBeUndefined()
    })
  })

  describe("bash command monitoring", () => {
    test("blocks dangerous bash commands", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPreTool: true })
      const constraint = createTestConstraint({
        pattern: "rm -rf",
        severity: "block",
        message: "Dangerous rm -rf command blocked",
      })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "bash", sessionID: "s1", callID: "c3" },
          { args: { command: "rm -rf /important" } }
        )
      ).rejects.toThrow()
    })

    test("allows safe bash commands", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPreTool: true })
      const constraint = createTestConstraint({
        pattern: "rm -rf",
        severity: "block",
      })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "bash", sessionID: "s1", callID: "c4" },
          { args: { command: "ls -la" } }
        )
      ).resolves.toBeUndefined()
    })
  })

  describe("write tool monitoring", () => {
    test("checks content in write operations", async () => {
      // #given
      const hook = createKnowledgeMonitorHook("/tmp/test-project", { checkPreTool: true })
      const constraint = createTestConstraint({
        pattern: "API_KEY",
        severity: "block",
        message: "Do not hardcode API keys",
      })
      hook.setActiveKnowledge([createTestCommit({ constraints: [constraint] })])

      // #when / #then
      await expect(
        hook.hooks["tool.execute.before"](
          { tool: "write", sessionID: "s1", callID: "c5" },
          {
            args: {
              filePath: "/tmp/test-project/config.ts",
              content: 'const API_KEY = "secret123"',
            },
          }
        )
      ).rejects.toThrow()
    })
  })
})
