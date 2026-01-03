import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { OpenSpecClient } from "./client"
import { rm, mkdir, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import type { OpenSpecAuthor, OpenSpecStatus } from "./types"

describe("OpenSpecClient", () => {
  let client: OpenSpecClient
  let testDir: string
  const testAuthor: OpenSpecAuthor = {
    id: "test-user",
    name: "Test User",
    type: "user",
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), `openspec-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    client = new OpenSpecClient(testDir)
    await client.initialize()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("createProposal", () => {
    it("creates a new proposal with correct structure", async () => {
      // #given a proposal request
      const options = {
        title: "Add user authentication",
        summary: "Implement OAuth2 login flow",
        content: "# Proposal\n\nAdd OAuth2 authentication",
        author: testAuthor,
        changeType: "new_feature" as const,
        tags: ["auth", "security"],
      }

      // #when creating the proposal
      const change = await client.createProposal(options)

      // #then the change should be created with proposal status
      expect(change.id).toBeDefined()
      expect(change.title).toBe(options.title)
      expect(change.summary).toBe(options.summary)
      expect(change.status).toBe("proposal")
      expect(change.changeType).toBe("new_feature")
      expect(change.tags).toEqual(["auth", "security"])
      expect(change.author).toEqual(testAuthor)
    })

    it("writes proposal.md file", async () => {
      // #given a proposal
      const options = {
        title: "Test Proposal",
        summary: "Test summary",
        content: "# Test Content",
        author: testAuthor,
      }

      // #when creating the proposal
      const change = await client.createProposal(options)

      // #then proposal.md should exist
      const content = await readFile(change.proposalPath, "utf-8")
      expect(content).toBe("# Test Content")
    })

    it("updates manifest with new entry", async () => {
      // #given a proposal
      const options = {
        title: "Test Proposal",
        summary: "Test summary",
        content: "# Content",
        author: testAuthor,
      }

      // #when creating the proposal
      const change = await client.createProposal(options)

      // #then manifest should contain the entry
      const manifest = await client.getManifest()
      expect(manifest.active.length).toBe(1)
      expect(manifest.active[0].id).toBe(change.id)
      expect(manifest.totalCount).toBe(1)
    })
  })

  describe("transition", () => {
    it("transitions from proposal to design", async () => {
      // #given a proposal
      const proposal = await client.createProposal({
        title: "Test Feature",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })

      // #when transitioning to design
      const result = await client.transition("design", {
        changeId: proposal.id,
        content: "# Design Document",
        author: testAuthor,
      })

      // #then transition should succeed
      expect(result.success).toBe(true)
      expect(result.change.status).toBe("design")
    })

    it("rejects invalid transitions", async () => {
      // #given a proposal
      const proposal = await client.createProposal({
        title: "Test Feature",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })

      // #when attempting invalid transition (proposal -> tasks)
      const result = await client.transition("tasks", {
        changeId: proposal.id,
        author: testAuthor,
      })

      // #then transition should fail
      expect(result.success).toBe(false)
      expect(result.message).toContain("Invalid transition")
    })

    it("follows full lifecycle: proposal -> design -> spec -> tasks -> implementing -> verify -> done", async () => {
      // #given a proposal
      const proposal = await client.createProposal({
        title: "Full Lifecycle Test",
        summary: "Test complete workflow",
        content: "# Proposal",
        author: testAuthor,
      })

      const statuses: OpenSpecStatus[] = [
        "design",
        "spec",
        "tasks",
        "implementing",
        "verify",
        "done",
      ]

      // #when transitioning through all states
      let currentChange = proposal
      for (const status of statuses) {
        const result = await client.transition(status, {
          changeId: currentChange.id,
          content: `# ${status} content`,
          author: testAuthor,
        })
        expect(result.success).toBe(true)
        currentChange = result.change
      }

      // #then final status should be done
      expect(currentChange.status).toBe("done")

      // #and change should be archived
      const manifest = await client.getManifest()
      expect(manifest.active.length).toBe(0)
      expect(manifest.archived.length).toBe(1)
    })
  })

  describe("active change", () => {
    it("sets and gets active change", async () => {
      // #given a proposal
      const proposal = await client.createProposal({
        title: "Active Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })

      // #when setting as active
      await client.setActive(proposal.id)

      // #then getActive should return it
      const active = await client.getActive()
      expect(active).not.toBeNull()
      expect(active?.id).toBe(proposal.id)
    })

    it("clears active change", async () => {
      // #given an active change
      const proposal = await client.createProposal({
        title: "Clear Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })
      await client.setActive(proposal.id)

      // #when clearing active
      await client.clearActive()

      // #then getActive should return null
      const active = await client.getActive()
      expect(active).toBeNull()
    })
  })

  describe("tasks", () => {
    it("adds tasks to a change", async () => {
      // #given a change in tasks status
      const proposal = await client.createProposal({
        title: "Tasks Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })
      await client.transition("design", { changeId: proposal.id, author: testAuthor })
      await client.transition("spec", { changeId: proposal.id, author: testAuthor })
      await client.transition("tasks", { changeId: proposal.id, author: testAuthor })

      // #when adding tasks
      const tasks = await client.addTasks(proposal.id, [
        { content: "Implement API", status: "pending", priority: "high" },
        { content: "Write tests", status: "pending", priority: "medium" },
      ])

      // #then tasks should be added
      expect(tasks.tasks.length).toBe(2)
      expect(tasks.tasks[0].id).toBe("task-1")
      expect(tasks.tasks[1].id).toBe("task-2")
    })

    it("updates task status", async () => {
      // #given a change with tasks
      const proposal = await client.createProposal({
        title: "Task Update Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })
      await client.addTasks(proposal.id, [
        { content: "Task 1", status: "pending", priority: "high" },
      ])

      // #when updating task
      const updated = await client.updateTask({
        changeId: proposal.id,
        taskId: "task-1",
        status: "completed",
        notes: "Done!",
      })

      // #then task should be updated
      expect(updated?.status).toBe("completed")
      expect(updated?.notes).toBe("Done!")
      expect(updated?.completedAt).toBeDefined()
    })
  })

  describe("amendments", () => {
    it("creates amendment with impact analysis", async () => {
      // #given a spec-approved change
      const proposal = await client.createProposal({
        title: "Amendment Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })
      await client.transition("design", { changeId: proposal.id, author: testAuthor })
      await client.transition("spec", { changeId: proposal.id, author: testAuthor })
      await client.transition("tasks", { changeId: proposal.id, author: testAuthor })
      await client.addTasks(proposal.id, [
        { content: "Task 1", status: "pending", priority: "high" },
      ])
      await client.transition("implementing", { changeId: proposal.id, author: testAuthor })

      // #when creating amendment
      const amendment = await client.createAmendment({
        changeId: proposal.id,
        reason: "Requirements changed",
        changes: [
          { section: "API Interface", before: "GET /users", after: "GET /v2/users" },
        ],
        author: testAuthor,
        tasksAffected: ["task-1"],
      })

      // #then amendment should be created
      expect(amendment.id).toBe("001")
      expect(amendment.reason).toBe("Requirements changed")
      expect(amendment.impactAnalysis.tasksAffected).toContain("task-1")

      // #and change should have amendment recorded
      const change = await client.getChange(proposal.id)
      expect(change?.amendments.length).toBe(1)
    })

    it("estimates amendment effort correctly", async () => {
      // #given a spec-approved change
      const proposal = await client.createProposal({
        title: "Effort Test",
        summary: "Test",
        content: "# Proposal",
        author: testAuthor,
      })
      await client.transition("design", { changeId: proposal.id, author: testAuthor })
      await client.transition("spec", { changeId: proposal.id, author: testAuthor })
      await client.transition("tasks", { changeId: proposal.id, author: testAuthor })
      await client.transition("implementing", { changeId: proposal.id, author: testAuthor })

      // #when creating amendment with breaking change
      const amendment = await client.createAmendment({
        changeId: proposal.id,
        reason: "Breaking change",
        changes: [
          { section: "Breaking API Changes", before: "v1", after: "v2" },
        ],
        author: testAuthor,
      })

      // #then effort should be high
      expect(amendment.impactAnalysis.estimatedEffort).toBe("high")
      expect(amendment.impactAnalysis.breaking).toBe(true)
    })
  })

  describe("query", () => {
    it("filters by status", async () => {
      // #given multiple changes with different statuses
      const p1 = await client.createProposal({
        title: "Proposal 1",
        summary: "Test",
        content: "# P1",
        author: testAuthor,
      })
      const p2 = await client.createProposal({
        title: "Proposal 2",
        summary: "Test",
        content: "# P2",
        author: testAuthor,
      })
      await client.transition("design", { changeId: p2.id, author: testAuthor })

      // #when querying by status
      const result = await client.query({ status: "design" })

      // #then only design changes returned
      expect(result.items.length).toBe(1)
      expect(result.items[0].id).toBe(p2.id)
    })

    it("searches by title", async () => {
      // #given multiple changes
      await client.createProposal({
        title: "Authentication Feature",
        summary: "Test",
        content: "# Auth",
        author: testAuthor,
      })
      await client.createProposal({
        title: "Payment Feature",
        summary: "Test",
        content: "# Pay",
        author: testAuthor,
      })

      // #when searching
      const result = await client.query({ search: "auth" })

      // #then only matching changes returned
      expect(result.items.length).toBe(1)
      expect(result.items[0].title).toBe("Authentication Feature")
    })
  })

  describe("events", () => {
    it("emits events on change creation", async () => {
      // #given an event listener
      const events: string[] = []
      client.on((event) => {
        events.push(event.type)
      })

      // #when creating a proposal
      await client.createProposal({
        title: "Event Test",
        summary: "Test",
        content: "# Content",
        author: testAuthor,
      })

      // #then change.created event should fire
      expect(events).toContain("change.created")
    })

    it("emits events on transition", async () => {
      // #given a proposal and event listener
      const proposal = await client.createProposal({
        title: "Transition Event Test",
        summary: "Test",
        content: "# Content",
        author: testAuthor,
      })
      const events: string[] = []
      client.on((event) => {
        events.push(event.type)
      })

      // #when transitioning
      await client.transition("design", { changeId: proposal.id, author: testAuthor })

      // #then change.transitioned event should fire
      expect(events).toContain("change.transitioned")
    })

    it("allows unsubscribing from events", async () => {
      // #given an event listener
      const events: string[] = []
      const unsubscribe = client.on((event) => {
        events.push(event.type)
      })

      // #when unsubscribing
      unsubscribe()

      // #and creating a proposal
      await client.createProposal({
        title: "Unsubscribe Test",
        summary: "Test",
        content: "# Content",
        author: testAuthor,
      })

      // #then no events should fire
      expect(events.length).toBe(0)
    })
  })

  describe("session logs", () => {
    it("adds session log to change", async () => {
      // #given a change
      const proposal = await client.createProposal({
        title: "Session Log Test",
        summary: "Test",
        content: "# Content",
        author: testAuthor,
      })

      // #when adding session log
      await client.addSessionLog(proposal.id, {
        sessionId: "session-123",
        startedAt: new Date().toISOString(),
        tasksCompleted: [],
        tasksStarted: [],
        notes: "Initial exploration",
      })

      // #then change should have session log
      const change = await client.getChange(proposal.id)
      expect(change?.sessions.length).toBe(1)
      expect(change?.sessions[0].sessionId).toBe("session-123")
    })
  })
})
