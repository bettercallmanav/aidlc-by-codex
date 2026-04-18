import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import readline from "node:readline"
import {
  getPhaseDefinition,
  getNextPhaseId,
  getPhasePrompt,
  getSupplementalAgentDefinition,
  getSupplementalAgentPrompt,
  type PhaseId,
  type ProjectType as CodexProjectType,
  type SupplementalAgentId,
  type WorkflowMode as CodexWorkflowMode
} from "./sdlc-phases.js"

type CodexConversationSeed = {
  conversationId: string
  rolloutPath: string | null
}

type CodexTurnInput = {
  projectId: string
  sessionId: string
  body: string
  cwd: string
  projectName: string
  projectType: CodexProjectType
  workflowMode: CodexWorkflowMode
  activePhaseId: PhaseId | null
  activePhaseName: string | null
  effectiveAgentPhaseId: PhaseId | null
  effectiveAgentName: string | null
  selectedAgentId: "auto" | "workspace" | PhaseId | SupplementalAgentId
  selectedModel: string | null
  activeArtifactPath: string | null
  conversationId: string | null
  rolloutPath: string | null
}

type CodexTurnResult = {
  assistantText: string
  conversationId: string
  rolloutPath: string | null
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type PendingTurn = {
  resolve: (value: CodexTurnResult) => void
  reject: (error: Error) => void
  assistantText: string
  rolloutPath: string | null
  projectId: string
  sessionId: string
}

type HandoffSessionPayload = {
  id: string
  projectId: string
  title: string
  titleSource: string
  kind: string
  status: string
  summary: string
  preview: string
  selectedModel: string | null
  selectedAgentId: string
  createdAt: string
  updatedAt: string
}

export type CodexChatEvent =
  | {
      projectId: string
      sessionId: string
      type: "handoff_started"
      phaseId: string
      session: HandoffSessionPayload
    }
  | {
      projectId: string
      sessionId: string
      type: "turn_started"
    }
  | {
      projectId: string
      sessionId: string
      type: "assistant_delta"
      delta: string
    }
  | {
      projectId: string
      sessionId: string
      type: "command_started"
      command: string
      cwd?: string
    }
  | {
      projectId: string
      sessionId: string
      type: "command_output"
      text: string
    }
  | {
      projectId: string
      sessionId: string
      type: "command_completed"
      command: string
      exitCode: number | null
    }
  | {
      projectId: string
      sessionId: string
      type: "file_change"
      summary: string
    }
  | {
      projectId: string
      sessionId: string
      type: "tool_started"
      tool: string
    }
  | {
      projectId: string
      sessionId: string
      type: "tool_completed"
      tool: string
    }
  | {
      projectId: string
      sessionId: string
      type: "turn_completed"
    }
  | {
      projectId: string
      sessionId: string
      type: "interrupted"
      reason?: string
    }
  | {
      projectId: string
      sessionId: string
      type: "error"
      message: string
    }

type JsonRpcResponse = {
  id: string | number
  result?: unknown
  error?: {
    message?: string
  }
}

type JsonRpcNotification = {
  method?: string
  params?: Record<string, unknown>
  id?: string | number
}

const clientInfo = {
  name: "aidlc-by-codex",
  version: "0.1.0"
}

const codexEvents = new EventEmitter()

export const emitCodexUiEvent = (event: CodexChatEvent) => {
  codexEvents.emit("event", event)
}

class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private requests = new Map<string | number, PendingRequest>()
  private nextRequestId = 1
  private initialized = false
  private loadedConversations = new Set<string>()
  private conversationSubscriptions = new Map<string, string>()
  private pendingTurns = new Map<string, PendingTurn>()
  private stderrBuffer = ""

  private emit(event: CodexChatEvent) {
    emitCodexUiEvent(event)
  }

  private async ensureStarted() {
    if (this.process && this.initialized) {
      return
    }

    if (!this.process) {
      this.process = spawn("codex", ["app-server"], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"]
      })

      const rl = readline.createInterface({ input: this.process.stdout })
      rl.on("line", (line) => this.handleLine(line))

      this.process.stderr.on("data", (chunk) => {
        this.stderrBuffer = `${this.stderrBuffer}${chunk.toString()}`.slice(-8000)
      })

      this.process.on("exit", (code, signal) => {
        const error = new Error(
          `Codex App Server exited unexpectedly${code !== null ? ` with code ${code}` : ""}${
            signal ? ` (signal ${signal})` : ""
          }.`
        )
        this.process = null
        this.initialized = false
        this.loadedConversations.clear()
        this.conversationSubscriptions.clear()

        for (const pending of this.requests.values()) {
          pending.reject(error)
        }
        this.requests.clear()

        for (const turn of this.pendingTurns.values()) {
          this.emit({
            projectId: turn.projectId,
            sessionId: turn.sessionId,
            type: "error",
            message: error.message
          })
          turn.reject(error)
        }
        this.pendingTurns.clear()
      })
    }

    await this.request("initialize", {
      clientInfo
    })

    this.notify("initialized")
    this.initialized = true
  }

  private handleLine(line: string) {
    if (!line.trim()) {
      return
    }

    let parsed: JsonRpcResponse | JsonRpcNotification

    try {
      parsed = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification
    } catch {
      return
    }

    if ("id" in parsed && parsed.id !== undefined && ("result" in parsed || "error" in parsed)) {
      const pending = this.requests.get(parsed.id)

      if (!pending) {
        return
      }

      this.requests.delete(parsed.id)

      if (parsed.error) {
        pending.reject(
          new Error(
            parsed.error.message ||
              `Codex App Server request failed${this.stderrBuffer ? `: ${this.stderrBuffer}` : "."}`
          )
        )
        return
      }

      pending.resolve(parsed.result)
      return
    }

    if ("id" in parsed && parsed.id !== undefined && "method" in parsed) {
      this.respondToServerRequest(parsed)
      return
    }

    this.handleNotification(parsed)
  }

  private respondToServerRequest(message: JsonRpcNotification) {
    if (!this.process || message.id === undefined || !message.method) {
      return
    }

    let result: unknown = {}

    if (message.method === "execCommandApproval") {
      result = { approved: false }
    } else if (message.method === "applyPatchApproval") {
      result = { approved: false }
    } else if (message.method === "item/commandExecution/requestApproval") {
      result = { approved: false }
    } else if (message.method === "item/fileChange/requestApproval") {
      result = { approved: false }
    }

    this.process.stdin.write(JSON.stringify({ id: message.id, result }) + "\n")
  }

  private handleNotification(message: JsonRpcNotification) {
    if (!message.method) {
      return
    }

    const params = (message.params ?? {}) as Record<string, unknown>

    if (message.method === "item/agentMessage/delta") {
      const threadId = typeof params.threadId === "string" ? params.threadId : null
      const delta = typeof params.delta === "string" ? params.delta : ""

      if (threadId && delta) {
        const pendingTurn = this.pendingTurns.get(threadId)

        if (pendingTurn) {
          pendingTurn.assistantText += delta
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "assistant_delta",
            delta
          })
        }
      }

      return
    }

    if (message.method === "codex/event/task_started" || message.method === "turn/started") {
      const conversationId =
        typeof params.conversationId === "string"
          ? params.conversationId
          : typeof params.threadId === "string"
            ? params.threadId
            : null

      if (conversationId) {
        const pendingTurn = this.pendingTurns.get(conversationId)

        if (pendingTurn) {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "turn_started"
          })
        }
      }

      return
    }

    if (message.method === "codex/event/agent_message") {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId : null
      const msg = params.msg as Record<string, unknown> | undefined
      const fullMessage = typeof msg?.message === "string" ? msg.message : null

      if (conversationId && fullMessage !== null) {
        const pendingTurn = this.pendingTurns.get(conversationId)

        if (pendingTurn) {
          pendingTurn.assistantText = fullMessage
        }
      }

      return
    }

    if (message.method === "codex/event/exec_command_begin") {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId : null
      const msg = params.msg as
        | { command?: unknown; cwd?: unknown }
        | undefined

      if (conversationId) {
        const pendingTurn = this.pendingTurns.get(conversationId)
        const command = Array.isArray(msg?.command) ? msg.command.join(" ") : "command"

        if (pendingTurn) {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_started",
            command,
            cwd: typeof msg?.cwd === "string" ? msg.cwd : undefined
          })
        }
      }

      return
    }

    if (message.method === "codex/event/exec_command_output_delta") {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId : null
      const msg = params.msg as { chunk?: unknown } | undefined

      if (conversationId) {
        const pendingTurn = this.pendingTurns.get(conversationId)
        const text = typeof msg?.chunk === "string" ? msg.chunk : ""

        if (pendingTurn && text) {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_output",
            text
          })
        }
      }

      return
    }

    if (message.method === "item/commandExecution/outputDelta") {
      const threadId = typeof params.threadId === "string" ? params.threadId : null
      const text = typeof params.delta === "string" ? params.delta : ""

      if (threadId) {
        const pendingTurn = this.pendingTurns.get(threadId)

        if (pendingTurn && text) {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_output",
            text
          })
        }
      }

      return
    }

    if (message.method === "codex/event/exec_command_end") {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId : null
      const msg = params.msg as
        | { command?: unknown; exit_code?: unknown }
        | undefined

      if (conversationId) {
        const pendingTurn = this.pendingTurns.get(conversationId)
        const command = Array.isArray(msg?.command) ? msg.command.join(" ") : "command"
        const exitCode = typeof msg?.exit_code === "number" ? msg.exit_code : null

        if (pendingTurn) {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_completed",
            command,
            exitCode
          })
        }
      }

      return
    }

    if (message.method === "item/started" || message.method === "item/completed") {
      const threadId = typeof params.threadId === "string" ? params.threadId : null
      const item = params.item as { type?: unknown; command?: unknown; cwd?: unknown; tool?: unknown; server?: unknown; changes?: unknown } | undefined

      if (!threadId) {
        return
      }

      const pendingTurn = this.pendingTurns.get(threadId)

      if (!pendingTurn || !item?.type) {
        return
      }

      if (item.type === "commandExecution") {
        const command = typeof item.command === "string" ? item.command : "command"

        if (message.method === "item/started") {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_started",
            command,
            cwd: typeof item.cwd === "string" ? item.cwd : undefined
          })
        } else {
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "command_completed",
            command,
            exitCode:
              typeof (item as { exitCode?: unknown }).exitCode === "number"
                ? ((item as { exitCode?: number }).exitCode ?? null)
                : null
          })
        }

        return
      }

      if (item.type === "fileChange" && message.method === "item/completed") {
        const changes = Array.isArray(item.changes) ? item.changes.length : 0
        this.emit({
          projectId: pendingTurn.projectId,
          sessionId: pendingTurn.sessionId,
          type: "file_change",
          summary: changes > 0 ? `${changes} file change${changes === 1 ? "" : "s"} applied` : "File changes applied"
        })
        return
      }

      if (item.type === "mcpToolCall") {
        const toolName =
          typeof item.tool === "string"
            ? typeof item.server === "string"
              ? `${item.server}:${item.tool}`
              : item.tool
            : "tool"
        this.emit({
          projectId: pendingTurn.projectId,
          sessionId: pendingTurn.sessionId,
          type: message.method === "item/started" ? "tool_started" : "tool_completed",
          tool: toolName
        })
      }

      return
    }

    if (message.method === "turn/completed") {
      const threadId = typeof params.threadId === "string" ? params.threadId : null

      if (!threadId) {
        return
      }

      const pendingTurn = this.pendingTurns.get(threadId)

      if (!pendingTurn) {
        return
      }

      this.pendingTurns.delete(threadId)
      this.emit({
        projectId: pendingTurn.projectId,
        sessionId: pendingTurn.sessionId,
        type: "turn_completed"
      })
      pendingTurn.resolve({
        assistantText: pendingTurn.assistantText.trim(),
        conversationId: threadId,
        rolloutPath: pendingTurn.rolloutPath
      })
      return
    }

    if (message.method === "codex/event/turn_aborted") {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId : null

      if (conversationId) {
        const pendingTurn = this.pendingTurns.get(conversationId)

        if (pendingTurn) {
          this.pendingTurns.delete(conversationId)
          this.emit({
            projectId: pendingTurn.projectId,
            sessionId: pendingTurn.sessionId,
            type: "interrupted"
          })
          pendingTurn.reject(new Error("Codex turn interrupted."))
        }
      }

      return
    }

    if (message.method === "error") {
      const pendingTurnEntries = [...this.pendingTurns.entries()]

      for (const [conversationId, pendingTurn] of pendingTurnEntries) {
        this.pendingTurns.delete(conversationId)
        const messageText =
          typeof (params as { message?: unknown }).message === "string"
            ? String((params as { message?: unknown }).message)
            : "Codex App Server reported an error."
        this.emit({
          projectId: pendingTurn.projectId,
          sessionId: pendingTurn.sessionId,
          type: "error",
          message: messageText
        })
        pendingTurn.reject(
          new Error(messageText)
        )
      }
    }
  }

  private request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.process) {
      return Promise.reject(new Error("Codex App Server is not running."))
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.nextRequestId++
      this.requests.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })

      this.process!.stdin.write(JSON.stringify({ id, method, params }) + "\n")
    })
  }

  private notify(method: string, params?: unknown) {
    if (!this.process) {
      return
    }

    this.process.stdin.write(JSON.stringify(params === undefined ? { method } : { method, params }) + "\n")
  }

  private async ensureConversation(input: CodexTurnInput): Promise<CodexConversationSeed> {
    await this.ensureStarted()

    let conversationId = input.conversationId
    let rolloutPath = input.rolloutPath

    if (conversationId && !this.loadedConversations.has(conversationId)) {
      try {
        const resumed = await this.request<{
          conversationId: string
          rolloutPath?: string
        }>("resumeConversation", {
          path: input.rolloutPath,
          conversationId,
          history: null,
          overrides: {
            model: input.selectedModel ?? null,
            modelProvider: null,
            profile: null,
            cwd: input.cwd,
            approvalPolicy: "never",
            sandbox: "workspace-write",
            config: null,
            baseInstructions: null,
            developerInstructions: buildDeveloperInstructions(input),
            compactPrompt: null,
            includeApplyPatchTool: null
          }
        })

        conversationId = resumed.conversationId
        rolloutPath = resumed.rolloutPath ?? rolloutPath ?? null
      } catch {
        conversationId = null
        rolloutPath = null
      }
    }

    if (!conversationId) {
      const created = await this.request<{
        conversationId: string
        rolloutPath: string
      }>("newConversation", {
        model: input.selectedModel ?? null,
        modelProvider: null,
        profile: null,
        cwd: input.cwd,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        config: null,
        baseInstructions: null,
        developerInstructions: buildDeveloperInstructions(input),
        compactPrompt: null,
        includeApplyPatchTool: null
      })

      conversationId = created.conversationId
      rolloutPath = created.rolloutPath ?? null
    }

    if (!this.conversationSubscriptions.has(conversationId)) {
      const subscription = await this.request<{ subscriptionId: string }>("addConversationListener", {
        conversationId,
        experimentalRawEvents: false
      })

      this.conversationSubscriptions.set(conversationId, subscription.subscriptionId)
    }

    this.loadedConversations.add(conversationId)

    return {
      conversationId,
      rolloutPath
    }
  }

  async sendMessage(input: CodexTurnInput): Promise<CodexTurnResult> {
    const conversation = await this.ensureConversation(input)

    const resultPromise = new Promise<CodexTurnResult>((resolve, reject) => {
      this.pendingTurns.set(conversation.conversationId, {
        resolve,
        reject,
        assistantText: "",
        rolloutPath: conversation.rolloutPath,
        projectId: input.projectId,
        sessionId: input.sessionId
      })
    })

    try {
      await this.request("sendUserMessage", {
        conversationId: conversation.conversationId,
        items: [
          {
            type: "text",
            data: {
              text: input.body,
              text_elements: []
            }
          }
        ]
      })
    } catch (error) {
      this.pendingTurns.delete(conversation.conversationId)
      throw error
    }

    const result = await resultPromise

    return {
      ...result,
      assistantText: result.assistantText || "No assistant response returned."
    }
  }

  async interruptSession(projectId: string, sessionId: string) {
    await this.ensureStarted()

    const activeTurn = [...this.pendingTurns.entries()].find(
      ([, turn]) => turn.projectId === projectId && turn.sessionId === sessionId
    )

    if (!activeTurn) {
      return false
    }

    const [conversationId, turn] = activeTurn
    this.pendingTurns.delete(conversationId)

    try {
      await this.request("interruptConversation", {
        conversationId
      })
    } catch (error) {
      turn.reject(
        error instanceof Error ? error : new Error("Unable to interrupt Codex conversation.")
      )
      throw error
    }

    this.emit({
      projectId: turn.projectId,
      sessionId: turn.sessionId,
      type: "interrupted",
      reason: "Stopped by user"
    })
    turn.reject(new Error("Codex turn interrupted."))
    return true
  }
}

const buildDeveloperInstructions = (input: CodexTurnInput) => {
  const lines = [
    "You are Codex inside a local Electron SDLC workspace.",
    "Be concise and practical.",
    `Project: ${input.projectName}.`,
    `Workflow mode: ${input.workflowMode}.`,
    `Project type: ${input.projectType}.`
  ]

  if (input.activePhaseName) {
    lines.push(`Current phase: ${input.activePhaseName}.`)
  }

  if (input.selectedModel) {
    lines.push(`Selected model: ${input.selectedModel}.`)
  }

  if (input.selectedAgentId === "workspace") {
    lines.push("Selected agent: Workspace. Stay general-purpose unless the user asks to shift phase focus.")
  } else if (input.selectedAgentId === "auto") {
    lines.push(`Selected agent: Auto. Follow the current workflow phase${input.activePhaseName ? ` (${input.activePhaseName})` : ""}.`)
  } else if (getSupplementalAgentDefinition(input.selectedAgentId)) {
    lines.push(
      `Selected agent: ${input.effectiveAgentName ?? getSupplementalAgentDefinition(input.selectedAgentId)?.name ?? input.selectedAgentId}.`
    )
  } else {
    lines.push(`Selected agent: ${input.effectiveAgentName ?? getPhaseDefinition(input.selectedAgentId)?.name ?? input.selectedAgentId}.`)
    if (input.activePhaseName && input.effectiveAgentName && input.effectiveAgentName !== input.activePhaseName) {
      lines.push(
        `The workflow is currently anchored to ${input.activePhaseName}, but the user explicitly chose the ${input.effectiveAgentName} agent for this session. Do not silently change workflow state.`
      )
    }
  }

  if (input.activeArtifactPath) {
    lines.push(`Primary artifact path: ${input.activeArtifactPath}.`)
  }

  lines.push(
    "You may inspect files, edit files, and run workspace-scoped commands when the user asks for changes.",
    "Keep all file writes and commands inside the current workspace unless the user explicitly asks otherwise.",
    "When referencing files, stay relative to the current workspace.",
    "The app tracks SDLC state. Do not claim a phase is approved automatically unless the user explicitly confirms the handoff in chat.",
    "When a phase deliverable is ready, ask the user whether to move to the next agent and point them to the files to review."
  )

  const phasePrompt = getPhasePrompt(input.effectiveAgentPhaseId, {
    projectType: input.projectType,
    workflowMode: input.workflowMode
  })

  const supplementalAgentPrompt = getSupplementalAgentPrompt(input.selectedAgentId, {
    projectType: input.projectType,
    workflowMode: input.workflowMode
  })

  if (phasePrompt) {
    lines.push(phasePrompt)
  }

  if (supplementalAgentPrompt) {
    lines.push(supplementalAgentPrompt)
  }

  if (input.effectiveAgentPhaseId) {
    const nextPhaseId = getNextPhaseId(input.effectiveAgentPhaseId)
    const nextPhase = getPhaseDefinition(nextPhaseId)

    if (nextPhase) {
      lines.push(
        `Phase-complete handoff suggestions are supported. When ${getPhaseDefinition(input.effectiveAgentPhaseId)?.name ?? "this phase"} is complete and ready for the next agent, ask the user in visible chat if you should move to ${nextPhase.name}, then append exactly one final line in this format and nothing else on that line: [[SDLC_HANDOFF {"nextAgent":"${nextPhase.id}","reason":"short reason"}]].`
      )
      lines.push(
        "The app will intercept that directive, remove it from visible chat, mark the phase as ready to move, and wait for the user to confirm in chat. When the user confirms, the app will switch to the next phase session and start the next agent."
      )
    }
  }

  if (input.effectiveAgentPhaseId === "wireframe") {
    lines.push(
      'Wireframe image generation is supported. When one or more visual wireframe images would materially help, append one or more final lines in this format, with nothing else on each directive line: [[GENERATE_WIREFRAME_IMAGE {"prompt":"detailed prompt","filename":"wireframe-home.png","size":"1536x1024","quality":"medium"}]].'
    )
    lines.push(
      "The app will intercept those directives, generate the images, save them under `.project-workflow/wireframes/`, and surface them in the workspace."
    )
  }

  return lines.join(" ")
}

const client = new CodexAppServerClient()

export const sendCodexSessionMessage = (input: CodexTurnInput) => client.sendMessage(input)
export const interruptCodexSession = (projectId: string, sessionId: string) =>
  client.interruptSession(projectId, sessionId)
export const subscribeCodexEvents = (listener: (event: CodexChatEvent) => void) => {
  codexEvents.on("event", listener)
  return () => {
    codexEvents.off("event", listener)
  }
}
