import { useEffect, useState } from "react";

type ShellInfo = {
  appName: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
};

const phases = [
  {
    name: "Discovery",
    status: "Ready",
    summary: "Collect the brief, clarify scope, and generate structured requirements."
  },
  {
    name: "Architecture",
    status: "Locked",
    summary: "Translate approved requirements into modules, APIs, and infra decisions."
  },
  {
    name: "Journey",
    status: "Locked",
    summary: "Map user/admin flows, screen structure, and edge-case handling."
  },
  {
    name: "Wireframe",
    status: "Locked",
    summary: "Convert journeys into low-fi screens, component plans, and design rules."
  }
] as const;

declare global {
  interface Window {
    desktopBridge?: {
      getShellInfo: () => Promise<ShellInfo>;
    };
  }
}

export default function App() {
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null);

  useEffect(() => {
    window.desktopBridge?.getShellInfo().then(setShellInfo).catch(() => {
      setShellInfo(null);
    });
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Codex Buildathon</p>
          <h1>SDLC Orchestrator</h1>
          <p className="muted">
            Local-first desktop control plane for gated project delivery workflows.
          </p>
        </div>

        <section className="sidebar-block">
          <p className="section-label">Current project</p>
          <h2>New project workspace</h2>
          <p className="muted">No repo linked yet. Start with discovery artifacts.</p>
        </section>

        <section className="sidebar-block">
          <p className="section-label">Desktop runtime</p>
          {shellInfo ? (
            <ul className="runtime-list">
              <li>{shellInfo.appName}</li>
              <li>Electron {shellInfo.electronVersion}</li>
              <li>Node {shellInfo.nodeVersion}</li>
              <li>{shellInfo.platform}</li>
            </ul>
          ) : (
            <p className="muted">Connecting to Electron runtime...</p>
          )}
        </section>
      </aside>

      <main className="main-panel">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Phase 1 foundation</p>
            <h2>Electron shell with React renderer is wired up</h2>
          </div>
          <p className="hero-copy">
            Next steps are project creation, local workspace persistence, and a real workflow
            state machine. This screen is the initial desktop shell for the orchestrator.
          </p>
          <div className="hero-actions">
            <button type="button">Create project</button>
            <button type="button" className="secondary">
              Open workspace
            </button>
          </div>
        </section>

        <section className="panel-grid">
          <article className="panel">
            <div className="panel-header">
              <p className="section-label">Pipeline</p>
              <span className="pill">4 phases seeded</span>
            </div>
            <div className="phase-list">
              {phases.map((phase) => (
                <div key={phase.name} className="phase-card">
                  <div className="phase-topline">
                    <h3>{phase.name}</h3>
                    <span className={`status status-${phase.status.toLowerCase()}`}>
                      {phase.status}
                    </span>
                  </div>
                  <p>{phase.summary}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <p className="section-label">Planned modules</p>
              <span className="pill">MVP</span>
            </div>
            <ul className="feature-list">
              <li>Project intake and workspace creation</li>
              <li>Workflow state persisted locally</li>
              <li>Codex execution bridge in Electron main process</li>
              <li>Artifact viewer for markdown and JSON outputs</li>
              <li>Approval panel with phase gating</li>
            </ul>
          </article>
        </section>
      </main>
    </div>
  );
}
