# Mobile-PWA-Spec.md — Approval Surface UI Specification

**Version:** 1.0
**Author:** Johnwil
**Date:** 2026-03-10
**Parent Document:** [Claude.md](./Claude.md)

---

## 1. Overview

The mobile PWA is the single approval surface for the Parallel Operations Control Plane (POCP). It is designed for one-handed phone operation, instant load times, and offline resilience. Everything a user needs to govern six parallel AI agents lives in this app.

**Tech Stack:** Next.js 14 (App Router) + Supabase JS Client + Tailwind CSS + PWA manifest

---

## 2. Screen Architecture

```
┌──────────────────────────────┐
│         Bottom Nav Bar        │
│  [Queue]  [Agents]  [Memory] │
└──────────────────────────────┘
         │        │        │
         ▼        ▼        ▼
    Queue View  Agent    Memory
    (Home)      Dashboard Explorer
         │
    ┌────┴────┐
    │         │
  Card      Batch
  Detail    Select
  View      Mode
```

### 2.1 Screen List

| # | Screen | Route | Purpose |
|---|---|---|---|
| 1 | Queue (Home) | `/` | Scrollable feed of pending approval cards |
| 2 | Card Detail | `/approval/[id]` | Full diff view, context, and action buttons |
| 3 | Batch Select | `/batch` | Multi-select low-risk items for bulk approve |
| 4 | Agent Dashboard | `/agents` | Real-time status of all 6 agents |
| 5 | Memory Explorer | `/memory` | Browse and search shared memory entries |
| 6 | Task Board | `/tasks` | Kanban-style view of all tasks across agents |
| 7 | Settings | `/settings` | Auto-approve rules, notifications, agent config |
| 8 | Conflict Resolver | `/conflict/[id]` | Side-by-side comparison for conflicts |

---

## 3. Component Specifications

### 3.1 Approval Card (Queue Feed)

The primary UI unit. Each pending approval is rendered as a card in the feed.

```
┌──────────────────────────────────────────┐
│  [Claude Code icon]  claude-code  · 2m   │
│                                          │
│  Refactor auth middleware to use JWT     │
│                                          │
│  ┌────────┐  4 files · +87 / -42        │
│  │ MEDIUM │                              │
│  └────────┘                              │
│                                          │
│  [✓ Approve]  [✗ Reject]  [✎ Modify]   │
└──────────────────────────────────────────┘
```

**Card Anatomy:**

| Element | Spec |
|---|---|
| Agent icon | 24×24 icon, unique per surface. Color-coded ring shows agent status (green=active, gray=idle) |
| Agent name | 14px semibold, left-aligned |
| Timestamp | 14px regular, gray, right-aligned. Relative time ("2m ago", "1h ago") |
| Title | 18px semibold, max 2 lines, truncated with ellipsis |
| Risk badge | Pill-shaped, color-coded: green (low), yellow (medium), orange (high), red (critical) |
| Change summary | 14px regular, gray. Format: "{N} files · +{ins} / -{del}" |
| Action buttons | Full-width row, equal spacing. Approve (green), Reject (red), Modify (blue) |

**Interactions:**
- Tap card body → opens Card Detail view
- Tap Approve → instant approve with haptic feedback, card slides left and disappears
- Tap Reject → opens brief text input for rejection reason (optional), then card slides right
- Tap Modify → opens text input for modification instructions
- Swipe right → quick approve
- Swipe left → quick reject
- Long press → add to batch selection

### 3.2 Risk Badge

```
  Low:      ┌──────┐ bg: #10B981 (green)    text: white
            │  LOW │
            └──────┘

  Medium:   ┌────────┐ bg: #F59E0B (amber)  text: white
            │ MEDIUM │
            └────────┘

  High:     ┌──────┐ bg: #F97316 (orange)   text: white
            │ HIGH │
            └──────┘

  Critical: ┌──────────┐ bg: #EF4444 (red)  text: white
            │ CRITICAL │
            └──────────┘
```

### 3.3 Card Detail View

Expanded view when user taps a card. Full-screen modal that slides up from the bottom.

```
┌──────────────────────────────────────────┐
│  ← Back          Approval Detail         │
│──────────────────────────────────────────│
│                                          │
│  [Claude Code icon]  claude-code         │
│  Requested 2 minutes ago                 │
│  Expires in 58 minutes                   │
│                                          │
│  ┌────────┐                              │
│  │ MEDIUM │                              │
│  └────────┘                              │
│                                          │
│  Refactor auth middleware to use JWT     │
│                                          │
│  Replaced session-based auth with JWT    │
│  tokens across 4 files. This enables     │
│  stateless authentication for the        │
│  microservice architecture.              │
│                                          │
│  ─── Diff ───────────────────────────    │
│                                          │
│  middleware/auth.js                       │
│  - const session = req.session;          │
│  + const token = req.headers.auth;       │
│  + const decoded = jwt.verify(token);    │
│                                          │
│  config/jwt.js                           │
│  + export const JWT_SECRET = env.SECRET; │
│  + export const JWT_EXPIRY = '24h';      │
│                                          │
│  ─── Context ────────────────────────    │
│                                          │
│  Related memory:                         │
│  • api:auth:strategy → JWT (0.95)        │
│  • api:auth:session → deprecated (0.80)  │
│                                          │
│  Prior approvals:                        │
│  • "Add JWT package" — approved 1h ago   │
│                                          │
│──────────────────────────────────────────│
│  [✓ Approve]  [✗ Reject]  [✎ Modify]   │
└──────────────────────────────────────────┘
```

**Sections:**
1. **Header** — Agent info, timestamps, risk badge
2. **Description** — Full description text from the agent
3. **Diff viewer** — Syntax-highlighted code diff (collapsible per file)
4. **Context panel** — Related memory entries + prior approvals for the same files/domain
5. **Action bar** — Sticky at bottom, always visible

### 3.4 Agent Dashboard

Grid of agent status cards showing real-time state.

```
┌──────────────────────────────────────────┐
│  Agents              6 active / 0 idle   │
│──────────────────────────────────────────│
│                                          │
│  ┌─────────────────┐ ┌─────────────────┐ │
│  │ 🟢 Claude Code  │ │ 🟢 Cowork      │ │
│  │                 │ │                 │ │
│  │ Refactoring     │ │ Building PWA    │ │
│  │ auth module     │ │ shell           │ │
│  │                 │ │                 │ │
│  │ Tasks: 3 done   │ │ Tasks: 2 done   │ │
│  │ ♥ 30s ago       │ │ ♥ 15s ago       │ │
│  └─────────────────┘ └─────────────────┘ │
│                                          │
│  ┌─────────────────┐ ┌─────────────────┐ │
│  │ 🟢 Codex        │ │ 🟡 ChatGPT     │ │
│  │                 │ │                 │ │
│  │ Creating PR     │ │ Researching     │ │
│  │ #47             │ │ auth patterns   │ │
│  │                 │ │                 │ │
│  │ Tasks: 5 done   │ │ Tasks: 1 done   │ │
│  │ ♥ 45s ago       │ │ ♥ 2m ago        │ │
│  └─────────────────┘ └─────────────────┘ │
│                                          │
│  ┌─────────────────┐ ┌─────────────────┐ │
│  │ 🟢 Antigravity  │ │ 🟢 Excel       │ │
│  │                 │ │                 │ │
│  │ Building UI     │ │ Updating        │ │
│  │ components      │ │ financial model │ │
│  │                 │ │                 │ │
│  │ Tasks: 4 done   │ │ Tasks: 2 done   │ │
│  │ ♥ 20s ago       │ │ ♥ 10s ago       │ │
│  └─────────────────┘ └─────────────────┘ │
│                                          │
│  ─── Metrics ────────────────────────    │
│  Pending: 3  │  Approved: 15  │  Avg: 22s│
└──────────────────────────────────────────┘
```

**Agent Card States:**
- 🟢 Green ring — Active, heartbeat within 60s
- 🟡 Yellow ring — Busy, heartbeat within 60s but high load
- 🔴 Red ring — Offline, no heartbeat for 3+ minutes
- ⚪ Gray ring — Idle, registered but no active tasks

### 3.5 Memory Explorer

Searchable, filterable view of the shared memory table.

```
┌──────────────────────────────────────────┐
│  Memory                    145 entries   │
│──────────────────────────────────────────│
│                                          │
│  🔍 Search memory...                    │
│                                          │
│  [codebase] [project] [decision] [all]  │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ api:auth:strategy               │    │
│  │ JWT with refresh tokens         │    │
│  │ claude-code · 0.95 · 2h ago     │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ api:auth:session                │    │
│  │ Deprecated in favor of JWT      │    │
│  │ claude-code · 0.80 · 1h ago     │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ ⚠️ project:db:schema-version     │    │
│  │ CONFLICT — 2 agents disagree    │    │
│  │ Tap to resolve                  │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### 3.6 Task Board

Kanban-style horizontal scrolling board.

```
┌──────────────────────────────────────────────────────┐
│  Tasks                                               │
│──────────────────────────────────────────────────────│
│                                                      │
│  Pending    │  In Progress  │  Blocked  │  Done      │
│  ─────────  │  ───────────  │  ───────  │  ────      │
│  ┌───────┐  │  ┌─────────┐  │  ┌─────┐  │  ┌────┐   │
│  │Build  │  │  │Refactor │  │  │Wait │  │  │Auth│   │
│  │landing│  │  │auth     │  │  │for  │  │  │done│   │
│  │page   │  │  │→ code   │  │  │auth │  │  │    │   │
│  └───────┘  │  └─────────┘  │  └─────┘  │  └────┘   │
│  ┌───────┐  │  ┌─────────┐  │           │  ┌────┐   │
│  │Write  │  │  │Update   │  │           │  │API │   │
│  │tests  │  │  │budget   │  │           │  │spec│   │
│  │       │  │  │→ excel  │  │           │  │done│   │
│  └───────┘  │  └─────────┘  │           │  └────┘   │
└──────────────────────────────────────────────────────┘
```

### 3.7 Conflict Resolver

Side-by-side comparison when two agents disagree.

```
┌──────────────────────────────────────────┐
│  ⚠️ Memory Conflict                      │
│──────────────────────────────────────────│
│                                          │
│  Key: project:db:schema-version          │
│                                          │
│  ┌─────────────┐  ┌─────────────┐       │
│  │ claude-code  │  │ codex       │       │
│  │             │  │             │       │
│  │ v3.2.0     │  │ v3.1.0     │       │
│  │ conf: 0.9  │  │ conf: 0.9  │       │
│  │ 30m ago    │  │ 45m ago    │       │
│  └─────────────┘  └─────────────┘       │
│                                          │
│  [Pick Left]  [Pick Right]  [Custom]    │
└──────────────────────────────────────────┘
```

---

## 4. Navigation

### 4.1 Bottom Tab Bar

Fixed at the bottom of every screen. Three primary tabs plus overflow.

```
┌──────────────────────────────────────────┐
│  [📋 Queue (3)]  [🤖 Agents]  [🧠 Memory]│
└──────────────────────────────────────────┘
```

- **Queue** — Shows badge count of pending approvals
- **Agents** — Shows dot indicator if any agent is offline
- **Memory** — Shows dot indicator if there's an unresolved conflict

### 4.2 Pull-to-Refresh

All list views support pull-to-refresh. Also auto-refresh via Supabase Realtime subscriptions.

### 4.3 Deep Links

Push notifications link directly to the relevant screen:
- New approval → `/approval/[id]`
- Agent offline → `/agents`
- Memory conflict → `/conflict/[id]`

---

## 5. Push Notification Specs

| Event | Title | Body | Priority | Deep Link |
|---|---|---|---|---|
| New high/critical approval | `🔴 High Risk: {title}` | `{agent_name} needs approval` | High | `/approval/[id]` |
| New medium approval | `🟡 {title}` | `{agent_name} · {files} files changed` | Normal | `/approval/[id]` |
| New low approval (batched) | `📋 {count} new approvals` | `{count} low-risk items waiting` | Low | `/batch` |
| Agent offline | `🔴 {agent_name} is offline` | `No heartbeat for 3 minutes` | High | `/agents` |
| Memory conflict | `⚠️ Conflict: {key}` | `{agent1} vs {agent2}` | Normal | `/conflict/[id]` |
| Task failed | `❌ Task failed: {title}` | `{agent_name} · {outcome}` | High | `/tasks` |
| Approval expiring | `⏰ Expiring: {title}` | `Auto-reject in 5 minutes` | High | `/approval/[id]` |

---

## 6. Offline Behavior

### 6.1 PWA Service Worker

- Cache approval queue on last fetch
- Cache agent dashboard state
- Queue decisions made offline (stored in IndexedDB)
- Sync decisions when connectivity returns
- Show "Offline" banner at top of screen

### 6.2 Offline Decision Queue

```json
{
  "offline_decisions": [
    {
      "approval_id": "uuid",
      "decision": "approved",
      "decided_at": "ISO 8601 (local)",
      "synced": false
    }
  ]
}
```

On reconnect, all offline decisions are submitted in order. If a decision conflicts with a server-side change (e.g., approval expired), the user is notified.

---

## 7. Performance Targets

| Metric | Target |
|---|---|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 2.5s |
| Approval card render | < 100ms |
| Realtime event to UI update | < 500ms |
| Offline queue sync | < 3s on reconnect |
| App size (installed PWA) | < 2MB |

---

## 8. Accessibility

- All interactive elements have minimum 44×44px touch targets
- Risk badges use both color and text labels (not color alone)
- Swipe gestures have button alternatives
- Supports system dark mode
- All text meets WCAG AA contrast ratios
- Screen reader labels on all icons and action buttons

---

## 9. Design Tokens

```css
/* Colors */
--color-approve: #10B981;    /* Green */
--color-reject: #EF4444;     /* Red */
--color-modify: #3B82F6;     /* Blue */
--color-risk-low: #10B981;
--color-risk-medium: #F59E0B;
--color-risk-high: #F97316;
--color-risk-critical: #EF4444;
--color-bg-primary: #FFFFFF;
--color-bg-secondary: #F9FAFB;
--color-text-primary: #111827;
--color-text-secondary: #6B7280;

/* Typography */
--font-family: 'Inter', -apple-system, system-ui, sans-serif;
--font-size-title: 18px;
--font-size-body: 16px;
--font-size-caption: 14px;
--font-size-badge: 12px;

/* Spacing */
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;

/* Card */
--card-border-radius: 12px;
--card-padding: 16px;
--card-shadow: 0 1px 3px rgba(0,0,0,0.1);

/* Animation */
--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
--swipe-threshold: 100px;
```

---

## 10. Dark Mode

All screens support system-level dark mode toggle.

```css
/* Dark mode overrides */
--color-bg-primary: #111827;
--color-bg-secondary: #1F2937;
--color-text-primary: #F9FAFB;
--color-text-secondary: #9CA3AF;
--card-shadow: 0 1px 3px rgba(0,0,0,0.3);
```

---

## 11. File Structure (Next.js)

```
mobile-pwa/
├── app/
│   ├── layout.tsx              (root layout with bottom nav)
│   ├── page.tsx                (queue feed — home screen)
│   ├── approval/
│   │   └── [id]/page.tsx       (card detail view)
│   ├── batch/
│   │   └── page.tsx            (batch select mode)
│   ├── agents/
│   │   └── page.tsx            (agent dashboard)
│   ├── memory/
│   │   └── page.tsx            (memory explorer)
│   ├── tasks/
│   │   └── page.tsx            (task board)
│   ├── conflict/
│   │   └── [id]/page.tsx       (conflict resolver)
│   └── settings/
│       └── page.tsx            (settings & auto-approve rules)
├── components/
│   ├── ApprovalCard.tsx
│   ├── RiskBadge.tsx
│   ├── DiffViewer.tsx
│   ├── AgentCard.tsx
│   ├── MemoryEntry.tsx
│   ├── TaskColumn.tsx
│   ├── BottomNav.tsx
│   ├── ConflictCompare.tsx
│   └── OfflineBanner.tsx
├── lib/
│   ├── supabase.ts             (client init + auth)
│   ├── realtime.ts             (subscription hooks)
│   ├── offline.ts              (IndexedDB + sync logic)
│   └── notifications.ts       (push notification setup)
├── public/
│   ├── manifest.json           (PWA manifest)
│   ├── sw.js                   (service worker)
│   └── icons/                  (agent icons, app icons)
├── styles/
│   └── globals.css             (design tokens + tailwind config)
├── next.config.js
├── tailwind.config.js
└── package.json
```
