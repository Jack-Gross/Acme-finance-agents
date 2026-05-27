import { readFile } from "fs/promises";
import path from "path";

const ROUTER_MODEL = "llama-3.1-8b-instant";
const MAIN_MODEL = "llama-3.3-70b-versatile";
const VARIANCE_THRESHOLD_PCT = 5;

const SOURCES_INSTRUCTION =
  'End every answer with a single line starting with "Sources:" that cites the specific finding IDs, agent names, and/or invoice references you used (e.g., "Sources: Vendor Watch · APEX-2026-104, APEX-2026-108"). Do not omit this line.';

const AGENT_IDS = [
  "vendor-watch",
  "budget-variance",
  "cash-position",
  "apar",
  "escalation-router",
] as const;

type AgentId = (typeof AGENT_IDS)[number];

const AGENTS: Record<
  AgentId,
  { displayName: string; systemPrompt: string }
> = {
  "vendor-watch": {
    displayName: "Vendor Watch",
    systemPrompt:
      "You are Vendor Watch, an AI agent that monitors vendor spend and contracts at Acme Robotics. You obsess over duplicate payments, unvetted vendors, and recurring charges. Be direct, cite invoice refs. " +
      SOURCES_INSTRUCTION,
  },
  "budget-variance": {
    displayName: "Budget Variance Analyst",
    systemPrompt:
      "You are the Budget Variance Analyst at Acme Robotics. You compare actual vs planned spend. You explain WHY variances exist, not just that they exist. " +
      SOURCES_INSTRUCTION,
  },
  "cash-position": {
    displayName: "Cash Position Reporter",
    systemPrompt:
      "You are the Cash Position Reporter at Acme Robotics. You track weekly burn and runway. You normalize for one-time items to surface true underlying burn. " +
      SOURCES_INSTRUCTION,
  },
  apar: {
    displayName: "APAR",
    systemPrompt:
      "You are APAR, the accounts payable and receivable agent at Acme Robotics. You prioritize collection risks and identify data integrity issues in aging reports. " +
      SOURCES_INSTRUCTION,
  },
  "escalation-router": {
    displayName: "Escalation Router",
    systemPrompt:
      "You are the Escalation Router at Acme Robotics. You synthesize across all agents to decide what needs CFO attention this week. " +
      SOURCES_INSTRUCTION,
  },
};

const ROUTER_SYSTEM_PROMPT =
  "You classify finance questions to one specialized agent. Respond with ONLY the agent name, nothing else.\n\n" +
  "Agents:\n" +
  "- vendor-watch: vendors, suppliers, vendor payments, duplicate charges, vendor contracts, vendor anomalies (Apex, Helios, Pendo, AWS)\n" +
  "- budget-variance: budget, planned vs actual, department spending, overspend, conferences (MODEX, ProMat)\n" +
  "- cash-position: cash, burn rate, runway, weekly cash trends\n" +
  "- apar: accounts payable AND accounts receivable, who owes whom, overdue invoices, collections, AP aging, AR aging, customer payments (MidWest, customers paying late)\n" +
  "- escalation-router: weekly briefing, what needs CFO attention, summary of all findings, top priorities\n\n" +
  "Question:";

type AgingRow = {
  amount: number;
  bucket: string;
  vendor?: string;
  customer?: string;
  invoice?: string;
  daysOut?: number;
  status?: string;
  due?: string;
  lastContact?: string;
};

type Budget = {
  months?: string[];
  note?: string;
  rows?: { category: string; planned: number[]; actual: number[] }[];
};

type AcmeData = {
  company?: unknown;
  findings?: unknown;
  apAging?: AgingRow[];
  arAging?: AgingRow[];
  budget?: Budget;
};

type GroqMessage = { role: "system" | "user"; content: string };

async function loadFinanceData() {
  const filePath = path.join(process.cwd(), "data", "acme-data.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as AcmeData;
}

function countByBucket(rows: AgingRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.bucket] = (counts[row.bucket] ?? 0) + 1;
  }
  return counts;
}

function summarizeAp(apAging: AgingRow[] = []) {
  return {
    totalOpenAP: apAging.reduce((sum, row) => sum + row.amount, 0),
    invoiceCount: apAging.length,
    countByBucket: countByBucket(apAging),
  };
}

function summarizeAr(arAging: AgingRow[] = []) {
  const ar90Plus =
    arAging.find((row) => row.bucket === "90+ days") ??
    arAging.find((row) => row.daysOut != null && row.daysOut >= 90);

  return {
    totalOpenAR: arAging.reduce((sum, row) => sum + row.amount, 0),
    invoiceCount: arAging.length,
    countByBucket: countByBucket(arAging),
    ar90PlusDays: ar90Plus
      ? {
          customer: ar90Plus.customer,
          invoice: ar90Plus.invoice,
          amount: ar90Plus.amount,
          daysOut: ar90Plus.daysOut,
          bucket: ar90Plus.bucket,
          status: ar90Plus.status,
          lastContact: ar90Plus.lastContact,
        }
      : null,
  };
}

function summarizeBudget(budget?: Budget) {
  if (!budget?.rows?.length) {
    return { note: budget?.note, categoriesWithVarianceOver5Pct: [] };
  }

  const months = budget.months ?? [];
  const categoriesWithVarianceOver5Pct: {
    category: string;
    months: {
      month: string;
      planned: number;
      actual: number;
      varianceDollars: number;
      variancePct: number;
    }[];
  }[] = [];

  for (const row of budget.rows) {
    const monthVariances: (typeof categoriesWithVarianceOver5Pct)[0]["months"] = [];

    for (let i = 0; i < row.planned.length; i++) {
      const planned = row.planned[i];
      if (planned === 0) continue;
      const actual = row.actual[i] ?? 0;
      const varianceDollars = actual - planned;
      const variancePct = (varianceDollars / planned) * 100;

      if (Math.abs(variancePct) > VARIANCE_THRESHOLD_PCT) {
        monthVariances.push({
          month: months[i] ?? `period-${i}`,
          planned,
          actual,
          varianceDollars,
          variancePct: Math.round(variancePct * 10) / 10,
        });
      }
    }

    if (monthVariances.length > 0) {
      categoriesWithVarianceOver5Pct.push({
        category: row.category,
        months: monthVariances,
      });
    }
  }

  return {
    note: budget.note,
    varianceThresholdPct: VARIANCE_THRESHOLD_PCT,
    categoriesWithVarianceOver5Pct,
  };
}

function trimFinanceData(data: AcmeData) {
  return {
    company: data.company,
    findings: data.findings,
    apSummary: summarizeAp(data.apAging),
    arSummary: summarizeAr(data.arAging),
    budgetSummary: summarizeBudget(data.budget),
  };
}

function parseAgentId(raw: string): AgentId {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .trim();

  const slug = normalized.replace(/[^a-z-]/g, "");
  if (AGENT_IDS.includes(slug as AgentId)) {
    return slug as AgentId;
  }

  // Longest ids first so "escalation-router" wins over partial matches
  const idsByLength = [...AGENT_IDS].sort((a, b) => b.length - a.length);
  for (const id of idsByLength) {
    if (normalized.includes(id)) {
      return id;
    }
  }

  const aliases: [string, AgentId][] = [
    ["vendor watch", "vendor-watch"],
    ["budget variance", "budget-variance"],
    ["cash position", "cash-position"],
    ["escalation router", "escalation-router"],
  ];
  for (const [alias, id] of aliases) {
    if (normalized.includes(alias)) {
      return id;
    }
  }

  if (normalized.includes("apar") || normalized.includes("a/p") || normalized.includes("a&r")) {
    return "apar";
  }

  return "escalation-router";
}

async function groqChat(
  apiKey: string,
  model: string,
  messages: GroqMessage[],
  maxTokens: number
): Promise<string> {
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: model === ROUTER_MODEL ? 0 : 0.2,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!groqRes.ok) {
    const errBody = await groqRes.text();
    console.error("Groq API error:", groqRes.status, errBody);
    throw new Error("GROQ_ERROR");
  }

  const completion = (await groqRes.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = completion.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("GROQ_EMPTY");
  }
  return content;
}

async function classifyAgent(apiKey: string, question: string): Promise<AgentId> {
  const routerResult = await groqChat(
    apiKey,
    ROUTER_MODEL,
    [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
    32
  );
  console.log("Router classified as:", routerResult);
  return parseAgentId(routerResult);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return Response.json({ error: "Question is required." }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      return Response.json(
        { error: "GROQ_API_KEY is not configured. Add it to .env.local and restart the dev server." },
        { status: 500 }
      );
    }

    const agentId = await classifyAgent(apiKey, question);
    const agentConfig = AGENTS[agentId];
    const financeData = trimFinanceData(await loadFinanceData());

    const answer = await groqChat(
      apiKey,
      MAIN_MODEL,
      [
        { role: "system", content: agentConfig.systemPrompt },
        {
          role: "user",
          content: `Finance data (JSON):\n${JSON.stringify(financeData)}\n\nQuestion: ${question}`,
        },
      ],
      1024
    );

    return Response.json({ answer, agent: agentConfig.displayName });
  } catch (err) {
    if (err instanceof Error && err.message === "GROQ_ERROR") {
      return Response.json(
        { error: "The finance agent could not complete your request. Please try again." },
        { status: 502 }
      );
    }
    if (err instanceof Error && err.message === "GROQ_EMPTY") {
      return Response.json({ error: "No answer returned from the model." }, { status: 502 });
    }
    console.error("POST /api/ask error:", err);
    return Response.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}
