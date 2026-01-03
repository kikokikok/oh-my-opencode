# ADR-002: OpenSpec Lifecycle System

**Status**: Accepted  
**Date**: 2026-01-03  
**Authors**: Christian Klat, Sisyphus (AI)

## Context

AI agents working on complex features need structured task tracking across multiple sessions. Current problems:

1. **No continuity**: Session N doesn't know what Session N-1 accomplished
2. **No specification tracking**: Changes are implemented ad-hoc without formal specs
3. **No amendment history**: When requirements change, there's no audit trail
4. **No commitment mechanism**: Agents can implement without following any process

Existing `openspec/` directory contains documentation-only specs with no programmatic lifecycle management.

## Decision

### Separate Storage System

OpenSpec lives in `.opencode/openspec/` (not inside Knowledge Repo) for clear separation of concerns:

```
.opencode/openspec/
├── active.json                    # Currently active change (singleton)
├── changes/
│   └── {change-id}/
│       ├── metadata.json          # Change metadata, status, timestamps
│       ├── proposal.md            # Initial proposal
│       ├── design.md              # Technical design
│       ├── spec.md                # Detailed specification
│       ├── tasks.json             # Task breakdown with status
│       ├── verification.md        # Verification results
│       └── amendments/
│           ├── 001-{timestamp}.md # Amendment history
│           └── 002-{timestamp}.md
├── archive/                       # Completed/cancelled changes
│   └── {change-id}/
└── manifest.json                  # Index of all changes
```

### State Machine

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PROPOSAL   │ ──▶ │   DESIGN    │ ──▶ │    SPEC     │
│  (idea)     │     │  (approach) │     │ (contract)  │
│             │     │             │     │             │
│ proposal.md │     │ design.md   │     │ spec.md     │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      │                   │                   ▼
      │                   │           ┌─────────────┐
      │                   │           │    TASKS    │
      │                   │           │ (breakdown) │
      │                   │           │             │
      │                   │           │ tasks.json  │
      │                   │           └─────────────┘
      │                   │                   │
      │                   │                   ▼
      │                   │           ┌─────────────┐
      │                   │           │IMPLEMENTING │
      │                   │           │  (coding)   │
      │                   │           │             │
      │                   │           │ in_progress │
      │                   │           └─────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  CANCELLED  │     │  CANCELLED  │     │   VERIFY    │
│             │     │             │     │  (testing)  │
└─────────────┘     └─────────────┘     │             │
                                        │verification │
                                        │    .md      │
                                        └─────────────┘
                                              │
                                              ▼
                                        ┌─────────────┐
                                        │    DONE     │
                                        │  (shipped)  │
                                        │             │
                                        │  archived   │
                                        └─────────────┘
```

### State Transitions

| From | To | Trigger | Requirements |
|------|----|---------|--------------|
| (none) | PROPOSAL | `/openspec propose` | Title, summary |
| PROPOSAL | DESIGN | `/openspec design` | Proposal approved |
| DESIGN | SPEC | `/openspec spec` | Design approved |
| SPEC | TASKS | `/openspec tasks` | Spec approved, task breakdown |
| TASKS | IMPLEMENTING | Start first task | At least one task defined |
| IMPLEMENTING | VERIFY | All tasks complete | verification.md created |
| VERIFY | DONE | Verification passes | Move to archive |
| Any | CANCELLED | `/openspec cancel` | Cancellation reason |

### Multi-Session Continuity

**Session Start Hook**:
```typescript
// src/hooks/openspec-continuity/index.ts
async function onSessionStart(context: SessionContext): Promise<void> {
  const active = await openspec.getActive()
  
  if (active) {
    // Inject context about active change
    context.injectSystemMessage(`
[ACTIVE OPENSPEC: ${active.title}]
Status: ${active.status}
Current Task: ${active.currentTask?.content ?? 'None'}
Tasks Completed: ${active.completedTasks}/${active.totalTasks}

You are continuing work on this specification. Review the spec and tasks before proceeding.
Use \`/openspec status\` to see full details.
    `)
  }
}
```

**Session End Hook**:
```typescript
async function onSessionEnd(context: SessionContext): Promise<void> {
  const active = await openspec.getActive()
  
  if (active && active.status === 'implementing') {
    // Persist task progress
    await openspec.syncTasksFromTodo(context.todos)
    
    // Log session summary
    await openspec.addSessionLog({
      sessionId: context.sessionId,
      tasksCompleted: context.completedTodoIds,
      notes: context.agentNotes,
      timestamp: new Date().toISOString()
    })
  }
}
```

### Amendment Tracking

When spec changes after implementation starts:

```typescript
interface Amendment {
  id: string                    // Sequential: "001", "002"
  timestamp: string             // ISO 8601
  author: string                // Agent or user ID
  reason: string                // Why the change was needed
  changes: {
    section: string             // Which section changed
    before: string              // Previous content (summary)
    after: string               // New content (summary)
  }[]
  impactAnalysis: {
    tasksAffected: string[]     // Task IDs that need rework
    estimatedEffort: string     // "low" | "medium" | "high"
  }
}
```

**Amendment Workflow**:
1. Agent detects spec needs change during implementation
2. `/openspec amend --reason "..."` creates amendment record
3. Affected tasks marked for review
4. Impact analysis generated
5. Continue implementation with updated spec

### Agent Commitment (Configurable)

```json
{
  "openspec": {
    "enabled": true,
    "enforcement": "soft",       // "soft" | "hard" | "off"
    "require_spec_for": [
      "new_feature",
      "breaking_change"
    ]
  }
}
```

**Enforcement Levels**:

| Level | Behavior |
|-------|----------|
| `off` | No enforcement, OpenSpec is opt-in |
| `soft` | Reminders when implementing without spec, can proceed |
| `hard` | Block implementation without approved spec |

**Soft Enforcement (Default)**:
```
[OPENSPEC REMINDER]
You're implementing changes without an active specification.
Consider using `/openspec propose` to document this change.

This helps with:
- Multi-session continuity
- Team alignment
- Amendment tracking

Proceed anyway? The reminder won't appear again this session.
```

**Hard Enforcement**:
```
[OPENSPEC REQUIRED]
This project requires specifications for new features.
Current change appears to be: {detected_change_type}

To proceed:
1. Run `/openspec propose "Your feature title"`
2. Complete the proposal → design → spec workflow
3. Break down into tasks
4. Then implement

Bypass with: /openspec bypass --reason "..."
```

### Data Structures

```typescript
// .opencode/openspec/active.json
interface ActiveChange {
  changeId: string
  activatedAt: string
  currentTaskId?: string
}

// .opencode/openspec/changes/{id}/metadata.json
interface ChangeMetadata {
  id: string
  title: string
  summary: string
  status: OpenSpecStatus
  createdAt: string
  updatedAt: string
  author: {
    id: string
    name: string
  }
  sessions: SessionLog[]
  tags: string[]
}

// .opencode/openspec/changes/{id}/tasks.json
interface TasksDocument {
  version: string
  tasks: OpenSpecTask[]
  dependencies: TaskDependency[]
}

interface OpenSpecTask {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  assignedSession?: string
  completedAt?: string
  notes?: string
  linkedTodoId?: string    // Links to session todo
}
```

### Skill Commands

```
/openspec propose <title>    # Create new proposal
/openspec design             # Write technical design
/openspec spec               # Write detailed specification  
/openspec tasks              # Break down into tasks
/openspec status             # Show current state
/openspec amend              # Record spec amendment
/openspec verify             # Run verification
/openspec done               # Mark as complete
/openspec cancel             # Cancel with reason
/openspec list               # List all changes
/openspec resume <id>        # Resume archived change
/openspec bypass             # (hard mode) Bypass enforcement
```

## Consequences

### Positive
- Clear multi-session continuity
- Audit trail for all changes
- Configurable enforcement fits different team cultures
- Integration with existing todo system
- Amendment tracking prevents scope creep

### Negative
- Additional ceremony for small changes
- Learning curve for agents and users
- Storage overhead for change history

### Neutral
- Separate from Knowledge Repo (pro: clarity, con: two systems)
- Markdown-based specs (familiar but not structured)

## Implementation Plan

### Phase 1: Core Types and Client
- [ ] Create `src/features/openspec/types.ts`
- [ ] Create `src/features/openspec/client.ts`
- [ ] Implement state machine transitions

### Phase 2: Session Continuity
- [ ] Create `src/hooks/openspec-continuity/`
- [ ] Implement session start injection
- [ ] Implement session end persistence

### Phase 3: Skill Commands
- [ ] Create `src/features/builtin-skills/openspec/`
- [ ] Implement all `/openspec` commands
- [ ] Add to skill loader

### Phase 4: Commitment Hook
- [ ] Create `src/hooks/openspec-commitment/`
- [ ] Implement soft enforcement
- [ ] Implement hard enforcement
- [ ] Add bypass mechanism

### Phase 5: Todo Integration
- [ ] Sync OpenSpec tasks with session todos
- [ ] Two-way status updates
- [ ] Preserve linkage across sessions

## References

- [Specification by Example](https://gojko.net/books/specification-by-example/)
- [RFC Process](https://www.ietf.org/standards/rfcs/)
- [Architectural Decision Records](https://adr.github.io/)
