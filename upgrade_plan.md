# PIP Agent Frontend UX Upgrade Plan

## 🎯 Executive Summary

After thorough analysis and feedback review, this plan focuses on **4 surgical improvements** that reuse existing components and deliver immediate UX wins without adding complexity.

**Core Problem**: Users lack a unified view of overall pipeline progress and have no operational controls (cancel/retry) during long runs.

**Solution**: Add a single unified status header, operational controls, error recovery guidance, and minimal theming - all built on existing primitives.

---

## ✅ Phase 1: Unified Status Header [PRIORITY: CRITICAL]

**Goal**: Add a single source of truth for pipeline status that aggregates all existing signals.

### Implementation Tasks

- [ ] Add `computeOverallProgress()` helper to page.tsx using weighted blend:
  - Transcribe: 50% weight (chunks.processed/total or success)
  - Draft: 25% weight (0→0.4→1 based on streaming status)
  - Review: 15% weight (rounds completed/max)
  - Export: 10% weight (0→0.5→1)

- [ ] Create `StatusDashboard` component (apps/ui/components/StatusDashboard.tsx):
  - [ ] Overall progress ring (reuse existing ProgressRing styles)
  - [ ] Current step display with elapsed time
  - [ ] Mini status pills for all 4 stages
  - [ ] Persistent error banner when any step fails
  - [ ] Action buttons area for Cancel/Retry

- [ ] Integrate StatusDashboard into page.tsx:
  - [ ] Place above stepper, below header
  - [ ] Wire up overall progress calculation
  - [ ] Connect to existing state (steps, chunks, reviewRounds, etc.)

### Files to Modify
- `apps/ui/app/page.tsx` - Add helper, integrate component
- `apps/ui/components/StatusDashboard.tsx` - NEW (150 lines max)

---

## ✅ Phase 2: Operational Controls [PRIORITY: HIGH]

**Goal**: Give users control over long-running operations.

### Cancel Functionality

- [ ] Add abort route (apps/ui/app/api/run/[runId]/abort/route.ts):
  - [ ] Call runStore.abort(runId) or set status to 'aborted'
  - [ ] Return success/error JSON response

- [ ] Restore runId state tracking in page.tsx:
  - [ ] Add `const [runId, setRunId] = useState<string | null>(null)`
  - [ ] Set runId after successful run creation
  - [ ] Clear runId on reset

- [ ] Add `handleCancelRun` function:
  - [ ] POST to /api/run/[runId]/abort
  - [ ] Show toast confirmation
  - [ ] Update UI state

### Retry Functionality

- [ ] Add retry handler that reuses `startRun()` with same inputs
- [ ] Only show when !running && hasError
- [ ] Clear previous error state before retrying

### SSE Reconnection & Resync

- [ ] Add `onerror` handler to EventSource:
  - [ ] Log network error
  - [ ] Attempt resync via /api/dev/runs/[runId]
  - [ ] Update state with snapshot data

- [ ] Handle connection drops gracefully:
  - [ ] Show "Connection lost, resyncing..." toast
  - [ ] Restore state from snapshot
  - [ ] Resume event listening

### Files to Modify
- `apps/ui/app/page.tsx` - Add cancel/retry handlers, runId state
- `apps/ui/app/api/run/[runId]/abort/route.ts` - NEW (20 lines)
- `src/server/runStore.ts` - Verify abort() method exists

---

## ✅ Phase 3: Error Recovery Guidance [PRIORITY: HIGH]

**Goal**: When errors occur, provide actionable guidance instead of just status badges.

### Error Panel Implementation

- [ ] Add contextual error guidance to StepCard component:
  - [ ] Show when status === "error"
  - [ ] Include likely causes based on step type
  - [ ] Provide actionable fixes

- [ ] Error guidance content by step:
  - [ ] **Transcribe**: File not found, unsupported format, API limits
  - [ ] **Draft**: Token limits, prompt issues, API key problems
  - [ ] **Review**: Policy violations, configuration issues
  - [ ] **Export**: Template errors, output path issues

- [ ] Add inline validation messages to form inputs:
  - [ ] Show under each input field
  - [ ] Use existing `kpiHint` styles
  - [ ] Complement (not replace) toast notifications

### Files to Modify
- `apps/ui/app/page.tsx` - Add error panels to StepDetailPanel components

---

## ✅ Phase 4: Minimal Theming & Dark Mode [PRIORITY: MEDIUM]

**Goal**: Introduce CSS variables for colors and add dark mode support without rewriting styles.

### CSS Variable Implementation

- [ ] Add token definitions to styles.module.css:
  ```css
  :root {
    --bg: #ffffff;
    --text: #0b1221;
    --muted: #5b6478;
    --surface: #ffffff;
    --border: #e5e7eb;
    --primary: #0ea5e9;
    --success: #22c55e;
    --danger: #ef4444;
  }
  ```

- [ ] Add dark mode overrides:
  ```css
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1120;
      --text: #e5e7eb;
      --surface: #111827;
      /* etc */
    }
  }
  ```

- [ ] Gradually replace hard-coded colors:
  - [ ] Start with high-surface areas (.page, .card, .step)
  - [ ] Update text colors to use var(--text)
  - [ ] Update backgrounds to use var(--bg) and var(--surface)
  - [ ] Leave detailed colors for later phases

### Files to Modify
- `apps/ui/app/styles.module.css` - Add variables, update key classes

---

## 📊 Success Metrics

### Immediate (Phase 1-2)
- [ ] Users can see overall pipeline progress at a glance
- [ ] Users can cancel long-running operations
- [ ] Failed runs can be retried without re-entering data
- [ ] Connection drops don't lose progress visibility

### Short-term (Phase 3-4)
- [ ] Error messages include actionable fixes
- [ ] Dark mode works automatically based on system preference
- [ ] Form validation is visible inline
- [ ] All status information is in one place

---

## 🚫 Explicitly NOT Doing (Yet)

These items from the original plan are postponed to avoid scope creep:

- ❌ Creating new component families (StepperV2, ActivityStream, ProgressTracker)
- ❌ Historical ETA calculations based on past runs
- ❌ Breadcrumb navigation
- ❌ Skeleton loaders
- ❌ Full activity stream with filters
- ❌ Keyboard shortcuts
- ❌ Sparkline charts
- ❌ Virtual scrolling
- ❌ Complete style system rewrite

---

## 🛠 Implementation Order

1. **Week 1**: Phase 1 (Unified Status Header) + Phase 2 (Cancel/Retry)
   - Biggest impact on user confusion
   - Relatively simple implementation
   - Builds on existing components

2. **Week 2**: Phase 2 (SSE Reconnection) + Phase 3 (Error Guidance)
   - Improves reliability
   - Reduces support burden
   - Clear user value

3. **Week 3**: Phase 4 (Theming/Dark Mode) + Testing
   - Visual polish
   - Accessibility improvement
   - Non-breaking changes

---

## 🧹 Quick Wins & Cleanup

While implementing the main phases, include these small improvements:

- [ ] Centralize shared types/helpers in `apps/ui/lib/`
- [ ] Use `components/shared/ActivityTimeline.tsx` consistently
- [ ] Verify download API path traversal protection
- [ ] Remove duplicate code between main and dev pages
- [ ] Add proper TypeScript types for all event payloads

---

## ✅ Testing Checklist

### Functional Tests
- [ ] Start run → header shows 0→100% progress
- [ ] Cancel mid-run → pipeline stops, UI unlocks
- [ ] Force error → error banner appears with guidance
- [ ] Retry after error → run restarts with same inputs
- [ ] SSE drops → reconnection triggers, progress preserved

### Visual Tests
- [ ] Dark mode renders all text legibly
- [ ] Progress rings animate smoothly
- [ ] Status pills have sufficient contrast
- [ ] Error states are clearly visible
- [ ] Mobile responsive layout works

---

## 📝 Notes

- All changes build on existing components - no rewrites needed
- Each phase can be deployed independently
- Focus is on operational visibility and control
- Design system expansion comes after core UX fixes

---

*Last Updated: [Current Date]*
*Status: Ready for Implementation*