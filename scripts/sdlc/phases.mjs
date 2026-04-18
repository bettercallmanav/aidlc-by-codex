export const PHASES = [
  {
    id: "discovery",
    dir: "discovery",
    label: "Discovery",
    objective: "Turn rough project input into structured requirements and readiness signals.",
    deliverables: ["requirements.md", "discovery-summary.json"],
    reads: [],
  },
  {
    id: "architecture",
    dir: "architecture",
    label: "Architecture",
    objective: "Translate approved requirements into architecture, module boundaries, and technical tradeoffs.",
    deliverables: ["architecture.md", "architecture-diagram.md", "architecture.json"],
    reads: ["discovery/requirements.md", "discovery/discovery-summary.json"],
  },
  {
    id: "journey",
    dir: "journeys",
    label: "Journey",
    objective: "Map user and admin flows into screens, navigation, and edge cases.",
    deliverables: ["user-journeys.md", "screens-list.md", "journeys.json"],
    reads: ["discovery/requirements.md", "architecture/architecture.md", "architecture/architecture.json"],
  },
  {
    id: "wireframe",
    dir: "wireframes",
    label: "Wireframe",
    objective: "Turn journeys into screen structure, component inventory, and UI planning notes.",
    deliverables: ["wireframes.md", "components.md", "wireframe-spec.json"],
    reads: ["journeys/user-journeys.md", "journeys/screens-list.md", "architecture/architecture.md"],
  },
  {
    id: "coder",
    dir: "coder",
    label: "Coder",
    objective: "Implement or scaffold the codebase based on approved planning artifacts.",
    deliverables: ["implementation-summary.md", "code-map.json"],
    reads: [
      "architecture/architecture.md",
      "architecture/architecture.json",
      "journeys/screens-list.md",
      "wireframes/components.md",
      "wireframes/wireframe-spec.json",
    ],
  },
  {
    id: "testing",
    dir: "testing",
    label: "Testing",
    objective: "Validate implementation quality, test coverage, and requirement alignment.",
    deliverables: ["test-plan.md", "test-results.md", "qa-summary.json"],
    reads: ["discovery/requirements.md", "journeys/user-journeys.md", "coder/implementation-summary.md", "coder/code-map.json"],
  },
  {
    id: "devops",
    dir: "devops",
    label: "DevOps",
    objective: "Prepare deployment, environment setup, CI/CD, and operational readiness guidance.",
    deliverables: ["deployment-guide.md", "infrastructure.md", "devops-summary.json"],
    reads: ["architecture/architecture.md", "testing/qa-summary.json", "coder/code-map.json"],
  },
  {
    id: "handover",
    dir: "handover",
    label: "Handover",
    objective: "Package the project into client-facing and developer-facing handover docs.",
    deliverables: [
      "client-handover.md",
      "developer-guide.md",
      "credentials-and-access.md",
      "future-roadmap.md",
    ],
    reads: [
      "discovery/requirements.md",
      "architecture/architecture.md",
      "journeys/user-journeys.md",
      "wireframes/wireframes.md",
      "coder/implementation-summary.md",
      "testing/test-results.md",
      "devops/deployment-guide.md",
    ],
  },
];

export const PHASE_INDEX = Object.fromEntries(PHASES.map((phase, index) => [phase.id, index]));

export function getPhase(phaseId) {
  return PHASES.find((phase) => phase.id === phaseId) ?? null;
}

export function getNextPhaseId(phaseId) {
  const index = PHASE_INDEX[phaseId];
  if (index === undefined) {
    return null;
  }
  return PHASES[index + 1]?.id ?? null;
}
