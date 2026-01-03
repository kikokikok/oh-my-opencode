# ADR-001: Knowledge Repository Multi-Tenancy Architecture

**Status**: Accepted  
**Date**: 2026-01-03  
**Authors**: Christian Klat, Sisyphus (AI)

## Context

The Knowledge Repository currently supports a single-project, single-tenant model with hardcoded paths. Enterprise teams need:

1. **Multi-agent sharing**: Different AI agents within a session need consistent access to organizational knowledge
2. **Multi-project sharing**: Projects within an organization share common policies and patterns
3. **Multi-team sharing**: Teams within an organization have team-specific conventions while inheriting org-level policies
4. **Multi-application sharing**: Multiple applications (opencode instances) need synchronized knowledge

The current implementation stores everything in `.opencode/knowledge/` with no mechanism for cross-project or cross-team knowledge sharing.

## Decision

### Storage Topology: Git-Based Central Hub

We adopt a **Git-based federated model** with three tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CENTRAL KNOWLEDGE HUB                         │
│  (Git repository: github.com/org/knowledge-hub)                 │
│  ├── company/                                                   │
│  │   ├── policies/                                              │
│  │   ├── patterns/                                              │
│  │   └── adrs/                                                  │
│  ├── orgs/{org-id}/                                             │
│  │   ├── policies/                                              │
│  │   ├── patterns/                                              │
│  │   └── teams/{team-id}/                                       │
│  └── manifest.json (global manifest, <2K tokens)                │
└─────────────────────────────────────────────────────────────────┘
                              ↑ git pull/push
┌─────────────────────────────────────────────────────────────────┐
│                   LOCAL KNOWLEDGE CACHE                          │
│  (~/.opencode/knowledge-cache/)                                 │
│  ├── central/                   # Synced from central hub       │
│  │   ├── company/               # Company-level knowledge       │
│  │   ├── orgs/{org-id}/         # Org-level knowledge           │
│  │   └── manifest.json          # Cached central manifest       │
│  └── sync-state.json            # Last sync timestamp, etag     │
└─────────────────────────────────────────────────────────────────┘
                              ↑ reference
┌─────────────────────────────────────────────────────────────────┐
│                   PROJECT KNOWLEDGE                              │
│  (.opencode/knowledge/)                                         │
│  ├── project/                   # Project-specific knowledge    │
│  │   ├── adrs/                                                  │
│  │   ├── specs/                                                 │
│  │   └── patterns/                                              │
│  └── manifest.json              # Project + inherited entries   │
└─────────────────────────────────────────────────────────────────┘
                              ↑ promote
┌─────────────────────────────────────────────────────────────────┐
│                      MEM0 LAYERS                                 │
│  (Mutable working memory)                                       │
│  agent → user → session → project → team → org → company        │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```json
{
  "knowledge_repo": {
    "enabled": true,
    "central_hub": {
      "url": "git@github.com:acme-corp/knowledge-hub.git",
      "branch": "main",
      "auto_sync": true,
      "sync_interval_minutes": 60
    },
    "org_id": "engineering",
    "team_id": "platform",
    "project_id": "oh-my-opencode"
  }
}
```

### Retrieval Strategy

When an agent requests knowledge (e.g., "authentication policy"):

1. **Project manifest check**: Search `.opencode/knowledge/manifest.json` first
2. **Local cache check**: Search `~/.opencode/knowledge-cache/manifest.json`
3. **Keyword matching**: Match trigger keywords against all manifest entries
4. **Layer precedence**: Project > Team > Org > Company (lower layers override)
5. **On-demand load**: Only load full content when manifest entry matches

```typescript
interface RetrievalFlow {
  // Step 1: Build merged manifest (cached, invalidated on sync)
  mergedManifest = merge(
    projectManifest,
    cachedCentralManifest.filter(org=config.org_id, team=config.team_id)
  )
  
  // Step 2: Search by keywords/query
  matches = mergedManifest.entries.filter(matchesQuery)
  
  // Step 3: Load full content for matches (lazy)
  fullKnowledge = await Promise.all(matches.map(loadFull))
  
  // Step 4: Apply layer precedence for conflicts
  resolved = resolveConflicts(fullKnowledge, {
    precedence: ['project', 'team', 'org', 'company']
  })
}
```

### Sync Mechanism

**Pull Model (Default)**:
```
Session Start → Check sync-state.json → If stale → git pull central → Update cache
```

**Push Model (Promotion)**:
```
knowledge_propose(promote=true) → Create PR to central hub → Human review → Merge
```

**Offline Support**:
- Project-level knowledge always available (`.opencode/knowledge/`)
- Central knowledge cached locally (`~/.opencode/knowledge-cache/`)
- Sync failures logged but don't block session
- Stale cache warning after 24h without sync

### Mem0 Integration

Mem0 serves as **mutable working memory**, Knowledge Repo as **immutable source of truth**:

```
┌──────────────────┐         ┌──────────────────┐
│     Mem0         │         │  Knowledge Repo  │
│  (Working Memory)│         │ (Source of Truth)│
├──────────────────┤         ├──────────────────┤
│ • Short-term     │ ──────▶ │ • Long-term      │
│ • Mutable        │ promote │ • Immutable      │
│ • Per-agent      │         │ • Per-layer      │
│ • Auto-captured  │         │ • Curated        │
└──────────────────┘         └──────────────────┘
```

**Promotion Flow**:
1. Agent captures insight in Mem0 (`memory_add`)
2. Curator reviews and proposes to Knowledge Repo (`knowledge_propose`)
3. Knowledge commit created with constraints
4. If cross-project value: promote to org/company level
5. Central hub updated via PR

### Conflict Resolution

When the same concept exists at multiple layers:

| Scenario | Resolution |
|----------|------------|
| Project overrides Org policy | Project wins (explicit override) |
| Conflicting constraints | Lower layer severity wins |
| Missing project knowledge | Inherit from Org/Company |
| Stale cache vs fresh project | Fresh project wins |

## Consequences

### Positive
- Clear separation of mutable (Mem0) and immutable (Knowledge Repo) storage
- Offline-first with graceful degradation
- Familiar Git workflow for knowledge curation
- Audit trail through Git history
- Easy backup and disaster recovery

### Negative
- Requires Git infrastructure for central hub
- Sync latency (not real-time)
- Merge conflicts possible in central hub
- Additional configuration complexity

### Neutral
- Learning curve for knowledge promotion workflow
- Requires periodic cache cleanup

## Implementation Plan

### Phase 1: Local-First (Current)
- [x] Project-level knowledge storage
- [x] Manifest generation
- [x] Constraint-based conflict detection

### Phase 2: Multi-Tenant Config
- [ ] Add `central_hub`, `org_id`, `team_id` to config schema
- [ ] Implement knowledge cache at `~/.opencode/knowledge-cache/`
- [ ] Implement merged manifest generation

### Phase 3: Sync Mechanism
- [ ] Git-based sync on session start
- [ ] Background sync with configurable interval
- [ ] Stale cache detection and warning

### Phase 4: Promotion Workflow
- [ ] `knowledge_propose --promote` flag
- [ ] PR creation to central hub
- [ ] Webhook integration for sync triggers

## References

- [Mem0 Documentation](https://docs.mem0.ai/)
- [Git as a CMS](https://www.netlify.com/blog/2015/10/28/a-step-by-step-guide-jekyll-3.0-on-netlify/)
- [ADR Tools](https://adr.github.io/)
