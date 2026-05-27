import { readFile } from "fs/promises";
import path from "path";
import { chatWithFailover, LlmProviderError } from "@/lib/llm-chat";

const MAIN_MODEL = "llama-3.3-70b-versatile";

const ANALYZE_AGENT_IDS = [
  "vendor-watch",
  "budget-variance",
  "cash-position",
  "apar",
] as const;

type AnalyzeAgentId = (typeof ANALYZE_AGENT_IDS)[number];

type Severity = "low" | "medium" | "high" | "critical";
type Action = "escalate" | "flag" | "monitor";

type RawFinding = {
  label: string;
  severity: Severity;
  dollars: number;
  detail: string;
  recommendation: string;
  action: Action;
};

type StoredFinding = { id?: string; agent?: string; label?: string };

type AcmeData = {
  company?: unknown;
  vendors?: unknown;
  transactions?: unknown;
  apAging?: unknown;
  arAging?: unknown;
  cashBalance?: unknown;
  budget?: unknown;
  findings?: StoredFinding[];
};

const AGENT_CONFIG: Record<
  AnalyzeAgentId,
  { displayName: string; baseSystemPrompt: string; dataKeys: (keyof AcmeData)[] }
> = {
  "vendor-watch": {
    displayName: "Vendor Watch",
    baseSystemPrompt:
      "You are Vendor Watch at Acme Robotics. Analyze the vendor and transaction data. Find ONE genuinely new anomaly or concern. Output JSON: { \"label\", \"severity\" (low/medium/high/critical), \"dollars\" (number), \"detail\", \"recommendation\", \"action\" (escalate/flag/monitor) }. Respond with ONLY valid JSON, no other text — OR respond with exactly: No new findings",
    dataKeys: ["company", "vendors", "transactions"],
  },
  "budget-variance": {
    displayName: "Budget Variance Analyst",
    baseSystemPrompt:
      "You are the Budget Variance Analyst at Acme Robotics. Analyze budget vs actual department spending. Find ONE genuinely new variance or concern. Output JSON: { \"label\", \"severity\" (low/medium/high/critical), \"dollars\" (number), \"detail\", \"recommendation\", \"action\" (escalate/flag/monitor) }. Respond with ONLY valid JSON, no other text — OR respond with exactly: No new findings",
    dataKeys: ["company", "budget"],
  },
  "cash-position": {
    displayName: "Cash Position Reporter",
    baseSystemPrompt:
      "You are the Cash Position Reporter at Acme Robotics. Analyze weekly cash, burn, and runway trends. Find ONE genuinely new cash or burn concern. Normalize for one-time items where relevant. Output JSON: { \"label\", \"severity\" (low/medium/high/critical), \"dollars\" (number), \"detail\", \"recommendation\", \"action\" (escalate/flag/monitor) }. Respond with ONLY valid JSON, no other text — OR respond with exactly: No new findings",
    dataKeys: ["company", "cashBalance"],
  },
  apar: {
    displayName: "APAR",
    baseSystemPrompt:
      "You are APAR at Acme Robotics. Analyze accounts payable and receivable aging. Find ONE genuinely new collection risk, payment issue, or data integrity problem. Output JSON: { \"label\", \"severity\" (low/medium/high/critical), \"dollars\" (number), \"detail\", \"recommendation\", \"action\" (escalate/flag/monitor) }. Respond with ONLY valid JSON, no other text — OR respond with exactly: No new findings",
    dataKeys: ["company", "apAging", "arAging"],
  },
};

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const ACTIONS: Action[] = ["escalate", "flag", "monitor"];

async function loadFinanceData() {
  const filePath = path.join(process.cwd(), "data", "acme-data.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as AcmeData;
}

function normalizeAgentId(raw: string): AnalyzeAgentId | null {
  const key = raw.trim().toLowerCase();
  if (ANALYZE_AGENT_IDS.includes(key as AnalyzeAgentId)) {
    return key as AnalyzeAgentId;
  }
  for (const id of ANALYZE_AGENT_IDS) {
    if (key.includes(id)) return id;
  }
  const aliases: Record<string, AnalyzeAgentId> = {
    "vendor watch": "vendor-watch",
    "budget variance": "budget-variance",
    "cash position": "cash-position",
  };
  for (const [alias, id] of Object.entries(aliases)) {
    if (key.includes(alias)) return id;
  }
  if (key.includes("apar")) return "apar";
  return null;
}

function buildAgentPayload(data: AcmeData, agentId: AnalyzeAgentId) {
  const { dataKeys } = AGENT_CONFIG[agentId];
  const payload: Record<string, unknown> = {};
  for (const key of dataKeys) {
    if (data[key] !== undefined) {
      payload[key] = data[key];
    }
  }
  return payload;
}

function getExistingFindingsForAgent(data: AcmeData, displayName: string) {
  return (data.findings ?? [])
    .filter((f) => f.agent === displayName && f.id && f.label)
    .map((f) => ({ id: String(f.id), label: String(f.label) }));
}

function buildSystemPrompt(
  basePrompt: string,
  existing: { id: string; label: string }[]
): string {
  const labelList = existing.map((f) => f.label).join(", ") || "(none)";
  const idLabelList =
    existing.map((f) => `- ${f.id}: ${f.label}`).join("\n") || "(none)";

  return (
    `${basePrompt}\n\n` +
    `These findings are ALREADY in the system. Do NOT generate anything that overlaps with these topics: ${labelList}. ` +
    `Find something genuinely new or say 'No new findings' if nothing material emerges.\n\n` +
    `Existing findings (id and label only):\n${idLabelList}`
  );
}

function isNoNewFindingsResponse(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase().replace(/[.!]+$/, "").trim();
  if (normalized === "no new findings") return true;
  if (normalized.startsWith("no new findings") && !trimmed.includes("{")) return true;
  return false;
}

function stripMarkdownFences(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractJsonObject(raw: string): string {
  const stripped = stripMarkdownFences(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return stripped.slice(start, end + 1);
  }
  return stripped;
}

function parseFinding(raw: string): RawFinding {
  const jsonText = extractJsonObject(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    console.log("Analyze JSON parse failed. Raw model response:", raw);
    console.log("Analyze JSON extract attempt:", jsonText.slice(0, 2000));
    throw err;
  }

  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  const detail = typeof parsed.detail === "string" ? parsed.detail.trim() : "";
  const recommendation =
    typeof parsed.recommendation === "string" ? parsed.recommendation.trim() : "";
  const severity = String(parsed.severity ?? "")
    .trim()
    .toLowerCase() as Severity;
  const action = String(parsed.action ?? "")
    .trim()
    .toLowerCase() as Action;
  const dollars =
    typeof parsed.dollars === "number"
      ? parsed.dollars
      : typeof parsed.dollars === "string"
        ? Number(parsed.dollars.replace(/[^0-9.-]/g, ""))
        : 0;

  if (!label || !detail || !recommendation) {
    throw new Error("INVALID_FINDING");
  }
  if (!SEVERITIES.includes(severity)) {
    throw new Error("INVALID_SEVERITY");
  }
  if (!ACTIONS.includes(action)) {
    throw new Error("INVALID_ACTION");
  }
  if (!Number.isFinite(dollars)) {
    throw new Error("INVALID_DOLLARS");
  }

  return { label, severity, dollars, detail, recommendation, action };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { agent?: string };
    const agentRaw = typeof body.agent === "string" ? body.agent : "";
    const agentId = normalizeAgentId(agentRaw);

    if (!agentId) {
      return Response.json(
        {
          error:
            "Invalid agent. Use vendor-watch, budget-variance, cash-position, or apar.",
        },
        { status: 400 }
      );
    }

    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    if (!groqApiKey) {
      return Response.json(
        { error: "GROQ_API_KEY is not configured. Add it to .env.local and restart the dev server." },
        { status: 500 }
      );
    }
    const cerebrasApiKey = process.env.CEREBRAS_API_KEY?.trim();

    const data = await loadFinanceData();
    const agentConfig = AGENT_CONFIG[agentId];
    const existingFindings = getExistingFindingsForAgent(data, agentConfig.displayName);
    const systemPrompt = buildSystemPrompt(agentConfig.baseSystemPrompt, existingFindings);
    const payload = buildAgentPayload(data, agentId);

    const raw = await chatWithFailover({
      groqApiKey,
      cerebrasApiKey,
      model: MAIN_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Finance data (JSON):\n${JSON.stringify(payload)}` },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    if (isNoNewFindingsResponse(raw)) {
      return Response.json({
        agent: agentConfig.displayName,
        noNewFindings: true,
      });
    }

    const finding = parseFinding(raw);

    return Response.json({
      agent: agentConfig.displayName,
      finding,
    });
  } catch (err) {
    if (err instanceof LlmProviderError) {
      return Response.json(
        {
          error: err.message,
          groqStatus: err.groqError.status,
          groqMessage: err.groqError.message,
          ...(err.cerebrasError && {
            cerebrasStatus: err.cerebrasError.status,
            cerebrasMessage: err.cerebrasError.message,
          }),
        },
        { status: 502 }
      );
    }
    if (
      err instanceof Error &&
      (err.message.startsWith("INVALID_") || err instanceof SyntaxError)
    ) {
      console.error("Analyze parse error:", err);
      return Response.json({ error: "Could not parse the analysis result. Please try again." }, { status: 502 });
    }
    console.error("POST /api/analyze error:", err);
    return Response.json({ error: "Something went wrong running live analysis." }, { status: 500 });
  }
}
