"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string; agent?: string };

/** Partial, case-insensitive match — order matters (longer/more specific first). */
function getChatAgentLabelColor(agent: string | undefined): string | undefined {
  if (!agent?.trim()) return undefined;
  const key = agent.trim().toLowerCase();

  const rules: [needle: string, color: string][] = [
    ["escalation", "#4ade80"],
    ["budget", "#fbbf24"],
    ["vendor", "#a78bfa"],
    ["cash", "#60a5fa"],
    ["apar", "#2dd4bf"],
    ["payable", "#2dd4bf"],
    ["receivable", "#2dd4bf"],
  ];

  for (const [needle, color] of rules) {
    if (key.includes(needle)) return color;
  }
  return undefined;
}

const CHAT_STARTERS = [
  "Why is burn accelerating?",
  "Which vendors should I cancel?",
  "What's our biggest collection risk?",
  "Show me everything that needs CFO attention this week",
  "What did the previous VP of Finance miss?",
] as const;

const HUMAN_ANALYST_FINDINGS = [
  "Burn rate increased — weekly burn up from $180K to $310K, monitor.",
  "AR aging needs review — total $48K in the 90+ bucket.",
  "Marketing over budget.",
  "Some AP invoices pending.",
] as const;

const NUMERIC_TOKEN =
  /(\$[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%?|\b[A-Z]{2,}(?:-[A-Z0-9]+)*-\d{4}(?:-\d+)?(?:-[A-Z0-9]+)?\b|\b(?:INV|APEX|ACME|MFG|STR|MODEX|PROMAT|HEL|GSC|COL|BAR|DCW|MOU|UPS|AWS)-[\w-]+\b)/g;

function formatChatText(text: string): ReactNode[] {
  const parts = text.split(NUMERIC_TOKEN);
  return parts.map((part, i) =>
    i % 2 === 1 && part ? (
      <span key={i} className="chat-num">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function formatChatMessage(content: string): ReactNode {
  const lines = content.split("\n");
  const sourceIndex = lines.findIndex((line) => /^Sources:/i.test(line.trim()));

  if (sourceIndex === -1) {
    return <>{formatChatText(content)}</>;
  }

  const body = lines.slice(0, sourceIndex).join("\n").trimEnd();
  const sources = lines.slice(sourceIndex).join("\n").trim();

  return (
    <>
      {body ? formatChatText(body) : null}
      {sources ? <div className="chat-sources">{sources}</div> : null}
    </>
  );
}

// === DATA (from /data/acme-data.json — inlined for now, swap with import if you prefer) ===
const DATA = {
  cashBalance: [
    { weekEnding: "2026-03-23", burn: null },
    { weekEnding: "2026-03-30", burn: 180000 },
    { weekEnding: "2026-04-06", burn: 150000 },
    { weekEnding: "2026-04-13", burn: 210000 },
    { weekEnding: "2026-04-20", burn: 230000 },
    { weekEnding: "2026-04-27", burn: 270000 },
    { weekEnding: "2026-05-04", burn: 290000 },
    { weekEnding: "2026-05-11", burn: 310000 },
  ],
  findings: [
    { id: "apex-duplicate", agent: "Vendor Watch", severity: "critical", action: "escalate", dollars: 14500,
      label: "Duplicate payment to Apex Logistics",
      detail: "Apex billed $14,500 twice (APEX-2026-104 on 5/6 and APEX-2026-108 on 5/10) for the same one-time engagement. Both invoices open in AP. Cash snapshot confirms.",
      recommendation: "Hold APEX-2026-108. Confirm duplicate. Claw back if paid." },
    { id: "unvetted-vendors", agent: "Vendor Watch", severity: "high", action: "escalate", dollars: 11000,
      label: "Two vendors paid with no contract on file",
      detail: "Helios Imaging ($6,200, owner Unknown, never onboarded) and Global Strategic Consulting ($4,800, no history, no contract). $11,000 paid with no paper trail.",
      recommendation: "Get contracts and W-9s before any further payment." },
    { id: "pendo-ghost", agent: "Vendor Watch", severity: "medium", action: "flag", dollars: 2400,
      label: "Pendo in vendor master but zero transactions",
      detail: "Pendo listed at $2,400/mo (month-to-month) but no charges in 60 days. Either cancelled or invoice missing.",
      recommendation: "Confirm Pendo status. Update vendor master." },
    { id: "aws-overage", agent: "Vendor Watch", severity: "low", action: "monitor", dollars: 2400,
      label: "AWS overage charge",
      detail: "$2,400 overage on top of $28,500 baseline. Usage-based; 7 new customers in Q1 likely explains it.",
      recommendation: "Likely legitimate. Watch next month's run rate." },
    { id: "marketing-overspend", agent: "Budget Variance Analyst", severity: "high", action: "escalate", dollars: 49205,
      label: "Sales & Marketing over budget on conferences",
      detail: "S&M ran +$24,472 (Mar) and +$24,733 (Apr) over the $85K plan. MODEX ($45K) and ProMat ($32K) sponsorships. CEO approved mid-cycle; sheet was never updated.",
      recommendation: "No action on spend. Update the budget sheet so variance reporting is accurate." },
    { id: "burn-trend", agent: "Cash Position Reporter", severity: "medium", action: "monitor", dollars: 0,
      label: "Weekly burn accelerating",
      detail: "Weekly burn climbed from $180K to $310K over 8 weeks. Last two weeks inflated by conference sponsorships and Apex duplicate. Normalized burn lower.",
      recommendation: "Strip one-time items to report true underlying burn." },
    { id: "midwest-ar-risk", agent: "APAR", severity: "critical", action: "escalate", dollars: 48000,
      label: "MidWest Fulfillment receivable at risk",
      detail: "ACME-2026-180, $48,000, 92 days overdue (90+ bucket), flagged At Risk. Last contact 3/1. Legacy customer that used to pay reliably.",
      recommendation: "CFO or CS to call MidWest. Consider bad-debt reserve." },
    { id: "ap-data-integrity", agent: "APAR", severity: "medium", action: "flag", dollars: 0,
      label: "AP aging is unreliable (due dates before issue dates)",
      detail: "10 AP invoices have due date earlier than issue date. Aging buckets and days-outstanding cannot be trusted as-is.",
      recommendation: "Re-verify AP source data before deciding payment timing." },
  ],
};

type Finding = (typeof DATA.findings)[number] & { isLive?: boolean };

const AGENT_SLUG: Record<string, string> = {
  "Vendor Watch": "vendor-watch",
  "Budget Variance Analyst": "budget-variance",
  "Cash Position Reporter": "cash-position",
  APAR: "apar",
};

const AGENTS = [
  { name: "Vendor Watch", sub: "26 vendors monitored", icon: "shield" },
  { name: "Budget Variance Analyst", sub: "8 departments tracked", icon: "chart" },
  { name: "Cash Position Reporter", sub: "8-week trend window", icon: "wallet" },
  { name: "APAR", sub: "20 AP \u00b7 15 AR open", icon: "swap" },
  { name: "Escalation Router", sub: "synthesis \u00b7 routing", icon: "route" },
];

const ICONS: Record<string, ReactNode> = {
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  chart:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  wallet: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>,
  swap:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
  route:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>,
};

const fmt = (n: number) => (n === 0 ? "\u2014" : "$" + n.toLocaleString("en-US"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function plainLabel(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || html;
}

const ESCALATE_CRITICAL_HIGH = (f: Finding) =>
  f.action === "escalate" && (f.severity === "critical" || f.severity === "high");

function Sparkline() {
  const burns = DATA.cashBalance.filter((w) => w.burn !== null).map((w) => w.burn as number);
  const min = Math.min(...burns), max = Math.max(...burns);
  const pad = 4, w = 200, h = 60;
  const pts = burns.map((b, i) => {
    const x = pad + (i / (burns.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (b - min) / (max - min)) * (h - pad * 2);
    return [x, y] as [number, number];
  });
  const linePath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const areaPath = linePath + ` L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 60 }} aria-label="Weekly burn trend">
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={linePath} stroke="#fbbf24" strokeWidth="1.6" fill="none" />
      <path d={areaPath} fill="url(#sparkfill)" />
    </svg>
  );
}

type AgentState = { status: "ready" | "running" | "done"; label: string; revealedIds: Set<string>; routerDone: boolean };

export default function Page() {
  const [agentState, setAgentState] = useState<Record<string, AgentState>>(() =>
    Object.fromEntries(AGENTS.map((a) => [a.name, { status: "ready" as const, label: "Ready", revealedIds: new Set<string>(), routerDone: false }]))
  );
  const [briefingShown, setBriefingShown] = useState(false);
  const [running, setRunning] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [escalatedIds, setEscalatedIds] = useState(() => new Set<string>());
  const [toast, setToast] = useState<string | null>(null);
  const [autoEscalating, setAutoEscalating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [reviewView, setReviewView] = useState<"ai" | "human">("ai");
  const [liveFindings, setLiveFindings] = useState<Record<string, Finding[]>>({});
  const [liveAnalyzingAgent, setLiveAnalyzingAgent] = useState<string | null>(null);
  const [liveAnalyzeError, setLiveAnalyzeError] = useState<Record<string, string | null>>({});
  const [liveNoNewAgent, setLiveNoNewAgent] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!liveNoNewAgent) return;
    const t = setTimeout(() => setLiveNoNewAgent(null), 3000);
    return () => clearTimeout(t);
  }, [liveNoNewAgent]);

  const updateAgent = (name: string, patch: Partial<AgentState>) => {
    setAgentState((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  async function runSequence() {
    setRunning(true);
    setBriefingShown(false);
    // Reset
    setAgentState(Object.fromEntries(AGENTS.map((a) => [a.name, { status: "ready" as const, label: "Ready", revealedIds: new Set<string>(), routerDone: false }])));
    setLiveFindings({});
    setLiveAnalyzeError({});
    await sleep(80);

    for (const a of AGENTS.slice(0, 4)) {
      updateAgent(a.name, { status: "running", label: "Analyzing..." });
      await sleep(450);

      const findings = DATA.findings.filter((f) => f.agent === a.name);
      const revealed = new Set<string>();
      updateAgent(a.name, { status: "done", label: `Complete \u2022 ${findings.length} ${findings.length === 1 ? "finding" : "findings"}` });
      for (const f of findings) {
        revealed.add(f.id);
        updateAgent(a.name, { revealedIds: new Set(revealed) });
        await sleep(120);
      }
      await sleep(150);
    }

    // Router
    updateAgent("Escalation Router", { status: "running", label: "Synthesizing..." });
    await sleep(500);
    updateAgent("Escalation Router", { status: "done", label: `Complete \u2022 routed ${DATA.findings.length} findings`, routerDone: true });

    await sleep(250);
    setBriefingShown(true);
    setRunning(false);
    setHasRunOnce(true);
    // Smooth scroll to briefing
    setTimeout(() => document.getElementById("briefing")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  function escalateOne(f: Finding) {
    setEscalatedIds((prev) => new Set([...prev, f.id]));
    setToast(`Escalated ${plainLabel(f.label)} to CFO via email`);
  }

  async function autoEscalateCriticalHigh() {
    const targets = DATA.findings.filter(ESCALATE_CRITICAL_HIGH).filter((f) => !escalatedIds.has(f.id));
    if (!targets.length) {
      setToast("No critical or high findings left to escalate.");
      return;
    }
    setAutoEscalating(true);
    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      await sleep(140 + i * 35);
      setEscalatedIds((prev) => new Set([...prev, f.id]));
      setToast(`Escalated ${plainLabel(f.label)} to CFO via email`);
    }
    await sleep(280);
    setToast(`Escalated ${targets.length} critical and high findings to CFO via email`);
    setAutoEscalating(false);
  }

  async function runLiveAnalysis(agentName: string) {
    const slug = AGENT_SLUG[agentName];
    if (!slug || liveAnalyzingAgent) return;

    setLiveAnalyzeError((prev) => ({ ...prev, [agentName]: null }));
    setLiveNoNewAgent((prev) => (prev === agentName ? null : prev));
    setLiveAnalyzingAgent(agentName);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: slug }),
      });
      const data = (await res.json()) as {
        finding?: Omit<Finding, "id" | "agent" | "isLive">;
        agent?: string;
        noNewFindings?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Analysis failed.");
      }
      if (data.noNewFindings) {
        setLiveNoNewAgent(agentName);
        return;
      }
      if (!data.finding) {
        throw new Error(data.error || "Analysis failed.");
      }

      const newFinding: Finding = {
        id: `live-${slug}-${Date.now()}`,
        agent: agentName,
        isLive: true,
        ...data.finding,
      };

      setLiveFindings((prev) => ({
        ...prev,
        [agentName]: [newFinding, ...(prev[agentName] ?? [])],
      }));
      setAgentState((prev) => ({
        ...prev,
        [agentName]: {
          ...prev[agentName],
          revealedIds: new Set([newFinding.id, ...prev[agentName].revealedIds]),
        },
      }));
    } catch {
      setLiveAnalyzeError((prev) => ({
        ...prev,
        [agentName]: "Analysis failed, retry",
      }));
    } finally {
      setLiveAnalyzingAgent(null);
    }
  }

  function dismissLiveFinding(agentName: string, findingId: string) {
    setLiveFindings((prev) => ({
      ...prev,
      [agentName]: (prev[agentName] ?? []).filter((f) => f.id !== findingId),
    }));
    setAgentState((prev) => {
      const revealed = new Set(prev[agentName].revealedIds);
      revealed.delete(findingId);
      return {
        ...prev,
        [agentName]: { ...prev[agentName], revealedIds: revealed },
      };
    });
  }

  async function sendQuestion(questionRaw: string) {
    const question = questionRaw.trim();
    if (!question || chatLoading) return;

    setChatError(null);
    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as { answer?: string; agent?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Request failed. Please try again.");
      }
      const answer = data.answer;
      if (!answer) {
        throw new Error("No answer returned.");
      }
      console.log("[chat] agent from API:", data.agent);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: answer, agent: data.agent },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setChatError(message);
    } finally {
      setChatLoading(false);
    }
  }

  const escalate = DATA.findings.filter((f) => f.action === "escalate");
  const flag = DATA.findings.filter((f) => f.action === "flag");
  const monitor = DATA.findings.filter((f) => f.action === "monitor");
  const sumDollars = (arr: Finding[]) => arr.reduce((s, f) => s + f.dollars, 0);

  const criticalHighEscalateTargets = DATA.findings.filter(ESCALATE_CRITICAL_HIGH);
  const pendingCriticalHigh = criticalHighEscalateTargets.filter((f) => !escalatedIds.has(f.id));

  return (
    <div className="root">
      {toast && (
        <div className="toast-banner" role="status">
          <span className="toast-dot" aria-hidden />
          {toast}
        </div>
      )}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div className="brand-text">
            <h1>Acme Robotics &middot; Finance Command Center</h1>
            <p>Series B &middot; San Luis Obispo, CA &middot; 47 employees</p>
          </div>
        </div>
        <div className="status-row">
          <span><span className="status-dot" />5 agents online</span>
          <span>Last sync: 2026-05-19 09:14 PT</span>
        </div>
      </div>

      <div className="hero">
        <div className="stat">
          <div className="stat-label">Total Cash</div>
          <div className="stat-value">$12.68M</div>
          <div className="stat-sub">$11.18M operating + $1.50M reserve</div>
        </div>
        <div className="stat">
          <div className="stat-label">Runway</div>
          <div className="stat-value">13&ndash;14 mo</div>
          <div className="stat-sub">at $850K&ndash;$1.0M monthly burn</div>
        </div>
        <div className="stat stat-burn">
          <div className="stat-burn-left">
            <div className="stat-label">Weekly Burn</div>
            <div className="stat-value">$310K</div>
            <div className="stat-sub">8-week trend</div>
          </div>
          <div className="stat-burn-chart"><Sparkline /></div>
        </div>
        <div className="hero-actions">
          <button className="runbtn" onClick={runSequence} disabled={running || autoEscalating}>
            {running ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin">
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
                Running...
              </>
            ) : hasRunOnce ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                Run again
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Run Finance Team
              </>
            )}
          </button>
          <button
            type="button"
            className="auto-escalate-btn"
            onClick={autoEscalateCriticalHigh}
            disabled={running || autoEscalating || pendingCriticalHigh.length === 0}
            title={pendingCriticalHigh.length === 0 ? "All critical and high escalate items already sent" : undefined}
          >
            {autoEscalating ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin">
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
                Escalating…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                Auto-Escalate All Critical
              </>
            )}
          </button>
        </div>
      </div>

      {briefingShown && (
        <div className="briefing reveal" id="briefing">
          <div className="briefing-header">
            <div className="briefing-title">CFO Weekly Briefing &middot; auto-generated</div>
            <div className="briefing-meta">Week of May 19, 2026</div>
          </div>
          <div className="briefing-grid">
            <div className="briefing-headline">
              <div className="big" style={{ color: "var(--accent)" }}>$73,500</div>
              <div className="lead">needs your attention this week</div>
              <div className="sub">3 critical or high-severity items flagged across vendor payments, accounts receivable, and unvetted contractors. Detail below.</div>
            </div>
            <div className="briefing-stat">
              <div className="briefing-stat-label">Immediately recoverable</div>
              <div className="briefing-stat-value win">$14,500</div>
              <div className="briefing-stat-detail">Apex Logistics double-billed. Hold the second invoice and claw back if paid.</div>
            </div>
            <div className="briefing-stat">
              <div className="briefing-stat-label">At collection risk</div>
              <div className="briefing-stat-value" style={{ color: "var(--critical)" }}>$48,000</div>
              <div className="briefing-stat-detail">MidWest Fulfillment 92 days overdue. Recommend CFO call this week.</div>
            </div>
          </div>
        </div>
      )}

      {briefingShown && (
        <div className="roi-panel reveal">
          <div className="roi-header">
            <div className="roi-title">ROI vs Human Analyst</div>
            <div className="briefing-meta">Weekly finance review</div>
          </div>
          <div className="roi-cols">
            <div className="roi-col roi-col-ai">
              <div className="roi-col-name">AI Agent Team</div>
              <dl className="roi-metrics">
                <div className="roi-metric">
                  <dt>Cost</dt>
                  <dd><span className="roi-num">~$50</span>/month <span className="roi-num-sub">(API calls)</span></dd>
                </div>
                <div className="roi-metric">
                  <dt>Time</dt>
                  <dd><span className="roi-num">30 seconds</span> to analyze</dd>
                </div>
                <div className="roi-metric">
                  <dt>Coverage</dt>
                  <dd><span className="roi-num">100%</span> of transactions, every week</dd>
                </div>
                <div className="roi-metric">
                  <dt>Findings this run</dt>
                  <dd>
                    <span className="roi-num">{DATA.findings.length}</span>{" "}
                    (<span className="roi-num accent">$73,500</span> flagged,{" "}
                    <span className="roi-num accent">$14,500</span> recoverable)
                  </dd>
                </div>
              </dl>
            </div>
            <div className="roi-col roi-col-human">
              <div className="roi-col-name">Human Finance Analyst</div>
              <dl className="roi-metrics">
                <div className="roi-metric">
                  <dt>Cost</dt>
                  <dd><span className="roi-num">~$8,300</span>/month <span className="roi-num-sub">(loaded $100K salary)</span></dd>
                </div>
                <div className="roi-metric">
                  <dt>Time</dt>
                  <dd><span className="roi-num">2&ndash;3 days</span> per weekly review</dd>
                </div>
                <div className="roi-metric">
                  <dt>Coverage</dt>
                  <dd>Sampling, not exhaustive</dd>
                </div>
                <div className="roi-metric">
                  <dt>Findings</dt>
                  <dd>Variable, depends on attention</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="roi-headline">
            <span className="roi-num">166x</span> cheaper. <span className="roi-num">5,000x</span> faster. Always on.
          </div>
        </div>
      )}

      <div className="chat-panel">
        <div className="chat-header">
          <div className="chat-title">Ask the Finance Team</div>
          <div className="briefing-meta">Powered by Groq &middot; llama-3.3-70b</div>
        </div>

        {chatMessages.length === 0 && !chatLoading && (
          <div className="chat-starters">
            {CHAT_STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                className="chat-starter-btn"
                onClick={() => sendQuestion(q)}
                disabled={chatLoading}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="chat-history" aria-live="polite">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
              <div
                className="chat-msg-label"
                style={
                  msg.role === "assistant" && msg.agent
                    ? { color: getChatAgentLabelColor(msg.agent) }
                    : undefined
                }
              >
                {msg.role === "user" ? "You" : msg.agent ?? "Finance Agent"}
              </div>
              <div className="chat-msg-body">{formatChatMessage(msg.content)}</div>
            </div>
          ))}
          {chatLoading && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-label">Finance Agent</div>
              <div className="chat-msg-body chat-loading">
                <span className="chat-loading-dot" />
                <span className="chat-loading-dot" />
                <span className="chat-loading-dot" />
                Analyzing Acme data…
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {chatError && <div className="chat-error">{chatError}</div>}

        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendQuestion(chatInput);
          }}
        >
          <input
            type="text"
            className="chat-input"
            placeholder="Ask about vendors, burn, AR, budgets…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatLoading}
            aria-label="Question for finance team"
          />
          <button type="submit" className="chat-send" disabled={chatLoading || !chatInput.trim()}>
            {chatLoading ? "Sending…" : "Send"}
          </button>
        </form>
      </div>

      <div className="view-toggle-wrap">
        <div className="view-toggle" role="tablist" aria-label="Review mode">
          <button
            type="button"
            role="tab"
            aria-selected={reviewView === "human"}
            className={`view-toggle-btn ${reviewView === "human" ? "active" : ""}`}
            onClick={() => setReviewView("human")}
          >
            Human Analyst View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reviewView === "ai"}
            className={`view-toggle-btn ${reviewView === "ai" ? "active" : ""}`}
            onClick={() => setReviewView("ai")}
          >
            AI Agent Team View
          </button>
        </div>
        <div className="view-toggle-caption">
          Same data. Same week. One version finds <span className="caption-num">$14,500</span>{" "}
          to claw back. The other doesn&apos;t.
        </div>
      </div>

      {reviewView === "ai" ? (
        <>
          <div className="agents-header">
            <div className="agents-title">Agent Team</div>
            <div className="briefing-meta">8 findings &middot; 5 agents</div>
          </div>

          <div className="agents-grid">
            {AGENTS.map((a) => {
              const isRouter = a.name === "Escalation Router";
              const staticFindings = DATA.findings.filter((f) => f.agent === a.name);
              const live = liveFindings[a.name] ?? [];
              const findings = [...live, ...staticFindings];
              const analyzingLive = liveAnalyzingAgent === a.name;
              const s = agentState[a.name];
              const statusCls = s.status === "running" ? "running" : s.status === "done" ? "done" : "";
              return (
                <div key={a.name} className={`agent ${statusCls} ${isRouter ? "routerwide" : ""}`}>
                  <div className="agent-head">
                    <div className="agent-head-left">
                      <div className="agent-icon">{ICONS[a.icon]}</div>
                      <div>
                        <div className="agent-name">{a.name}</div>
                        <div className="agent-sub" dangerouslySetInnerHTML={{ __html: a.sub }} />
                      </div>
                    </div>
                    <div className="agent-status"><span className="dot" />{s.label}</div>
                  </div>
                  <div className="agent-body">
                    {!isRouter && (
                      <div className="live-analysis-row">
                        <button
                          type="button"
                          className="live-analysis-btn"
                          onClick={() => runLiveAnalysis(a.name)}
                          disabled={!!liveAnalyzingAgent}
                        >
                          {analyzingLive ? (
                            <>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="spin"
                                aria-hidden
                              >
                                <line x1="12" y1="2" x2="12" y2="6" />
                                <line x1="12" y1="18" x2="12" y2="22" />
                                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                                <line x1="2" y1="12" x2="6" y2="12" />
                                <line x1="18" y1="12" x2="22" y2="12" />
                                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                              </svg>
                              Analyzing…
                            </>
                          ) : (
                            "Run Live Analysis"
                          )}
                        </button>
                        {liveNoNewAgent === a.name && (
                          <span className="live-no-new-msg" role="status">
                            ✓ No new findings beyond existing report
                          </span>
                        )}
                        {liveAnalyzeError[a.name] && (
                          <span className="live-analysis-error" role="alert">
                            {liveAnalyzeError[a.name]}
                          </span>
                        )}
                      </div>
                    )}
                    {isRouter ? (
                      s.routerDone ? (
                        <div className="router-cols">
                          <div className="router-col escalate">
                            <div className="router-col-label">Escalate to CFO</div>
                            <div className="router-col-count">{escalate.length} items</div>
                            <div className="router-col-dollars">{fmt(sumDollars(escalate))} at stake</div>
                          </div>
                          <div className="router-col flag">
                            <div className="router-col-label">Flag for review</div>
                            <div className="router-col-count">{flag.length} items</div>
                            <div className="router-col-dollars">{fmt(sumDollars(flag))}</div>
                          </div>
                          <div className="router-col monitor">
                            <div className="router-col-label">Monitor only</div>
                            <div className="router-col-count">{monitor.length} items</div>
                            <div className="router-col-dollars">{fmt(sumDollars(monitor))}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="agent-idle">Click Run Finance Team to synthesize agent outputs into CFO briefing.</div>
                      )
                    ) : findings.length ? (
                      findings.map((f) => (
                        <div
                          key={f.id}
                          className={`finding ${f.severity} ${f.isLive || s.revealedIds.has(f.id) ? "show" : ""} ${f.isLive ? "finding-live" : ""} ${autoEscalating && ESCALATE_CRITICAL_HIGH(f) && !escalatedIds.has(f.id) ? "auto-escalate-pending" : ""}`}
                        >
                          {f.isLive && (
                            <div className="live-finding-meta">
                              <span className="live-badge">LIVE</span>
                              <button
                                type="button"
                                className="live-dismiss-btn"
                                onClick={() => dismissLiveFinding(a.name, f.id)}
                                aria-label="Dismiss live finding"
                              >
                                ×
                              </button>
                            </div>
                          )}
                          <div className="finding-top">
                            {f.isLive ? (
                              <div className="finding-label">{f.label}</div>
                            ) : (
                              <div className="finding-label" dangerouslySetInnerHTML={{ __html: f.label }} />
                            )}
                            <div className="finding-dollars">{fmt(f.dollars)}</div>
                          </div>
                          {f.isLive ? (
                            <div className="finding-detail">{f.detail}</div>
                          ) : (
                            <div className="finding-detail" dangerouslySetInnerHTML={{ __html: f.detail }} />
                          )}
                          <div className="finding-bottom">
                            <div className="finding-action"><b>Action:</b> {f.recommendation}</div>
                            <div className="finding-bottom-right">
                              {f.action === "escalate" && (
                                <button
                                  type="button"
                                  className="escalate-cfo-btn"
                                  disabled={escalatedIds.has(f.id) || autoEscalating}
                                  onClick={() => escalateOne(f)}
                                >
                                  {escalatedIds.has(f.id) ? "✓ Escalated to CFO" : "Escalate to CFO"}
                                </button>
                              )}
                              <div className={`severity-pill ${f.severity}`}>{f.action.toUpperCase()}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="agent-idle">No findings.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="manual-review-card">
          <div className="manual-review-title">Weekly Finance Review — Manual</div>
          <ul className="manual-review-list">
            {HUMAN_ANALYST_FINDINGS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="page-footer">
        Built on Next.js · Groq · llama-3.3-70b · Live data from acme-data.json
      </footer>

      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap");
        :root {
          --bg: #0a0a0b; --surface: #131316; --surface-2: #1c1c20;
          --border: rgba(255,255,255,0.06); --border-strong: rgba(255,255,255,0.12);
          --text: #fafafa; --text-2: #a1a1aa; --text-3: #71717a;
          --accent: #4ade80; --accent-bg: rgba(74,222,128,0.08);
          --critical: #f87171; --critical-bg: rgba(248,113,113,0.08);
          --high: #fb923c; --high-bg: rgba(251,146,60,0.08);
          --medium: #fbbf24; --medium-bg: rgba(251,191,36,0.08);
          --low: #94a3b8; --low-bg: rgba(148,163,184,0.06);
          --sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
          --mono: 'IBM Plex Mono', ui-monospace, monospace;
        }
        * { box-sizing: border-box; }
        html, body { background: var(--bg); color: var(--text); font-family: var(--sans); margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
        .root { padding: 24px 32px 64px; min-height: 100vh; position: relative; }

        .toast-banner {
          position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 200;
          max-width: min(560px, calc(100vw - 32px)); padding: 12px 18px 12px 16px;
          background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.45); font-size: 13px; color: var(--text);
          display: flex; align-items: center; gap: 10px; font-family: var(--mono);
          animation: toastIn 0.35s ease-out;
        }
        .toast-banner::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); border-radius: 10px 0 0 10px; }
        .toast-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; box-shadow: 0 0 10px var(--accent); }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }

        .topbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 28px; }
        .brand { display: flex; align-items: center; gap: 14px; }
        .brand-mark { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%); display: flex; align-items: center; justify-content: center; font-weight: 600; color: #0a0a0b; font-size: 16px; }
        .brand-text h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
        .brand-text p { font-size: 12px; color: var(--text-3); margin: 2px 0 0; }
        .status-row { display: flex; align-items: center; gap: 20px; font-size: 12px; color: var(--text-2); font-family: var(--mono); }
        .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 6px; box-shadow: 0 0 8px var(--accent); }

        .hero { display: grid; grid-template-columns: 1fr 1fr 1.4fr auto; gap: 16px; margin-bottom: 28px; }
        .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
        .stat-label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; margin-bottom: 10px; }
        .stat-value { font-family: var(--mono); font-size: 28px; font-weight: 500; letter-spacing: -0.02em; }
        .stat-sub { font-size: 12px; color: var(--text-2); margin-top: 6px; font-family: var(--mono); }
        .stat-burn { display: flex; align-items: stretch; gap: 18px; }
        .stat-burn-left { flex: 0 0 auto; }
        .stat-burn-chart { flex: 1; display: flex; align-items: flex-end; min-width: 0; }

        .hero-actions { display: flex; flex-direction: column; gap: 10px; min-height: 100%; justify-content: stretch; }
        .runbtn { background: var(--accent); color: #0a0a0b; border: 0; border-radius: 12px; padding: 0 32px; font-family: var(--sans); font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; min-height: 44px; transition: all 0.15s; letter-spacing: -0.01em; }
        .runbtn:hover { background: #22c55e; transform: translateY(-1px); }
        .runbtn:active { transform: translateY(0); }
        .runbtn:disabled { background: var(--surface-2); color: var(--text-3); cursor: not-allowed; transform: none; }
        .runbtn svg { width: 16px; height: 16px; }

        .auto-escalate-btn {
          background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong);
          border-radius: 12px; padding: 0 20px; font-family: var(--sans); font-size: 13px; font-weight: 600;
          cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; min-height: 44px;
          transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s;
          letter-spacing: -0.01em;
          box-shadow: inset 0 0 0 1px rgba(248,113,113,0.12);
        }
        .auto-escalate-btn:hover:not(:disabled) {
          background: var(--critical-bg); border-color: rgba(248,113,113,0.35); color: var(--critical); transform: translateY(-1px);
        }
        .auto-escalate-btn:active:not(:disabled) { transform: translateY(0); }
        .auto-escalate-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; color: var(--text-3); }
        .auto-escalate-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .briefing { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; margin-bottom: 28px; position: relative; overflow: hidden; }
        .briefing::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); }
        .briefing-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
        .briefing-title { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
        .briefing-meta { font-size: 12px; color: var(--text-3); font-family: var(--mono); }
        .briefing-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 32px; align-items: start; }
        .briefing-headline .big { font-family: var(--mono); font-size: 36px; font-weight: 500; letter-spacing: -0.03em; line-height: 1; margin-bottom: 8px; }
        .briefing-headline .lead { font-size: 14px; color: var(--text); font-weight: 500; line-height: 1.4; }
        .briefing-headline .sub { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-top: 6px; }
        .briefing-stat { padding-left: 20px; border-left: 1px solid var(--border); }
        .briefing-stat-label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
        .briefing-stat-value { font-family: var(--mono); font-size: 20px; font-weight: 500; letter-spacing: -0.02em; margin-bottom: 4px; }
        .briefing-stat-value.win { color: var(--accent); }
        .briefing-stat-detail { font-size: 12px; color: var(--text-2); line-height: 1.45; }
        .reveal { animation: briefingIn 0.6s ease-out; }
        @keyframes briefingIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        .roi-panel {
          background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: 24px 28px; margin-bottom: 28px; position: relative; overflow: hidden;
        }
        .roi-panel::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, var(--accent) 0%, var(--medium) 100%); }
        .roi-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
        .roi-title { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
        .roi-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .roi-col {
          background: var(--surface-2); border-radius: 10px; padding: 18px 20px;
          border: 1px solid var(--border);
        }
        .roi-col-ai { border-color: rgba(74,222,128,0.15); box-shadow: inset 0 0 0 1px rgba(74,222,128,0.06); }
        .roi-col-human { border-color: var(--border); }
        .roi-col-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 14px; }
        .roi-col-ai .roi-col-name { color: var(--accent); }
        .roi-col-human .roi-col-name { color: var(--text-2); }
        .roi-metrics { margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .roi-metric { display: grid; grid-template-columns: 108px 1fr; gap: 12px; align-items: baseline; }
        .roi-metric dt {
          font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em;
          font-weight: 500; margin: 0;
        }
        .roi-metric dd { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.45; }
        .roi-num { font-family: var(--mono); font-weight: 500; color: var(--text); letter-spacing: -0.02em; }
        .roi-num.accent { color: var(--accent); }
        .roi-num-sub { font-family: var(--mono); font-size: 12px; color: var(--text-3); }
        .roi-headline {
          font-size: 18px; font-weight: 700; letter-spacing: -0.03em; text-align: center;
          padding-top: 18px; border-top: 1px solid var(--border);
          color: var(--text);
        }
        .roi-headline .roi-num { color: var(--accent); font-size: 20px; }
        @media (max-width: 720px) {
          .roi-cols { grid-template-columns: 1fr; }
          .roi-metric { grid-template-columns: 1fr; gap: 4px; }
        }

        .chat-panel {
          background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: 24px 28px; margin-bottom: 28px; position: relative; overflow: hidden;
        }
        .chat-panel::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: linear-gradient(180deg, var(--medium) 0%, var(--accent) 100%);
        }
        .chat-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
        .chat-title { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
        .chat-starters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
        .chat-starter-btn {
          font-family: var(--sans); font-size: 12px; font-weight: 500; padding: 8px 14px; border-radius: 999px;
          border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-2);
          cursor: pointer; transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .chat-starter-btn:hover:not(:disabled) {
          border-color: rgba(74,222,128,0.35); color: var(--accent); background: var(--accent-bg);
        }
        .chat-starter-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .chat-history {
          max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
          margin-bottom: 14px; padding-right: 4px;
        }
        .chat-history:empty { margin-bottom: 0; }
        .chat-msg {
          background: var(--surface-2); border-radius: 10px; padding: 12px 14px;
          border: 1px solid var(--border);
        }
        .chat-msg-user { border-color: rgba(255,255,255,0.08); }
        .chat-msg-assistant { border-color: rgba(74,222,128,0.12); }
        .chat-msg-label {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-3); font-weight: 500; margin-bottom: 6px; font-family: var(--mono);
        }
        .chat-msg-user .chat-msg-label { color: var(--text-2); }
        .chat-msg-assistant .chat-msg-label { color: var(--accent); }
        .chat-msg-body { font-size: 13px; color: var(--text); line-height: 1.55; white-space: pre-wrap; }
        .chat-sources {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--border);
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-3);
          line-height: 1.45;
          white-space: pre-wrap;
        }
        .chat-num { font-family: var(--mono); font-weight: 500; color: var(--accent); letter-spacing: -0.02em; }
        .chat-msg-user .chat-num { color: var(--text); }
        .chat-loading { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-style: italic; }
        .chat-loading-dot {
          width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
          animation: chatPulse 1.2s ease-in-out infinite;
        }
        .chat-loading-dot:nth-child(2) { animation-delay: 0.15s; }
        .chat-loading-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes chatPulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
        .chat-error {
          font-size: 12px; color: var(--critical); background: var(--critical-bg);
          border: 1px solid rgba(248,113,113,0.2); border-radius: 8px; padding: 10px 12px;
          margin-bottom: 12px; font-family: var(--mono);
        }
        .chat-form { display: flex; gap: 10px; align-items: stretch; }
        .chat-input {
          flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--border-strong);
          border-radius: 10px; padding: 12px 14px; font-family: var(--sans); font-size: 14px;
          color: var(--text); outline: none; transition: border-color 0.15s;
        }
        .chat-input::placeholder { color: var(--text-3); }
        .chat-input:focus { border-color: rgba(74,222,128,0.4); }
        .chat-input:disabled { opacity: 0.6; cursor: not-allowed; }
        .chat-send {
          background: var(--accent); color: #0a0a0b; border: 0; border-radius: 10px;
          padding: 0 22px; font-family: var(--sans); font-size: 13px; font-weight: 600;
          cursor: pointer; transition: background 0.15s, transform 0.15s; white-space: nowrap;
        }
        .chat-send:hover:not(:disabled) { background: #22c55e; transform: translateY(-1px); }
        .chat-send:disabled { background: var(--surface-2); color: var(--text-3); cursor: not-allowed; transform: none; }

        .view-toggle-wrap {
          margin-bottom: 16px;
        }
        .view-toggle {
          display: inline-flex;
          align-items: center;
          background: var(--surface);
          border: 1px solid var(--border-strong);
          border-radius: 999px;
          padding: 4px;
          gap: 4px;
        }
        .view-toggle-btn {
          border: 0;
          background: transparent;
          color: var(--text-2);
          border-radius: 999px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          font-family: var(--sans);
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .view-toggle-btn.active {
          background: var(--surface-2);
          color: var(--text);
          box-shadow: inset 0 0 0 1px var(--border-strong);
        }
        .view-toggle-btn:hover:not(.active) {
          color: var(--text);
        }
        .view-toggle-caption {
          margin-top: 8px;
          color: var(--text-3);
          font-size: 12px;
          line-height: 1.45;
        }
        .caption-num {
          font-family: var(--mono);
          color: var(--text-2);
        }

        .agents-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
        .agents-title { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
        .agents-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .manual-review-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px 22px;
          margin-bottom: 8px;
        }
        .manual-review-title {
          color: var(--text-2);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 500;
          margin-bottom: 12px;
        }
        .manual-review-list {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 9px;
          color: var(--text-3);
          font-size: 13px;
          line-height: 1.55;
        }
        .agent { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .agent.routerwide { grid-column: 1 / -1; }
        .agent-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .agent-head-left { display: flex; align-items: center; gap: 12px; }
        .agent-icon { width: 32px; height: 32px; border-radius: 8px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-2); }
        .agent-icon svg { width: 16px; height: 16px; }
        .agent-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
        .agent-sub { font-size: 11px; color: var(--text-3); margin-top: 1px; font-family: var(--mono); }
        .agent-status { font-family: var(--mono); font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); color: var(--text-3); display: flex; align-items: center; gap: 6px; }
        .agent-status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
        .agent.running .agent-status { background: rgba(251,191,36,0.1); color: var(--medium); }
        .agent.running .agent-status .dot { background: var(--medium); animation: pulse 1s ease-in-out infinite; }
        .agent.done .agent-status { background: var(--accent-bg); color: var(--accent); }
        .agent.done .agent-status .dot { background: var(--accent); }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .agent-body { padding: 16px 20px; min-height: 80px; display: flex; flex-direction: column; gap: 10px; }
        .live-analysis-row {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding-bottom: 10px; margin-bottom: 2px; border-bottom: 1px solid var(--border);
        }
        .live-analysis-btn {
          background: var(--surface); border: 1px solid var(--border-strong); color: var(--text);
          border-radius: 8px; padding: 8px 14px; font-family: var(--sans); font-size: 12px; font-weight: 600;
          cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
          transition: border-color 0.15s, background 0.15s, color 0.15s;
        }
        .live-analysis-btn:hover:not(:disabled) {
          border-color: rgba(74,222,128,0.4); background: var(--accent-bg); color: var(--accent);
        }
        .live-analysis-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .live-analysis-btn svg { width: 14px; height: 14px; }
        .live-analysis-error { font-size: 12px; color: var(--critical); font-family: var(--mono); }
        .live-no-new-msg { font-size: 12px; color: var(--accent); font-family: var(--mono); }
        .agent-idle { font-size: 13px; color: var(--text-3); font-style: italic; }

        .finding { background: var(--surface-2); border-radius: 10px; padding: 14px 16px; border-left: 3px solid var(--low); opacity: 0; transform: translateY(8px); transition: opacity 0.4s ease, transform 0.4s ease; position: relative; }
        .finding.show { opacity: 1; transform: translateY(0); }
        .finding-live {
          animation: liveFindingPulse 2.2s ease-in-out infinite;
          box-shadow: 0 0 0 1px rgba(74,222,128,0.15), 0 0 24px rgba(74,222,128,0.06);
        }
        @keyframes liveFindingPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(74,222,128,0.12), 0 0 16px rgba(74,222,128,0.04); }
          50% { box-shadow: 0 0 0 1px rgba(74,222,128,0.35), 0 0 28px rgba(74,222,128,0.12); }
        }
        .live-finding-meta {
          position: absolute; top: 8px; right: 8px; z-index: 1;
          display: flex; align-items: center; gap: 6px;
        }
        .live-badge {
          font-size: 9px; font-family: var(--mono); font-weight: 600; letter-spacing: 0.1em;
          padding: 3px 7px; border-radius: 999px;
          background: var(--accent-bg); color: var(--accent);
          border: 1px solid rgba(74,222,128,0.35);
        }
        .live-dismiss-btn {
          width: 22px; height: 22px; padding: 0; border: 1px solid var(--border-strong);
          border-radius: 6px; background: var(--surface); color: var(--text-3);
          font-size: 16px; line-height: 1; font-family: var(--sans); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: color 0.15s, border-color 0.15s, background 0.15s;
        }
        .live-dismiss-btn:hover {
          color: var(--text); border-color: rgba(255,255,255,0.2); background: var(--surface-2);
        }
        .finding-live .finding-top { padding-right: 88px; }
        .finding.critical { border-left-color: var(--critical); }
        .finding.high { border-left-color: var(--high); }
        .finding.medium { border-left-color: var(--medium); }
        .finding.low { border-left-color: var(--low); }
        .finding-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
        .finding-label { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; flex: 1; }
        .finding-dollars { font-family: var(--mono); font-size: 15px; font-weight: 500; white-space: nowrap; letter-spacing: -0.01em; }
        .finding.critical .finding-dollars { color: var(--critical); }
        .finding.high .finding-dollars { color: var(--high); }
        .finding.medium .finding-dollars { color: var(--medium); }
        .finding.low .finding-dollars { color: var(--low); }
        .finding-detail { font-size: 12.5px; color: var(--text-2); line-height: 1.5; margin-bottom: 10px; }
        .finding-bottom { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid var(--border); }
        .finding-action { font-size: 11px; color: var(--text-3); font-family: var(--mono); flex: 1; min-width: 140px; }
        .finding-action b { color: var(--text); font-weight: 500; }
        .finding-bottom-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

        .escalate-cfo-btn {
          font-family: var(--sans); font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 8px; cursor: pointer;
          border: 1px solid rgba(248,113,113,0.35); background: var(--critical-bg); color: var(--critical);
          transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
          white-space: nowrap;
        }
        .escalate-cfo-btn:hover:not(:disabled) { background: rgba(248,113,113,0.14); border-color: var(--critical); }
        .escalate-cfo-btn:disabled {
          cursor: not-allowed; opacity: 0.85; border-color: rgba(74,222,128,0.35); background: var(--accent-bg); color: var(--accent);
        }

        .finding.auto-escalate-pending { animation: escalateShimmer 1.1s ease-in-out infinite; }
        @keyframes escalateShimmer {
          0%, 100% { box-shadow: inset 0 0 0 1px var(--border); }
          50% { box-shadow: inset 0 0 0 1px rgba(248,113,113,0.25), 0 0 0 1px rgba(251,146,60,0.12); }
        }

        .severity-pill { font-size: 10px; font-family: var(--mono); padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
        .severity-pill.critical { background: var(--critical-bg); color: var(--critical); }
        .severity-pill.high { background: var(--high-bg); color: var(--high); }
        .severity-pill.medium { background: var(--medium-bg); color: var(--medium); }
        .severity-pill.low { background: var(--low-bg); color: var(--low); }

        .router-cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; width: 100%; }
        .router-col { background: var(--surface-2); border-radius: 10px; padding: 14px 16px; }
        .router-col-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; margin-bottom: 8px; font-family: var(--mono); }
        .router-col.escalate .router-col-label { color: var(--critical); }
        .router-col.flag .router-col-label { color: var(--medium); }
        .router-col.monitor .router-col-label { color: var(--low); }
        .router-col-count { font-family: var(--mono); font-size: 22px; font-weight: 500; margin-bottom: 4px; }
        .router-col-dollars { font-size: 12px; color: var(--text-2); font-family: var(--mono); }

        .page-footer {
          margin-top: 40px;
          padding: 16px 0 8px;
          text-align: center;
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-3);
          border-top: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
