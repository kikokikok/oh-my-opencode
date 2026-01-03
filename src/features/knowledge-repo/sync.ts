import { mkdir, readFile, writeFile, rm, stat } from "fs/promises"
import { join, dirname } from "path"
import { homedir } from "os"
import { spawn } from "child_process"
import type {
  CentralHubConfig,
  SyncState,
  KnowledgeManifest,
  MergedManifest,
  KnowledgeLayer,
  ManifestEntry,
} from "./types"

const CACHE_DIR = join(homedir(), ".opencode", "knowledge-cache")
const CENTRAL_CACHE_DIR = join(CACHE_DIR, "central")
const SYNC_STATE_PATH = join(CACHE_DIR, "sync-state.json")

export class KnowledgeSyncManager {
  private config: CentralHubConfig
  private orgId?: string
  private teamId?: string

  constructor(
    config: CentralHubConfig,
    orgId?: string,
    teamId?: string
  ) {
    this.config = config
    this.orgId = orgId
    this.teamId = teamId
  }

  async initialize(): Promise<void> {
    await mkdir(CACHE_DIR, { recursive: true })
    await mkdir(CENTRAL_CACHE_DIR, { recursive: true })

    const stateExists = await this.fileExists(SYNC_STATE_PATH)
    if (!stateExists) {
      await this.saveSyncState(this.createEmptySyncState())
    }
  }

  async getSyncState(): Promise<SyncState> {
    try {
      const data = await readFile(SYNC_STATE_PATH, "utf-8")
      return JSON.parse(data) as SyncState
    } catch {
      return this.createEmptySyncState()
    }
  }

  async syncFromCentral(): Promise<{ success: boolean; error?: string }> {
    const state = await this.getSyncState()

    if (state.syncInProgress) {
      return { success: false, error: "Sync already in progress" }
    }

    await this.saveSyncState({ ...state, syncInProgress: true, lastError: null })

    try {
      const repoExists = await this.fileExists(join(CENTRAL_CACHE_DIR, ".git"))

      if (repoExists) {
        await this.gitPull()
      } else {
        await this.gitClone()
      }

      const commitSha = await this.getHeadCommitSha()

      await this.saveSyncState({
        lastSyncAt: new Date().toISOString(),
        lastCommitSha: commitSha,
        etag: null,
        syncInProgress: false,
        lastError: null,
      })

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown sync error"
      await this.saveSyncState({
        ...state,
        syncInProgress: false,
        lastError: errorMessage,
      })
      return { success: false, error: errorMessage }
    }
  }

  async getCentralManifest(): Promise<KnowledgeManifest | null> {
    const manifestPath = join(CENTRAL_CACHE_DIR, "manifest.json")
    try {
      const data = await readFile(manifestPath, "utf-8")
      return JSON.parse(data) as KnowledgeManifest
    } catch {
      return null
    }
  }

  async getMergedManifest(localManifest: KnowledgeManifest): Promise<MergedManifest> {
    const centralManifest = await this.getCentralManifest()

    if (!centralManifest) {
      return this.createMergedManifestFromLocal(localManifest)
    }

    return this.mergeManifests(localManifest, centralManifest)
  }

  async isSyncStale(): Promise<boolean> {
    const state = await this.getSyncState()
    if (!state.lastSyncAt) return true

    const lastSync = new Date(state.lastSyncAt)
    const now = new Date()
    const diffMinutes = (now.getTime() - lastSync.getTime()) / (1000 * 60)

    return diffMinutes >= this.config.syncIntervalMinutes
  }

  async clearCache(): Promise<void> {
    try {
      await rm(CENTRAL_CACHE_DIR, { recursive: true, force: true })
      await mkdir(CENTRAL_CACHE_DIR, { recursive: true })
      await this.saveSyncState(this.createEmptySyncState())
    } catch {
      /* intentionally empty */
    }
  }

  private mergeManifests(
    local: KnowledgeManifest,
    central: KnowledgeManifest
  ): MergedManifest {
    const filteredCentral = this.filterCentralManifest(central)

    const merged: MergedManifest = {
      version: local.version,
      generatedAt: new Date().toISOString(),
      totalCount: 0,
      entries: {
        company: this.mergeEntries(local.entries.company, filteredCentral.entries.company),
        org: this.mergeEntries(local.entries.org, filteredCentral.entries.org),
        team: this.mergeEntries(local.entries.team, filteredCentral.entries.team),
        project: local.entries.project,
      },
      stats: {
        byType: { ...local.stats.byType },
        bySeverity: { ...local.stats.bySeverity },
      },
      sources: {
        company: this.determineSource(local.entries.company, filteredCentral.entries.company),
        org: this.determineSource(local.entries.org, filteredCentral.entries.org),
        team: this.determineSource(local.entries.team, filteredCentral.entries.team),
        project: "local",
      },
      appliedFilters: {
        orgId: this.orgId,
        teamId: this.teamId,
      },
    }

    merged.totalCount = Object.values(merged.entries).reduce(
      (sum, entries) => sum + entries.length,
      0
    )

    return merged
  }

  private filterCentralManifest(manifest: KnowledgeManifest): KnowledgeManifest {
    const filtered = { ...manifest }
    filtered.entries = { ...manifest.entries }

    if (this.orgId) {
      filtered.entries.org = manifest.entries.org.filter(
        (entry) => this.entryMatchesOrg(entry)
      )
    }

    if (this.teamId) {
      filtered.entries.team = manifest.entries.team.filter(
        (entry) => this.entryMatchesTeam(entry)
      )
    }

    return filtered
  }

  private entryMatchesOrg(entry: ManifestEntry): boolean {
    return entry.keywords.some(
      (kw) => kw.toLowerCase() === `org:${this.orgId?.toLowerCase()}`
    )
  }

  private entryMatchesTeam(entry: ManifestEntry): boolean {
    return entry.keywords.some(
      (kw) => kw.toLowerCase() === `team:${this.teamId?.toLowerCase()}`
    )
  }

  private mergeEntries(
    local: ManifestEntry[],
    central: ManifestEntry[]
  ): ManifestEntry[] {
    const localIds = new Set(local.map((e) => e.id))
    const uniqueCentral = central.filter((e) => !localIds.has(e.id))
    return [...local, ...uniqueCentral]
  }

  private determineSource(
    local: ManifestEntry[],
    central: ManifestEntry[]
  ): "central" | "local" | "merged" {
    if (local.length === 0 && central.length === 0) return "local"
    if (local.length === 0) return "central"
    if (central.length === 0) return "local"
    return "merged"
  }

  private createMergedManifestFromLocal(local: KnowledgeManifest): MergedManifest {
    return {
      ...local,
      sources: {
        company: "local",
        org: "local",
        team: "local",
        project: "local",
      },
      appliedFilters: {
        orgId: this.orgId,
        teamId: this.teamId,
      },
    }
  }

  private createEmptySyncState(): SyncState {
    return {
      lastSyncAt: null,
      lastCommitSha: null,
      etag: null,
      syncInProgress: false,
      lastError: null,
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    await mkdir(dirname(SYNC_STATE_PATH), { recursive: true })
    await writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2), "utf-8")
  }

  private async gitClone(): Promise<void> {
    await this.runGitCommand([
      "clone",
      "--branch",
      this.config.branch,
      "--depth",
      "1",
      this.config.url,
      CENTRAL_CACHE_DIR,
    ])
  }

  private async gitPull(): Promise<void> {
    await this.runGitCommand(["pull", "--ff-only"], CENTRAL_CACHE_DIR)
  }

  private async getHeadCommitSha(): Promise<string> {
    const result = await this.runGitCommand(
      ["rev-parse", "HEAD"],
      CENTRAL_CACHE_DIR
    )
    return result.trim()
  }

  private runGitCommand(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      process.stdout.on("data", (data) => {
        stdout += data.toString()
      })

      process.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      process.on("close", (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Git command failed: ${stderr || stdout}`))
        }
      })

      process.on("error", (error) => {
        reject(error)
      })
    })
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
}

export { CACHE_DIR, CENTRAL_CACHE_DIR, SYNC_STATE_PATH }
