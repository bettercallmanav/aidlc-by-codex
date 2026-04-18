# Codex Agent Build Brief

## Goal
Build a multi-phase AI SDLC orchestrator that takes a software project from rough brief to delivery-ready handover through gated specialist phases.

This system should feel like a serious agent workflow, not a generic chatbot. Each phase should produce artifacts, hand off structured context to the next phase, and pause for approval before moving forward.

## Core Product Idea
A user provides a rough brief, PRD, notes, transcript, or existing codebase context.

The system runs a phase-based chain:

`Discovery -> Architecture -> Journey -> Wireframe -> Coder -> Testing -> DevOps -> Handover`

Each phase has:
- a focused responsibility
- structured outputs
- a handoff contract
- approval gates
- stored artifacts

## Product Positioning
### One-line pitch
A multi-agent SDLC orchestration system that turns vague software inputs into structured requirements, architecture, implementation artifacts, testing outputs, deployment guidance, and handover docs.

### Category fit
- Primary: Domain Agents
- Secondary: Agentic Coding
- Supporting: Building Evals

## Design Principles
- Keep everything in one project workflow
- Use gated transitions between phases
- Make every phase artifact-driven
- Prefer structured JSON handoffs over loose text
- Show progress clearly in the UI
- Add eval checks before major approvals
- Avoid fake autonomy claims
- Keep human approval in the loop

## SDLC Phases

### 1. Discovery
#### Goal
Turn messy input into structured project understanding.

#### Inputs
- brief
- PRD
- notes
- transcript
- existing codebase context if applicable

#### Outputs
- project summary
- goals
- user roles
- core requirements
- assumptions
- missing information
- risks
- readiness score

#### Deliverables
- `requirements.md`
- `discovery-summary.json`

#### Exit condition
User approves structured requirements.

---

### 2. Architecture
#### Goal
Translate requirements into technical design.

#### Inputs
- approved requirements
- assumptions
- open questions

#### Outputs
- architecture summary
- module breakdown
- data model
- API plan
- integration list
- infra assumptions
- tradeoffs

#### Deliverables
- `architecture.md`
- `architecture-diagram.md`
- `architecture.json`

#### Exit condition
User approves architecture direction.

---

### 3. Journey
#### Goal
Map user and admin flows from requirements and architecture.

#### Inputs
- requirements
- architecture
- roles

#### Outputs
- user journeys
- admin flows
- edge cases
- navigation structure
- role-based actions

#### Deliverables
- `user-journeys.md`
- `screens-list.md`
- `journeys.json`

#### Exit condition
User approves flow coverage.

---

### 4. Wireframe
#### Goal
Convert journeys into screen structure and UI planning.

#### Inputs
- screen list
- journeys
- module map
- edge cases

#### Outputs
- screen list with purpose
- component inventory
- layout guidance
- low-fi wireframe notes
- design system rules

#### Deliverables
- `wireframes.md`
- `components.md`
- `wireframe-spec.json`

#### Exit condition
User approves screen and component direction.

---

### 5. Coder
#### Goal
Generate implementation scaffolding and build artifacts.

#### Inputs
- architecture outputs
- API plan
- data model
- UI screen specs
- component inventory

#### Outputs
- repo structure
- folder and file plan
- starter code
- routes
- schema draft
- shared types
- setup notes

#### Deliverables
- generated code
- `implementation-summary.md`
- `code-map.json`

#### Exit condition
User approves implementation baseline.

---

### 6. Testing
#### Goal
Validate implementation quality and requirement coverage.

#### Inputs
- requirements
- journeys
- code map
- generated implementation

#### Outputs
- test plan
- test cases
- acceptance coverage
- missing coverage areas
- risk hotspots
- test results

#### Deliverables
- `test-plan.md`
- `test-results.md`
- `qa-summary.json`

#### Exit condition
User approves testing status.

---

### 7. DevOps
#### Goal
Prepare deployment and operational readiness.

#### Inputs
- architecture
- codebase structure
- integrations
- QA summary

#### Outputs
- deployment approach
- environment config list
- CI/CD guidance
- hosting recommendation
- monitoring checklist
- scaling notes

#### Deliverables
- `deployment-guide.md`
- `infrastructure.md`
- `devops-summary.json`

#### Exit condition
User approves delivery readiness.

---

### 8. Handover
#### Goal
Package everything into client-facing and developer-facing delivery docs.

#### Inputs
- all previous outputs
- unresolved items
- deployment notes
- QA summary

#### Outputs
- handover summary
- completed work
- pending work
- blockers
- next steps
- future roadmap
- documentation pack

#### Deliverables
- `client-handover.md`
- `developer-guide.md`
- `credentials-and-access.md`
- `future-roadmap.md`
- updated `README.md`

#### Exit condition
Workflow marked complete.

## Common Handoff Contract
Every phase should return this structure:

```json
{
  "summary": "",
  "artifacts": [],
  "assumptions": [],
  "risks": [],
  "open_questions": [],
  "next_input": {}
}
```

## Orchestration Rules
- Only one phase is active at a time
- A phase cannot advance without explicit approval
- Each phase writes artifacts before exit
- The next phase receives a synthetic handoff payload
- Status should be persisted in a workflow state file
- All outputs should remain inspectable in the UI

## Eval Layer
Add evaluation checks before major approvals.

### Suggested eval points
- Discovery: missing requirements, ambiguity, unclear assumptions
- Architecture: missing modules, incomplete APIs, weak tradeoff logic
- Coder: implementation coverage vs requirements
- Testing: gaps in test coverage and edge cases
- DevOps: missing deployment assumptions, config risks

### Eval outputs
- warnings
- blockers
- pass/fail checks
- confidence score
- suggested fixes

## UI Pages
### 1. Project Intake
- paste brief
- upload docs
- choose new project vs existing codebase

### 2. Pipeline Dashboard
- show all phases
- show active phase
- show approval state
- show warnings

### 3. Artifact Viewer
- per-phase artifacts
- markdown/doc viewer
- structured JSON viewer

### 4. Review and Approval Panel
- phase summary
- risk list
- open questions
- approve or send back

### 5. Eval Panel
- coverage checks
- blockers
- warnings
- improvement suggestions

## Technical Build Direction
### Frontend
- Next.js
- TypeScript
- component-based UI

### Backend
- orchestration layer for agent routing and phase transitions
- structured artifact storage
- state persistence

### Agent Execution
- phase-specific prompts
- reusable skills/instructions
- thread or run-based execution model
- controlled handoffs

## Coding Priorities
### Must build first
1. Intake page
2. Pipeline state model
3. Discovery phase
4. Architecture phase
5. Basic handoff mechanism
6. Artifact storage
7. Approval flow

### Build next
8. Journey
9. Wireframe
10. Coder
11. Testing

### Build after that
12. DevOps
13. Handover
14. Eval overlays
15. UI polish

## Demo Story
1. Paste a rough project brief
2. Show discovery extracting structured requirements
3. Approve and move to architecture
4. Show technical design and module planning
5. Show later phases as delivery-ready progression
6. Open artifacts produced across the chain
7. Show warnings and eval checks before approval
8. End with a clean handover package

## Non-Negotiables
- Do not present this as magic full autonomy
- Do not make it a generic chat interface
- Do not overload the MVP with too many half-working features
- Do not skip approval gates
- Do not allow phases to pass loose, unstructured context only

## Final Build Goal
Ship a believable, structured, artifact-driven AI SDLC workflow that feels useful for real software delivery teams and is strong enough to demo clearly.

