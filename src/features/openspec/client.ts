import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile, readdir, rename, stat } from "fs/promises"
import { join, dirname } from "path"
import type {
  OpenSpecStatus,
  OpenSpecChange,
  ChangeMetadata,
  ActiveChange,
  OpenSpecManifest,
  ManifestEntry,
  OpenSpecTask,
  TasksDocument,
  Amendment,
  SessionLog,
  OpenSpecConfig,
  CreateProposalOptions,
  TransitionOptions,
  CreateAmendmentOptions,
  UpdateTaskOptions,
  TransitionResult,
  OpenSpecQueryFilter,
  OpenSpecQueryResult,
  OpenSpecEvent,
  OpenSpecEventListener,
  ChangeType,
  TaskDependency,
} from "./types"
import { VALID_TRANSITIONS, DEFAULT_OPENSPEC_CONFIG } from "./types"

const MANIFEST_VERSION = "1.0.0"
const TASKS_VERSION = "1.0.0"

export class OpenSpecClient {
  private config: OpenSpecConfig
  private rootDir: string
  private changesDir: string
  private archiveDir: string
  private activePath: string
  private manifestPath: string
  private listeners: OpenSpecEventListener[] = []

  constructor(projectRoot: string, config?: Partial<OpenSpecConfig>) {
    this.config = { ...DEFAULT_OPENSPEC_CONFIG, ...config }
    this.rootDir = config?.rootDir ?? join(projectRoot, ".opencode", "openspec")
    this.changesDir = join(this.rootDir, "changes")
    this.archiveDir = join(this.rootDir, "archive")
    this.activePath = join(this.rootDir, "active.json")
    this.manifestPath = join(this.rootDir, "manifest.json")
  }

  async initialize(): Promise<void> {
    await mkdir(this.changesDir, { recursive: true })
    await mkdir(this.archiveDir, { recursive: true })

    try {
      await stat(this.manifestPath)
    } catch {
      await this.rebuildManifest()
    }
  }

  async createProposal(options: CreateProposalOptions): Promise<OpenSpecChange> {
    const id = this.generateChangeId()
    const changeDir = join(this.changesDir, id)
    await mkdir(changeDir, { recursive: true })

    const now = new Date().toISOString()
    const metadata: ChangeMetadata = {
      id,
      title: options.title,
      summary: options.summary,
      status: "proposal",
      changeType: options.changeType,
      createdAt: now,
      updatedAt: now,
      author: options.author,
      sessions: [],
      amendments: [],
      tags: options.tags ?? [],
      externalRef: options.externalRef,
    }

    const proposalPath = join(changeDir, "proposal.md")
    await writeFile(proposalPath, options.content, "utf-8")

    const metadataPath = join(changeDir, "metadata.json")
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")

    const change = this.metadataToChange(metadata, changeDir)
    await this.updateManifest(change)
    await this.emit({ type: "change.created", change })

    return change
  }

  async transition(
    toStatus: OpenSpecStatus,
    options: TransitionOptions
  ): Promise<TransitionResult> {
    const change = await this.getChange(options.changeId)
    if (!change) {
      return {
        success: false,
        change: null as unknown as OpenSpecChange,
        message: `Change not found: ${options.changeId}`,
      }
    }

    const validTargets = VALID_TRANSITIONS[change.status]
    if (!validTargets.includes(toStatus)) {
      return {
        success: false,
        change,
        message: `Invalid transition from ${change.status} to ${toStatus}. Valid: ${validTargets.join(", ")}`,
      }
    }

    const changeDir = join(this.changesDir, options.changeId)
    const warnings: string[] = []

    if (options.content) {
      const fileName = this.getContentFileName(toStatus)
      if (fileName) {
        const contentPath = join(changeDir, fileName)
        await writeFile(contentPath, options.content, "utf-8")
      }
    }

    const fromStatus = change.status
    change.status = toStatus
    change.updatedAt = new Date().toISOString()

    if (toStatus === "done") {
      await this.archiveChange(options.changeId)
    } else if (toStatus === "cancelled") {
      await this.archiveChange(options.changeId)
    }

    await this.saveMetadata(options.changeId, change)
    await this.updateManifest(change)
    await this.emit({ type: "change.transitioned", change, from: fromStatus, to: toStatus })

    return {
      success: true,
      change,
      message: `Transitioned from ${fromStatus} to ${toStatus}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  async getChange(changeId: string): Promise<OpenSpecChange | null> {
    const changeDir = join(this.changesDir, changeId)
    const archivedDir = join(this.archiveDir, changeId)

    let targetDir = changeDir
    try {
      await stat(changeDir)
    } catch {
      try {
        await stat(archivedDir)
        targetDir = archivedDir
      } catch {
        return null
      }
    }

    const metadataPath = join(targetDir, "metadata.json")
    try {
      const data = await readFile(metadataPath, "utf-8")
      const metadata = JSON.parse(data) as ChangeMetadata
      return this.metadataToChange(metadata, targetDir)
    } catch {
      return null
    }
  }

  async getActive(): Promise<OpenSpecChange | null> {
    try {
      const data = await readFile(this.activePath, "utf-8")
      const active = JSON.parse(data) as ActiveChange
      if (!active.changeId) return null
      return this.getChange(active.changeId)
    } catch {
      return null
    }
  }

  async setActive(changeId: string, taskId?: string): Promise<void> {
    const change = await this.getChange(changeId)
    if (!change) {
      throw new Error(`Change not found: ${changeId}`)
    }

    const active: ActiveChange = {
      changeId,
      activatedAt: new Date().toISOString(),
      currentTaskId: taskId,
    }

    await writeFile(this.activePath, JSON.stringify(active, null, 2), "utf-8")
    await this.emit({ type: "change.activated", change })
  }

  async clearActive(): Promise<void> {
    try {
      const data = await readFile(this.activePath, "utf-8")
      const active = JSON.parse(data) as ActiveChange
      if (active.changeId) {
        await writeFile(this.activePath, "{}", "utf-8")
        await this.emit({ type: "change.deactivated", changeId: active.changeId })
      }
    } catch {
      // No active change
    }
  }

  async addTasks(changeId: string, tasks: Omit<OpenSpecTask, "id">[]): Promise<TasksDocument> {
    const change = await this.getChange(changeId)
    if (!change) {
      throw new Error(`Change not found: ${changeId}`)
    }

    const tasksPath = join(this.changesDir, changeId, "tasks.json")
    let doc: TasksDocument

    try {
      const data = await readFile(tasksPath, "utf-8")
      doc = JSON.parse(data) as TasksDocument
    } catch {
      doc = {
        version: TASKS_VERSION,
        updatedAt: new Date().toISOString(),
        tasks: [],
        dependencies: [],
      }
    }

    const newTasks: OpenSpecTask[] = tasks.map((t, i) => ({
      ...t,
      id: `task-${doc.tasks.length + i + 1}`,
    }))

    doc.tasks.push(...newTasks)
    doc.updatedAt = new Date().toISOString()

    await writeFile(tasksPath, JSON.stringify(doc, null, 2), "utf-8")
    await this.updateManifest(change)

    return doc
  }

  async updateTask(options: UpdateTaskOptions): Promise<OpenSpecTask | null> {
    const change = await this.getChange(options.changeId)
    if (!change) return null

    const tasksPath = join(this.changesDir, options.changeId, "tasks.json")
    let doc: TasksDocument

    try {
      const data = await readFile(tasksPath, "utf-8")
      doc = JSON.parse(data) as TasksDocument
    } catch {
      return null
    }

    const taskIndex = doc.tasks.findIndex((t) => t.id === options.taskId)
    if (taskIndex === -1) return null

    const task = doc.tasks[taskIndex]
    if (options.status) task.status = options.status
    if (options.notes) task.notes = options.notes
    if (options.linkedTodoId) task.linkedTodoId = options.linkedTodoId
    if (options.blockedReason) task.blockedReason = options.blockedReason
    if (options.status === "completed") task.completedAt = new Date().toISOString()

    doc.updatedAt = new Date().toISOString()
    await writeFile(tasksPath, JSON.stringify(doc, null, 2), "utf-8")

    await this.emit({ type: "task.updated", change, task })
    return task
  }

  async getTasks(changeId: string): Promise<TasksDocument | null> {
    const tasksPath = join(this.changesDir, changeId, "tasks.json")
    try {
      const data = await readFile(tasksPath, "utf-8")
      return JSON.parse(data) as TasksDocument
    } catch {
      return null
    }
  }

  async addTaskDependency(changeId: string, dependency: TaskDependency): Promise<void> {
    const tasksPath = join(this.changesDir, changeId, "tasks.json")
    const data = await readFile(tasksPath, "utf-8")
    const doc = JSON.parse(data) as TasksDocument

    doc.dependencies.push(dependency)
    doc.updatedAt = new Date().toISOString()

    await writeFile(tasksPath, JSON.stringify(doc, null, 2), "utf-8")
  }

  async createAmendment(options: CreateAmendmentOptions): Promise<Amendment> {
    const change = await this.getChange(options.changeId)
    if (!change) {
      throw new Error(`Change not found: ${options.changeId}`)
    }

    const amendmentsDir = join(this.changesDir, options.changeId, "amendments")
    await mkdir(amendmentsDir, { recursive: true })

    const existingAmendments = change.amendments.length
    const id = String(existingAmendments + 1).padStart(3, "0")
    const timestamp = new Date().toISOString()
    const fileName = `${id}-${timestamp.replace(/[:.]/g, "-")}.md`

    const amendment: Amendment = {
      id,
      timestamp,
      author: options.author,
      reason: options.reason,
      changes: options.changes,
      impactAnalysis: {
        tasksAffected: options.tasksAffected ?? [],
        estimatedEffort: this.estimateAmendmentEffort(options.changes),
        breaking: options.changes.some((c) => c.section.toLowerCase().includes("breaking")),
      },
      filePath: join(amendmentsDir, fileName),
    }

    const content = this.formatAmendmentMarkdown(amendment)
    await writeFile(amendment.filePath, content, "utf-8")

    change.amendments.push(amendment)
    change.updatedAt = timestamp

    await this.saveMetadata(options.changeId, change)
    await this.emit({ type: "change.amended", change, amendment })

    return amendment
  }

  async addSessionLog(changeId: string, log: SessionLog): Promise<void> {
    const change = await this.getChange(changeId)
    if (!change) {
      throw new Error(`Change not found: ${changeId}`)
    }

    change.sessions.push(log)
    change.updatedAt = new Date().toISOString()

    await this.saveMetadata(changeId, change)
  }

  async query(filter: OpenSpecQueryFilter): Promise<OpenSpecQueryResult> {
    const manifest = await this.getManifest()
    let entries = [...manifest.active]

    if (filter.includeArchived) {
      entries = entries.concat(manifest.archived)
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      entries = entries.filter((e) => statuses.includes(e.status))
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      entries = entries.filter((e) => e.title.toLowerCase().includes(searchLower))
    }

    const total = entries.length
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 50
    const paginated = entries.slice(offset, offset + limit)

    const items: OpenSpecChange[] = []
    for (const entry of paginated) {
      const change = await this.getChange(entry.id)
      if (change) items.push(change)
    }

    return {
      items,
      total,
      hasMore: offset + limit < total,
    }
  }

  async getManifest(): Promise<OpenSpecManifest> {
    try {
      const data = await readFile(this.manifestPath, "utf-8")
      return JSON.parse(data) as OpenSpecManifest
    } catch {
      return this.createEmptyManifest()
    }
  }

  async rebuildManifest(): Promise<OpenSpecManifest> {
    const manifest = this.createEmptyManifest()

    const processDir = async (dir: string, archived: boolean) => {
      try {
        const entries = await readdir(dir)
        for (const entry of entries) {
          const metadataPath = join(dir, entry, "metadata.json")
          try {
            const data = await readFile(metadataPath, "utf-8")
            const metadata = JSON.parse(data) as ChangeMetadata
            const tasksDoc = await this.getTasks(metadata.id)
            const manifestEntry = this.changeToManifestEntry(metadata, tasksDoc, archived)

            if (archived) {
              manifest.archived.push(manifestEntry)
            } else {
              manifest.active.push(manifestEntry)
            }

            manifest.totalCount++
            manifest.stats.byStatus[metadata.status] =
              (manifest.stats.byStatus[metadata.status] ?? 0) + 1
            if (metadata.changeType) {
              manifest.stats.byChangeType[metadata.changeType] =
                (manifest.stats.byChangeType[metadata.changeType] ?? 0) + 1
            }
          } catch {
            // Skip invalid entries
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    await processDir(this.changesDir, false)
    await processDir(this.archiveDir, true)

    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8")
    return manifest
  }

  on(listener: OpenSpecEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index !== -1) this.listeners.splice(index, 1)
    }
  }

  private async emit(event: OpenSpecEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event)
      } catch {
        // Don't let listener errors break the flow
      }
    }
  }

  private generateChangeId(): string {
    const timestamp = Date.now().toString(36)
    const random = randomUUID().substring(0, 8)
    return `${timestamp}-${random}`
  }

  private getContentFileName(status: OpenSpecStatus): string | null {
    const fileNames: Partial<Record<OpenSpecStatus, string>> = {
      design: "design.md",
      spec: "spec.md",
      verify: "verification.md",
    }
    return fileNames[status] ?? null
  }

  private metadataToChange(metadata: ChangeMetadata, changeDir: string): OpenSpecChange {
    return {
      ...metadata,
      proposalPath: join(changeDir, "proposal.md"),
      designPath: join(changeDir, "design.md"),
      specPath: join(changeDir, "spec.md"),
      tasksPath: join(changeDir, "tasks.json"),
      verificationPath: join(changeDir, "verification.md"),
    }
  }

  private async saveMetadata(changeId: string, change: OpenSpecChange): Promise<void> {
    const changeDir = join(this.changesDir, changeId)
    const archivedDir = join(this.archiveDir, changeId)

    let targetDir = changeDir
    try {
      await stat(changeDir)
    } catch {
      targetDir = archivedDir
    }

    const metadata: ChangeMetadata = {
      id: change.id,
      title: change.title,
      summary: change.summary,
      status: change.status,
      changeType: change.changeType,
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
      author: change.author,
      sessions: change.sessions,
      amendments: change.amendments,
      tags: change.tags,
      relatedChanges: change.relatedChanges,
      externalRef: change.externalRef,
    }

    const metadataPath = join(targetDir, "metadata.json")
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")
  }

  private async archiveChange(changeId: string): Promise<void> {
    const sourceDir = join(this.changesDir, changeId)
    const targetDir = join(this.archiveDir, changeId)

    try {
      await stat(sourceDir)
      await rename(sourceDir, targetDir)
    } catch {
      // Already archived or doesn't exist
    }

    await this.clearActive()
  }

  private async updateManifest(change: OpenSpecChange): Promise<void> {
    const manifest = await this.getManifest()
    const tasksDoc = await this.getTasks(change.id)
    const isArchived = change.status === "done" || change.status === "cancelled"
    const entry = this.changeToManifestEntry(change, tasksDoc, isArchived)

    const activeIndex = manifest.active.findIndex((e) => e.id === change.id)
    const archivedIndex = manifest.archived.findIndex((e) => e.id === change.id)
    const isNewEntry = activeIndex === -1 && archivedIndex === -1

    if (isArchived) {
      if (activeIndex !== -1) {
        manifest.active.splice(activeIndex, 1)
      }
      if (archivedIndex !== -1) {
        manifest.archived[archivedIndex] = entry
      } else {
        manifest.archived.push(entry)
      }
    } else {
      if (archivedIndex !== -1) {
        manifest.archived.splice(archivedIndex, 1)
      }
      if (activeIndex !== -1) {
        manifest.active[activeIndex] = entry
      } else {
        manifest.active.push(entry)
      }
    }

    if (isNewEntry) {
      manifest.totalCount++
      manifest.stats.byStatus[change.status] =
        (manifest.stats.byStatus[change.status] ?? 0) + 1
      if (change.changeType) {
        manifest.stats.byChangeType[change.changeType] =
          (manifest.stats.byChangeType[change.changeType] ?? 0) + 1
      }
    }

    manifest.generatedAt = new Date().toISOString()
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8")
  }

  private changeToManifestEntry(
    metadata: ChangeMetadata,
    tasksDoc: TasksDocument | null,
    archived: boolean
  ): ManifestEntry {
    return {
      id: metadata.id,
      title: metadata.title,
      status: metadata.status,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      tasksTotal: tasksDoc?.tasks.length,
      tasksCompleted: tasksDoc?.tasks.filter((t) => t.status === "completed").length,
      archived,
    }
  }

  private createEmptyManifest(): OpenSpecManifest {
    return {
      version: MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      totalCount: 0,
      active: [],
      archived: [],
      stats: {
        byStatus: {} as Record<OpenSpecStatus, number>,
        byChangeType: {} as Record<ChangeType, number>,
      },
    }
  }

  private estimateAmendmentEffort(
    changes: { section: string; before: string; after: string }[]
  ): "low" | "medium" | "high" {
    const totalChanges = changes.length
    const hasBreaking = changes.some((c) =>
      c.section.toLowerCase().includes("breaking") ||
      c.section.toLowerCase().includes("api") ||
      c.section.toLowerCase().includes("interface")
    )

    if (hasBreaking || totalChanges > 3) return "high"
    if (totalChanges > 1) return "medium"
    return "low"
  }

  private formatAmendmentMarkdown(amendment: Amendment): string {
    const lines = [
      `# Amendment ${amendment.id}`,
      "",
      `**Date**: ${amendment.timestamp}`,
      `**Author**: ${amendment.author.name} (${amendment.author.type})`,
      "",
      "## Reason",
      "",
      amendment.reason,
      "",
      "## Changes",
      "",
    ]

    for (const change of amendment.changes) {
      lines.push(`### ${change.section}`)
      lines.push("")
      lines.push("**Before:**")
      lines.push(change.before)
      lines.push("")
      lines.push("**After:**")
      lines.push(change.after)
      lines.push("")
    }

    lines.push("## Impact Analysis")
    lines.push("")
    lines.push(`- **Estimated Effort**: ${amendment.impactAnalysis.estimatedEffort}`)
    lines.push(`- **Breaking Change**: ${amendment.impactAnalysis.breaking ? "Yes" : "No"}`)

    if (amendment.impactAnalysis.tasksAffected.length > 0) {
      lines.push(`- **Tasks Affected**: ${amendment.impactAnalysis.tasksAffected.join(", ")}`)
    }

    return lines.join("\n")
  }
}
