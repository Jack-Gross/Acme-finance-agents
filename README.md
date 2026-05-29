# Acme Robotics Finance Command Center

An AI agent team that keeps a finance department running after the VP of Finance walks out.

Built in 24 hours for the Cal Poly Vibe Coding Build Night (1st place, $300 prize).

## The Problem

A mid-size company loses their VP of Finance with no transition plan. The CFO is drowning. Hiring a replacement takes 3-6 months. The recurring work (vendor monitoring, budget variance, AR collections, weekly cash reports) still has to happen.

## The Solution

Five specialized AI agents that each watch a different part of finance. They surface findings, route routine items, and escalate only what needs the CFO's attention.

- **Vendor Watch** — monitors vendor spend, flags duplicates and unvetted vendors
- **Budget Variance Analyst** — compares actual vs planned spending
- **Cash Position Reporter** — tracks weekly burn and runway
- **APAR** — accounts payable and receivable, identifies collection risks
- **Escalation Router** — synthesizes outputs, writes the CFO weekly briefing

## What It Caught

On the demo dataset, the agents surfaced $73,500 needing CFO attention, including:

- $14,500 duplicate payment to Apex Logistics (immediately recoverable)
- $48,000 receivable from MidWest Fulfillment, 92 days overdue
- $11,000 paid to two unvetted vendors with no contracts on file
- Marketing $49K over budget on conference sponsorships
- AP aging report had 10 invoices with due dates before issue dates

## Tech Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Groq (llama-3.3-70b-versatile) as primary LLM
- Cerebras (gpt-oss-120b) as fallback for rate limits
- Per-agent system prompts route questions to the right specialist
- Static dataset (acme-data.json) stands in for a real Drive/QuickBooks sync

## Key Features

- Live agent run sequence with animated reveals
- "Human Analyst View" toggle to show what gets missed without AI
- One-click escalate to CFO with toast notifications
- ROI panel: $50/mo agents vs $8,300/mo human analyst (166x cheaper)
- Live chat with agent routing (Vendor Watch answers vendor questions, APAR answers AR questions, etc.)
- Run Live Analysis button for ad-hoc anomaly detection per agent

## Running Locally

```bash
npm install
```

Create `.env.local`:

```
GROQ_API_KEY=your_key
CEREBRAS_API_KEY=your_key
```

Then:

```bash
npm run dev
```

Open localhost:3000.

## Built By

Jack Gross — Cal Poly San Luis Obispo
