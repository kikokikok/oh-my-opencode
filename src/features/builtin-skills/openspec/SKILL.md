# OpenSpec Lifecycle Skill

Structured specification and task tracking for multi-session AI agent work.

## Commands

- `/openspec propose <title>` - Create new proposal
- `/openspec design` - Write technical design (from proposal)
- `/openspec spec` - Write detailed specification (from design)
- `/openspec tasks` - Break down into tasks (from spec)
- `/openspec status` - Show current change status
- `/openspec amend` - Record spec amendment
- `/openspec verify` - Run verification
- `/openspec done` - Mark as complete
- `/openspec cancel` - Cancel with reason
- `/openspec list` - List all changes
- `/openspec resume <id>` - Resume archived change

## Workflow

```
PROPOSAL → DESIGN → SPEC → TASKS → IMPLEMENTING → VERIFY → DONE
    ↓         ↓        ↓       ↓          ↓          ↓
   (idea)  (approach) (contract) (breakdown) (coding)  (testing)
```

## Creating a Proposal

```
/openspec propose "Add user authentication"
```

This creates a new proposal with:
- Unique change ID
- Title and summary
- proposal.md for detailed description

You'll be prompted to write the proposal content.

## Transitioning States

### Proposal → Design

```
/openspec design
```

Write technical design explaining HOW you'll implement the proposal.

### Design → Spec

```
/openspec spec
```

Write detailed specification with:
- API contracts
- Data schemas
- Component interfaces
- Acceptance criteria

### Spec → Tasks

```
/openspec tasks
```

Break down the specification into actionable tasks:
- Each task should be completable in one session
- Include estimates (xs/s/m/l/xl)
- Set priorities (high/medium/low)
- Define dependencies

### Tasks → Implementing

Implementation starts automatically when you begin working on the first task.

### Implementing → Verify

```
/openspec verify
```

Run verification after all tasks complete:
- Check acceptance criteria
- Run tests
- Review implementation against spec

### Verify → Done

```
/openspec done
```

Mark the change as complete. This archives the change.

## Status and Progress

```
/openspec status
```

Shows:
- Current change title and status
- Task progress (X/Y completed)
- Current task being worked on
- Recent amendments

## Recording Amendments

When spec needs to change during implementation:

```
/openspec amend
```

This records:
- What changed and why
- Which sections were modified
- Impact analysis (affected tasks)
- Estimated rework effort

## Listing Changes

```
/openspec list
/openspec list --status implementing
/openspec list --archived
```

## Resuming Work

```
/openspec resume <change-id>
```

Resume work on an archived or inactive change.

## Configuration

In `oh-my-opencode.json`:

```json
{
  "openspec": {
    "enabled": true,
    "enforcement": "soft",
    "requireSpecFor": ["new_feature", "breaking_change"]
  }
}
```

### Enforcement Levels

| Level | Behavior |
|-------|----------|
| `off` | OpenSpec is opt-in, no reminders |
| `soft` | Reminders when implementing without spec |
| `hard` | Block implementation without approved spec |

### Change Types Requiring Spec

- `new_feature` - New user-facing functionality
- `enhancement` - Improvements to existing features
- `bug_fix` - Bug fixes
- `refactoring` - Code restructuring
- `breaking_change` - API or behavior changes
- `documentation` - Documentation updates
- `infrastructure` - DevOps/infrastructure changes

## Session Continuity

OpenSpec automatically:
1. **Session Start**: Injects active change context
2. **Session End**: Persists task progress
3. **New Session**: Shows where you left off

## Storage

Changes stored in `.opencode/openspec/`:

```
.opencode/openspec/
├── active.json           # Currently active change
├── changes/
│   └── {change-id}/
│       ├── metadata.json # Status, timestamps, author
│       ├── proposal.md
│       ├── design.md
│       ├── spec.md
│       ├── tasks.json
│       ├── verification.md
│       └── amendments/
└── archive/              # Completed/cancelled changes
```

## Best Practices

1. **Start with proposal**: Even for small changes, document the "why"
2. **Keep specs atomic**: One change = one coherent feature
3. **Task granularity**: Tasks should be session-sized (completable in one sitting)
4. **Amend, don't restart**: Record changes rather than starting over
5. **Verify against spec**: Check implementation matches specification
