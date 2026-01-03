/**
 * OpenSpec Lifecycle System Types
 *
 * A structured specification and task tracking system for multi-session AI agent work.
 * Supports proposal → design → spec → tasks → implementation → verification workflow.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Status of an OpenSpec change through its lifecycle.
 */
export type OpenSpecStatus =
  | "proposal" // Initial idea documented
  | "design" // Technical design written
  | "spec" // Detailed specification approved
  | "tasks" // Task breakdown complete
  | "implementing" // Tasks being worked on
  | "verify" // Implementation verification
  | "done" // Successfully completed
  | "cancelled" // Cancelled with reason

/**
 * Valid state transitions in the OpenSpec lifecycle.
 */
export const VALID_TRANSITIONS: Record<OpenSpecStatus, OpenSpecStatus[]> = {
  proposal: ["design", "cancelled"],
  design: ["spec", "cancelled"],
  spec: ["tasks", "cancelled"],
  tasks: ["implementing", "cancelled"],
  implementing: ["verify", "cancelled"],
  verify: ["done", "implementing"], // Can go back to implementing if verification fails
  done: [], // Terminal state
  cancelled: [], // Terminal state
}

/**
 * Task priority levels.
 */
export type TaskPriority = "high" | "medium" | "low"

/**
 * Task status within an OpenSpec change.
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled"

/**
 * Enforcement level for OpenSpec commitment.
 */
export type EnforcementLevel = "off" | "soft" | "hard"

/**
 * Types of changes that may require specification.
 */
export type ChangeType =
  | "new_feature"
  | "enhancement"
  | "bug_fix"
  | "refactoring"
  | "breaking_change"
  | "documentation"
  | "infrastructure"

// =============================================================================
// Author and Session Types
// =============================================================================

/**
 * Author of an OpenSpec change or amendment.
 */
export interface OpenSpecAuthor {
  id: string
  name: string
  type: "user" | "agent"
}

/**
 * Log entry for a session that worked on this change.
 */
export interface SessionLog {
  sessionId: string
  startedAt: string
  endedAt?: string
  tasksCompleted: string[] // Task IDs
  tasksStarted: string[] // Task IDs
  notes?: string
  agentModel?: string
}

// =============================================================================
// Task Types
// =============================================================================

/**
 * A single task within an OpenSpec change.
 */
export interface OpenSpecTask {
  /** Unique identifier within the change */
  id: string
  /** Task description */
  content: string
  /** Current status */
  status: TaskStatus
  /** Priority level */
  priority: TaskPriority
  /** Session ID that is/was working on this task */
  assignedSession?: string
  /** ISO 8601 timestamp when completed */
  completedAt?: string
  /** Additional notes or context */
  notes?: string
  /** Link to session todo item */
  linkedTodoId?: string
  /** Estimated effort */
  estimate?: "xs" | "s" | "m" | "l" | "xl"
  /** Tags for categorization */
  tags?: string[]
  /** Blocked reason if status is 'blocked' */
  blockedReason?: string
}

/**
 * Dependency between tasks.
 */
export interface TaskDependency {
  /** Task that depends on another */
  taskId: string
  /** Task that must be completed first */
  dependsOn: string
}

/**
 * The tasks document stored as tasks.json.
 */
export interface TasksDocument {
  /** Schema version */
  version: string
  /** Last updated timestamp */
  updatedAt: string
  /** All tasks for this change */
  tasks: OpenSpecTask[]
  /** Dependencies between tasks */
  dependencies: TaskDependency[]
}

// =============================================================================
// Amendment Types
// =============================================================================

/**
 * A single change within an amendment.
 */
export interface AmendmentChange {
  /** Which section of the spec changed */
  section: string
  /** Summary of previous content */
  before: string
  /** Summary of new content */
  after: string
}

/**
 * Impact analysis for an amendment.
 */
export interface AmendmentImpact {
  /** Task IDs that need rework */
  tasksAffected: string[]
  /** Estimated effort to address the amendment */
  estimatedEffort: "low" | "medium" | "high"
  /** Whether this is a breaking change */
  breaking: boolean
  /** Additional notes */
  notes?: string
}

/**
 * An amendment record tracking spec changes.
 */
export interface Amendment {
  /** Sequential ID: "001", "002", etc. */
  id: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Who made the amendment */
  author: OpenSpecAuthor
  /** Why the change was needed */
  reason: string
  /** What changed */
  changes: AmendmentChange[]
  /** Impact analysis */
  impactAnalysis: AmendmentImpact
  /** File path to full amendment markdown */
  filePath: string
}

// =============================================================================
// Change Metadata Types
// =============================================================================

/**
 * Metadata for an OpenSpec change.
 */
export interface ChangeMetadata {
  /** Unique identifier */
  id: string
  /** Human-readable title */
  title: string
  /** One-line summary */
  summary: string
  /** Current status in lifecycle */
  status: OpenSpecStatus
  /** Type of change */
  changeType?: ChangeType
  /** ISO 8601 creation timestamp */
  createdAt: string
  /** ISO 8601 last update timestamp */
  updatedAt: string
  /** Original author */
  author: OpenSpecAuthor
  /** Sessions that have worked on this */
  sessions: SessionLog[]
  /** Amendments made after spec approval */
  amendments: Amendment[]
  /** Tags for categorization */
  tags: string[]
  /** Related change IDs */
  relatedChanges?: string[]
  /** Link to external issue tracker */
  externalRef?: {
    type: "github" | "jira" | "linear" | "other"
    id: string
    url?: string
  }
}

/**
 * Full change including content paths.
 */
export interface OpenSpecChange extends ChangeMetadata {
  /** Path to proposal.md */
  proposalPath: string
  /** Path to design.md (if exists) */
  designPath?: string
  /** Path to spec.md (if exists) */
  specPath?: string
  /** Path to tasks.json (if exists) */
  tasksPath?: string
  /** Path to verification.md (if exists) */
  verificationPath?: string
}

// =============================================================================
// Active Change Types
// =============================================================================

/**
 * Reference to the currently active change.
 */
export interface ActiveChange {
  /** Change ID */
  changeId: string
  /** When this change became active */
  activatedAt: string
  /** Currently active task ID (if implementing) */
  currentTaskId?: string
}

// =============================================================================
// Manifest Types
// =============================================================================

/**
 * Entry in the OpenSpec manifest.
 */
export interface ManifestEntry {
  id: string
  title: string
  status: OpenSpecStatus
  createdAt: string
  updatedAt: string
  tasksTotal?: number
  tasksCompleted?: number
  archived: boolean
}

/**
 * The OpenSpec manifest indexing all changes.
 */
export interface OpenSpecManifest {
  /** Schema version */
  version: string
  /** Last generated timestamp */
  generatedAt: string
  /** Total number of changes */
  totalCount: number
  /** Active changes */
  active: ManifestEntry[]
  /** Archived changes */
  archived: ManifestEntry[]
  /** Statistics */
  stats: {
    byStatus: Record<OpenSpecStatus, number>
    byChangeType: Record<ChangeType, number>
  }
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * OpenSpec configuration.
 */
export interface OpenSpecConfig {
  /** Whether OpenSpec is enabled */
  enabled: boolean
  /** Enforcement level */
  enforcement: EnforcementLevel
  /** Change types that require specification */
  requireSpecFor: ChangeType[]
  /** Root directory for OpenSpec storage */
  rootDir?: string
  /** Whether to auto-sync with session todos */
  autoSyncTodos: boolean
  /** Maximum amendments before requiring new spec */
  maxAmendments?: number
}

/**
 * Default OpenSpec configuration.
 */
export const DEFAULT_OPENSPEC_CONFIG: OpenSpecConfig = {
  enabled: true,
  enforcement: "soft",
  requireSpecFor: ["new_feature", "breaking_change"],
  autoSyncTodos: true,
  maxAmendments: 5,
}

// =============================================================================
// Operation Types
// =============================================================================

/**
 * Options for creating a new proposal.
 */
export interface CreateProposalOptions {
  title: string
  summary: string
  content: string
  author: OpenSpecAuthor
  changeType?: ChangeType
  tags?: string[]
  externalRef?: ChangeMetadata["externalRef"]
}

/**
 * Options for transitioning to a new status.
 */
export interface TransitionOptions {
  changeId: string
  content?: string // For design, spec, verification
  author: OpenSpecAuthor
  notes?: string
}

/**
 * Options for creating an amendment.
 */
export interface CreateAmendmentOptions {
  changeId: string
  reason: string
  changes: AmendmentChange[]
  author: OpenSpecAuthor
  tasksAffected?: string[]
}

/**
 * Options for updating a task.
 */
export interface UpdateTaskOptions {
  changeId: string
  taskId: string
  status?: TaskStatus
  notes?: string
  linkedTodoId?: string
  blockedReason?: string
}

/**
 * Result of a state transition.
 */
export interface TransitionResult {
  success: boolean
  change: OpenSpecChange
  message: string
  warnings?: string[]
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Filter options for querying changes.
 */
export interface OpenSpecQueryFilter {
  /** Filter by status */
  status?: OpenSpecStatus | OpenSpecStatus[]
  /** Filter by change type */
  changeType?: ChangeType | ChangeType[]
  /** Filter by tags */
  tags?: string[]
  /** Include archived changes */
  includeArchived?: boolean
  /** Full-text search */
  search?: string
  /** Maximum results */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Result of a query.
 */
export interface OpenSpecQueryResult {
  items: OpenSpecChange[]
  total: number
  hasMore: boolean
}

// =============================================================================
// Event Types (for hooks)
// =============================================================================

/**
 * Events emitted by the OpenSpec system.
 */
export type OpenSpecEvent =
  | { type: "change.created"; change: OpenSpecChange }
  | { type: "change.transitioned"; change: OpenSpecChange; from: OpenSpecStatus; to: OpenSpecStatus }
  | { type: "change.amended"; change: OpenSpecChange; amendment: Amendment }
  | { type: "task.updated"; change: OpenSpecChange; task: OpenSpecTask }
  | { type: "change.activated"; change: OpenSpecChange }
  | { type: "change.deactivated"; changeId: string }

/**
 * Event listener for OpenSpec events.
 */
export type OpenSpecEventListener = (event: OpenSpecEvent) => void | Promise<void>
