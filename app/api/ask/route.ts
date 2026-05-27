import { readFile } from "fs/promises";
import path from "path";

const SYSTEM_PROMPT =
  "You are a finance agent for Acme Robotics. Use only the provided data to answer. Be concise, cite specific numbers and invoice refs. If asked about something not in the data, say so. " +
  'End every answer with a single line starting with "Sources:" that cites the specific finding IDs, agent names, and/or invoice references you used (e.g., "Sources: Vendor Watch · APEX-2026-104, APEX-2026-108"). Do not omit this line.';

const GROQ_MODEL = "llama-3.3-70b-versatile";
const VARIANCE_THRESHOLD_PCT = 5;

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

    const financeData = trimFinanceData(await loadFinanceData());

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Finance data (JSON):\n${JSON.stringify(financeData)}\n\nQuestion: ${question}`,
          },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error("Groq API error:", groqRes.status, errBody);
      return Response.json(
        { error: "The finance agent could not complete your request. Please try again." },
        { status: 502 }
      );
    }

    const completion = (await groqRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = completion.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return Response.json({ error: "No answer returned from the model." }, { status: 502 });
    }

    return Response.json({ answer });
  } catch (err) {
    console.error("POST /api/ask error:", err);
    return Response.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}
