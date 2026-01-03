import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, readFile, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import { KnowledgeRepository } from "./client"
import { KnowledgeCache } from "./cache"
import { KnowledgeSyncManager, CACHE_DIR, CENTRAL_CACHE_DIR } from "./sync"
import {
  ConflictDetector,
  groupViolationsBySeverity,
  hasBlockingViolations,
} from "./conflict-detector"
import type {
  KnowledgeAuthor,
  KnowledgeCommit,
  Constraint,
  ConstraintViolation,
  KnowledgeManifest,
  CentralHubConfig,
} from "./types"

const createTestDir = () => join(tmpdir(), `knowledge-repo-test-${randomUUID()}`)

const testAuthor: KnowledgeAuthor = {
  id: "test-author",
  name: "Test Author",
  email: "test@example.com",
}

describe("KnowledgeRepository", () => {
  let testDir: string
  let repo: KnowledgeRepository

  beforeEach(async () => {
    testDir = createTestDir()
    repo = new KnowledgeRepository({ rootDir: testDir })
    await repo.initialize()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("createCommit", () => {
    test("creates commit with generated ID", async () => {
      const commit = await repo.createCommit({
        type: "policy",
        title: "No jQuery",
        content: "Do not use jQuery in new code",
        layer: "project",
        severity: "block",
        author: testAuthor,
      })

      expect(commit.id).toBeDefined()
      expect(commit.id.length).toBe(12)
      expect(commit.type).toBe("policy")
      expect(commit.title).toBe("No jQuery")
      expect(commit.layer).toBe("project")
      expect(commit.severity).toBe("block")
    })

    test("stores commit to disk", async () => {
      const commit = await repo.createCommit({
        type: "adr",
        title: "Use TypeScript",
        content: "All new code must be TypeScript",
        layer: "org",
        severity: "warn",
        author: testAuthor,
      })

      const filePath = join(testDir, "commits", "org", `${commit.id}.json`)
      const data = await readFile(filePath, "utf-8")
      const stored = JSON.parse(data) as KnowledgeCommit

      expect(stored.id).toBe(commit.id)
      expect(stored.title).toBe("Use TypeScript")
    })

    test("generates summary from title", async () => {
      const commit = await repo.createCommit({
        type: "pattern",
        title: "Repository Pattern",
        content: "Long content here...",
        layer: "company",
        severity: "info",
        author: testAuthor,
      })

      expect(commit.summary).toBe("Repository Pattern")
    })

    test("truncates long summaries", async () => {
      const longTitle = "A".repeat(150)
      const commit = await repo.createCommit({
        type: "spec",
        title: longTitle,
        content: "Content",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      expect(commit.summary.length).toBeLessThanOrEqual(100)
    })
  })

  describe("getCommit", () => {
    test("retrieves existing commit", async () => {
      const created = await repo.createCommit({
        type: "policy",
        title: "Test Policy",
        content: "Policy content",
        layer: "project",
        severity: "warn",
        author: testAuthor,
      })

      const retrieved = await repo.getCommit("project", created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.title).toBe("Test Policy")
    })

    test("returns null for non-existent commit", async () => {
      const result = await repo.getCommit("project", "non-existent-id")
      expect(result).toBeNull()
    })
  })

  describe("query", () => {
    beforeEach(async () => {
      await repo.createCommit({
        type: "policy",
        title: "Policy A",
        content: "Content A",
        layer: "project",
        severity: "block",
        author: testAuthor,
        triggerKeywords: ["security", "auth"],
      })

      await repo.createCommit({
        type: "adr",
        title: "ADR B",
        content: "Content B",
        layer: "org",
        severity: "warn",
        author: testAuthor,
        triggerKeywords: ["architecture"],
      })

      await repo.createCommit({
        type: "pattern",
        title: "Pattern C",
        content: "Content C",
        layer: "company",
        severity: "info",
        author: testAuthor,
        triggerKeywords: ["design"],
      })
    })

    test("filters by type", async () => {
      const result = await repo.query({ type: "policy" })

      expect(result.items.length).toBe(1)
      expect(result.items[0].type).toBe("policy")
    })

    test("filters by layer", async () => {
      const result = await repo.query({ layer: "org" })

      expect(result.items.length).toBe(1)
      expect(result.items[0].layer).toBe("org")
    })

    test("filters by severity", async () => {
      const result = await repo.query({ severity: "block" })

      expect(result.items.length).toBe(1)
      expect(result.items[0].severity).toBe("block")
    })

    test("filters by keywords", async () => {
      const result = await repo.query({ keywords: ["security"] })

      expect(result.items.length).toBe(1)
      expect(result.items[0].title).toBe("Policy A")
    })

    test("supports pagination", async () => {
      const result = await repo.query({ limit: 2, offset: 0 })

      expect(result.items.length).toBe(2)
      expect(result.hasMore).toBe(true)
    })
  })

  describe("promote", () => {
    test("promotes knowledge to higher layer", async () => {
      const original = await repo.createCommit({
        type: "policy",
        title: "Good Policy",
        content: "This policy proved valuable",
        layer: "project",
        severity: "warn",
        author: testAuthor,
      })

      const record = await repo.promote({
        knowledgeId: original.id,
        targetLayer: "org",
        justification: "Proved valuable across projects",
        promoter: testAuthor,
      })

      expect(record.fromLayer).toBe("project")
      expect(record.toLayer).toBe("org")
      expect(record.knowledgeId).toBe(original.id)

      const promoted = await repo.getCommit("org", record.newKnowledgeId)
      expect(promoted).not.toBeNull()
      expect(promoted?.parentId).toBe(original.id)
    })

    test("rejects demotion", async () => {
      const original = await repo.createCommit({
        type: "policy",
        title: "Company Policy",
        content: "Content",
        layer: "company",
        severity: "info",
        author: testAuthor,
      })

      await expect(
        repo.promote({
          knowledgeId: original.id,
          targetLayer: "project",
          justification: "Trying to demote",
          promoter: testAuthor,
        })
      ).rejects.toThrow()
    })
  })

  describe("getHistory", () => {
    test("returns commit history chain", async () => {
      const v1 = await repo.createCommit({
        type: "adr",
        title: "ADR v1",
        content: "Initial version",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      const v2 = await repo.createCommit({
        type: "adr",
        title: "ADR v2",
        content: "Updated version",
        layer: "project",
        severity: "info",
        author: testAuthor,
        parentId: v1.id,
      })

      const history = await repo.getHistory(v2.id)

      expect(history.length).toBe(2)
      expect(history[0].id).toBe(v2.id)
      expect(history[1].id).toBe(v1.id)
    })
  })

  describe("getMergedKnowledge", () => {
    test("merges knowledge from all applicable layers", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Company Policy",
        content: "Company level",
        layer: "company",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Org Policy",
        content: "Org level",
        layer: "org",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Project Policy",
        content: "Project level",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      const merged = await repo.getMergedKnowledge("project")

      expect(merged.length).toBe(3)
    })
  })
})

describe("KnowledgeCache", () => {
  let testDir: string
  let cache: KnowledgeCache

  beforeEach(async () => {
    testDir = createTestDir()
    cache = new KnowledgeCache({ diskCacheDir: testDir })
    await cache.initialize()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("caches and retrieves commits", async () => {
    const commit: KnowledgeCommit = {
      id: "test-commit",
      type: "policy",
      title: "Test",
      summary: "Test summary",
      content: "Content",
      layer: "project",
      severity: "info",
      constraints: [],
      author: testAuthor,
      createdAt: new Date().toISOString(),
      tags: [],
      triggerKeywords: [],
    }

    await cache.setCommit(commit)
    const retrieved = await cache.getCommit("test-commit")

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe("test-commit")
  })

  test("returns null for non-existent cache entry", async () => {
    const result = await cache.getCommit("non-existent")
    expect(result).toBeNull()
  })

  test("invalidates cache entries", async () => {
    const commit: KnowledgeCommit = {
      id: "to-invalidate",
      type: "policy",
      title: "Test",
      summary: "Test",
      content: "Content",
      layer: "project",
      severity: "info",
      constraints: [],
      author: testAuthor,
      createdAt: new Date().toISOString(),
      tags: [],
      triggerKeywords: [],
    }

    await cache.setCommit(commit)
    await cache.invalidateCommit("to-invalidate")
    const result = await cache.getCommit("to-invalidate")

    expect(result).toBeNull()
  })

  test("clears all cache entries", async () => {
    const commit: KnowledgeCommit = {
      id: "to-clear",
      type: "policy",
      title: "Test",
      summary: "Test",
      content: "Content",
      layer: "project",
      severity: "info",
      constraints: [],
      author: testAuthor,
      createdAt: new Date().toISOString(),
      tags: [],
      triggerKeywords: [],
    }

    await cache.setCommit(commit)
    await cache.clear()
    const result = await cache.getCommit("to-clear")

    expect(result).toBeNull()
  })
})

describe("ConflictDetector", () => {
  let testDir: string
  let detector: ConflictDetector

  beforeEach(async () => {
    testDir = createTestDir()
    await mkdir(testDir, { recursive: true })
    detector = new ConflictDetector()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("checkFile", () => {
    test("detects must_not_use violation", async () => {
      const filePath = join(testDir, "test.ts")
      await Bun.write(filePath, 'import $ from "jquery"')

      const commits: KnowledgeCommit[] = [
        {
          id: "no-jquery",
          type: "policy",
          title: "No jQuery",
          summary: "No jQuery",
          content: "Content",
          layer: "project",
          severity: "block",
          constraints: [
            {
              id: "c1",
              operator: "must_not_use",
              target: "import",
              pattern: "jquery",
              severity: "block",
            },
          ],
          author: testAuthor,
          createdAt: new Date().toISOString(),
          tags: [],
          triggerKeywords: [],
        },
      ]

      const violations = await detector.checkFile(commits, filePath, {
        projectRoot: testDir,
      })

      expect(violations.length).toBe(1)
      expect(violations[0].severity).toBe("block")
    })

    test("detects must_exist violation", async () => {
      const commits: KnowledgeCommit[] = [
        {
          id: "require-readme",
          type: "policy",
          title: "Require README",
          summary: "README required",
          content: "Content",
          layer: "project",
          severity: "warn",
          constraints: [
            {
              id: "c1",
              operator: "must_exist",
              target: "file",
              pattern: "README.md",
              severity: "warn",
            },
          ],
          author: testAuthor,
          createdAt: new Date().toISOString(),
          tags: [],
          triggerKeywords: [],
        },
      ]

      const violations = await detector.checkFile(commits, testDir, {
        projectRoot: testDir,
      })

      expect(violations.length).toBe(1)
      expect(violations[0].remediation).toContain("Create required")
    })

    test("respects appliesTo filter", async () => {
      const filePath = join(testDir, "test.js")
      await Bun.write(filePath, 'var x = 1')

      const commits: KnowledgeCommit[] = [
        {
          id: "no-var",
          type: "policy",
          title: "No var",
          summary: "Use const/let",
          content: "Content",
          layer: "project",
          severity: "warn",
          constraints: [
            {
              id: "c1",
              operator: "must_not_use",
              target: "code",
              pattern: "\\bvar\\b",
              severity: "warn",
              appliesTo: ["*.ts"],
            },
          ],
          author: testAuthor,
          createdAt: new Date().toISOString(),
          tags: [],
          triggerKeywords: [],
        },
      ]

      const violations = await detector.checkFile(commits, filePath, {
        projectRoot: testDir,
      })

      expect(violations.length).toBe(0)
    })
  })
})

describe("utility functions", () => {
  test("groupViolationsBySeverity groups correctly", () => {
    const violations: ConstraintViolation[] = [
      { constraintId: "1", knowledgeId: "k1", severity: "block", message: "Block 1" },
      { constraintId: "2", knowledgeId: "k2", severity: "warn", message: "Warn 1" },
      { constraintId: "3", knowledgeId: "k3", severity: "info", message: "Info 1" },
      { constraintId: "4", knowledgeId: "k4", severity: "block", message: "Block 2" },
    ]

    const grouped = groupViolationsBySeverity(violations)

    expect(grouped.block.length).toBe(2)
    expect(grouped.warn.length).toBe(1)
    expect(grouped.info.length).toBe(1)
  })

  test("hasBlockingViolations returns true when blocking exists", () => {
    const violations: ConstraintViolation[] = [
      { constraintId: "1", knowledgeId: "k1", severity: "warn", message: "Warn" },
      { constraintId: "2", knowledgeId: "k2", severity: "block", message: "Block" },
    ]

    expect(hasBlockingViolations(violations)).toBe(true)
  })

  test("hasBlockingViolations returns false when no blocking", () => {
    const violations: ConstraintViolation[] = [
      { constraintId: "1", knowledgeId: "k1", severity: "warn", message: "Warn" },
      { constraintId: "2", knowledgeId: "k2", severity: "info", message: "Info" },
    ]

    expect(hasBlockingViolations(violations)).toBe(false)
  })
})

describe("KnowledgeRepository Multi-Tenant", () => {
  let testDir: string
  let repo: KnowledgeRepository

  beforeEach(async () => {
    testDir = createTestDir()
    repo = new KnowledgeRepository({
      rootDir: testDir,
      orgId: "test-org",
      teamId: "test-team",
    })
    await repo.initialize()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("team layer support", () => {
    test("creates commit in team layer", async () => {
      const commit = await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Team specific policy",
        layer: "team",
        severity: "warn",
        author: testAuthor,
      })

      expect(commit.layer).toBe("team")

      const retrieved = await repo.getCommit("team", commit.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.title).toBe("Team Policy")
    })

    test("queries team layer", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Content",
        layer: "team",
        severity: "info",
        author: testAuthor,
      })

      const result = await repo.query({ layer: "team" })

      expect(result.items.length).toBe(1)
      expect(result.items[0].layer).toBe("team")
    })

    test("promotes from project to team", async () => {
      const original = await repo.createCommit({
        type: "policy",
        title: "Good Policy",
        content: "Content",
        layer: "project",
        severity: "warn",
        author: testAuthor,
      })

      const record = await repo.promote({
        knowledgeId: original.id,
        targetLayer: "team",
        justification: "Useful for the team",
        promoter: testAuthor,
      })

      expect(record.fromLayer).toBe("project")
      expect(record.toLayer).toBe("team")
    })

    test("promotes from team to org", async () => {
      const original = await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Content",
        layer: "team",
        severity: "warn",
        author: testAuthor,
      })

      const record = await repo.promote({
        knowledgeId: original.id,
        targetLayer: "org",
        justification: "Useful for the org",
        promoter: testAuthor,
      })

      expect(record.fromLayer).toBe("team")
      expect(record.toLayer).toBe("org")
    })
  })

  describe("getMergedKnowledge with team layer", () => {
    test("includes team layer for project scope", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Company Policy",
        content: "Company level",
        layer: "company",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Org Policy",
        content: "Org level",
        layer: "org",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Team level",
        layer: "team",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Project Policy",
        content: "Project level",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      const merged = await repo.getMergedKnowledge("project")
      expect(merged.length).toBe(4)
    })

    test("includes only company, org, team for team scope", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Company Policy",
        content: "Company level",
        layer: "company",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Team level",
        layer: "team",
        severity: "info",
        author: testAuthor,
      })

      await repo.createCommit({
        type: "policy",
        title: "Project Policy",
        content: "Project level",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      const merged = await repo.getMergedKnowledge("team")
      expect(merged.length).toBe(2)
      expect(merged.every((c) => c.layer !== "project")).toBe(true)
    })
  })

  describe("getStats with team layer", () => {
    test("includes team layer in stats", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Team Policy",
        content: "Content",
        layer: "team",
        severity: "info",
        author: testAuthor,
      })

      const stats = await repo.getStats()
      expect(stats.byLayer.team).toBe(1)
    })
  })

  describe("getMergedManifestWithSync without central hub", () => {
    test("returns local manifest when no central hub configured", async () => {
      await repo.createCommit({
        type: "policy",
        title: "Local Policy",
        content: "Content",
        layer: "project",
        severity: "info",
        author: testAuthor,
      })

      const merged = await repo.getMergedManifestWithSync()

      expect(merged.sources.project).toBe("local")
      expect(merged.sources.team).toBe("local")
      expect(merged.sources.org).toBe("local")
      expect(merged.sources.company).toBe("local")
      expect(merged.appliedFilters.orgId).toBe("test-org")
      expect(merged.appliedFilters.teamId).toBe("test-team")
    })
  })
})

describe("KnowledgeSyncManager", () => {
  let syncManager: KnowledgeSyncManager
  const testHubConfig: CentralHubConfig = {
    url: "https://github.com/test/knowledge-hub.git",
    branch: "main",
    autoSync: true,
    syncIntervalMinutes: 60,
  }

  beforeEach(async () => {
    syncManager = new KnowledgeSyncManager(testHubConfig, "test-org", "test-team")
  })

  afterEach(async () => {
    try {
      await rm(CACHE_DIR, { recursive: true, force: true })
    } catch {
      /* intentionally empty */
    }
  })

  describe("getSyncState", () => {
    test("returns empty state when not initialized", async () => {
      const state = await syncManager.getSyncState()

      expect(state.lastSyncAt).toBeNull()
      expect(state.lastCommitSha).toBeNull()
      expect(state.syncInProgress).toBe(false)
    })

    test("returns saved state after initialization", async () => {
      await syncManager.initialize()
      const state = await syncManager.getSyncState()

      expect(state).toBeDefined()
      expect(state.syncInProgress).toBe(false)
    })
  })

  describe("isSyncStale", () => {
    test("returns true when never synced", async () => {
      await syncManager.initialize()
      const isStale = await syncManager.isSyncStale()

      expect(isStale).toBe(true)
    })
  })

  describe("getMergedManifest", () => {
    test("returns local manifest when no central available", async () => {
      await syncManager.initialize()

      const localManifest: KnowledgeManifest = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        totalCount: 1,
        entries: {
          company: [],
          org: [],
          team: [],
          project: [{
            id: "local-1",
            type: "policy",
            layer: "project",
            summary: "Local policy",
            severity: "info",
            keywords: [],
          }],
        },
        stats: {
          byType: { policy: 1, adr: 0, pattern: 0, spec: 0 },
          bySeverity: { info: 1, warn: 0, block: 0 },
        },
      }

      const merged = await syncManager.getMergedManifest(localManifest)

      expect(merged.entries.project.length).toBe(1)
      expect(merged.sources.project).toBe("local")
      expect(merged.appliedFilters.orgId).toBe("test-org")
      expect(merged.appliedFilters.teamId).toBe("test-team")
    })
  })

  describe("clearCache", () => {
    test("clears cache and resets sync state", async () => {
      await syncManager.initialize()
      await syncManager.clearCache()

      const state = await syncManager.getSyncState()
      expect(state.lastSyncAt).toBeNull()
    })
  })
})
