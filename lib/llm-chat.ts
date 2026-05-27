export type ChatMessage = { role: "system" | "user"; content: string };

export type ProviderApiError = {
  provider: "groq" | "cerebras";
  status: number;
  message: string;
  body: string;
};

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_CHAT_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODELS_URL = "https://api.cerebras.ai/v1/models";

const CEREBRAS_MODEL = "gpt-oss-120b";
const CEREBRAS_FALLBACK_MODEL = "zai-glm-4.7";

let cerebrasModelsLogged = false;

function parseApiErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? body;
  } catch {
    return body || "Unknown API error";
  }
}

/** One-time per process: log available models for this API key. */
async function logCerebrasModelsOnce(apiKey: string) {
  if (cerebrasModelsLogged) return;
  cerebrasModelsLogged = true;

  try {
    const res = await fetch(CEREBRAS_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await res.text();
    console.log("Cerebras GET /v1/models:", { status: res.status, body });

    try {
      const parsed = JSON.parse(body) as { data?: { id?: string }[] };
      const ids = parsed.data?.map((m) => m.id).filter(Boolean) ?? [];
      if (ids.length) {
        console.log("Cerebras available model ids:", ids);
      }
    } catch {
      // body already logged as text
    }
  } catch (err) {
    console.log("Cerebras GET /v1/models failed:", err);
  }
}

type CompletionMessage = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
};

type CerebrasRequestOptions = {
  reasoning_effort?: "low" | "medium" | "high" | "none";
  reasoning_format?: "parsed" | "raw" | "hidden" | "none";
};

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractMessageContent(message?: CompletionMessage): string {
  if (!message) return "";
  const content = pickString(message.content);
  if (content) return content;
  const reasoning = pickString(message.reasoning);
  if (reasoning) return reasoning;
  return pickString(message.reasoning_content);
}

function isEmptyContentError(error: ProviderApiError): boolean {
  return error.message === "No content in completion response";
}

type CerebrasAttempt = {
  model: string;
  maxTokens: number;
  temperature: number;
  cerebrasOptions?: CerebrasRequestOptions;
  label: string;
};

async function callCerebras(
  apiKey: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<{ ok: true; content: string; model: string } | { ok: false; error: ProviderApiError }> {
  await logCerebrasModelsOnce(apiKey);

  const tokenFloor = Math.max(maxTokens, 2048);
  const attempts: CerebrasAttempt[] = [
    {
      model: CEREBRAS_MODEL,
      maxTokens: tokenFloor,
      temperature,
      cerebrasOptions: { reasoning_effort: "low", reasoning_format: "parsed" },
      label: "gpt-oss parsed, low reasoning",
    },
    {
      model: CEREBRAS_MODEL,
      maxTokens: Math.max(tokenFloor, 4096),
      temperature: 0.3,
      cerebrasOptions: { reasoning_effort: "low", reasoning_format: "raw" },
      label: "gpt-oss raw, low reasoning, high max_tokens",
    },
    {
      model: CEREBRAS_FALLBACK_MODEL,
      maxTokens: tokenFloor,
      temperature: 0.3,
      cerebrasOptions: { reasoning_effort: "none" },
      label: "zai-glm-4.7, reasoning off",
    },
  ];

  let lastError: ProviderApiError | null = null;

  for (const attempt of attempts) {
    const result = await callProvider(
      "cerebras",
      apiKey,
      attempt.model,
      messages,
      attempt.maxTokens,
      attempt.temperature,
      attempt.cerebrasOptions
    );

    if (result.ok) {
      console.log(`Cerebras fallback succeeded (${attempt.label}) with model: ${attempt.model}`);
      return { ...result, model: attempt.model };
    }

    lastError = result.error;
    console.log(
      `Cerebras attempt failed [${attempt.label}] model=${attempt.model} (${result.error.status}): ${result.error.message}`
    );

    if (!isEmptyContentError(result.error)) {
      break;
    }
  }

  return { ok: false, error: lastError! };
}

async function callProvider(
  provider: "groq" | "cerebras",
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  cerebrasOptions?: CerebrasRequestOptions
): Promise<{ ok: true; content: string } | { ok: false; error: ProviderApiError }> {
  const url = provider === "groq" ? GROQ_CHAT_URL : CEREBRAS_CHAT_URL;
  const requestModel = model;

  const requestBody: Record<string, unknown> = {
    model: requestModel,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  if (provider === "cerebras" && cerebrasOptions) {
    if (cerebrasOptions.reasoning_effort) {
      requestBody.reasoning_effort = cerebrasOptions.reasoning_effort;
    }
    if (cerebrasOptions.reasoning_format) {
      requestBody.reasoning_format = cerebrasOptions.reasoning_format;
    }
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        error: {
          provider,
          status: res.status,
          message: parseApiErrorMessage(body),
          body,
        },
      };
    }

    const completionBody = await res.text();
    let completion: {
      choices?: { message?: CompletionMessage; finish_reason?: string }[];
    };
    try {
      completion = JSON.parse(completionBody) as {
        choices?: { message?: CompletionMessage; finish_reason?: string }[];
      };
    } catch {
      return {
        ok: false,
        error: {
          provider,
          status: 502,
          message: "Invalid JSON in completion response",
          body: completionBody,
        },
      };
    }

    const message = completion.choices?.[0]?.message;
    const content = extractMessageContent(message);
    if (!content) {
      const finishReason = completion.choices?.[0]?.finish_reason;
      console.log("Empty LLM completion:", {
        provider,
        model: requestModel,
        finishReason,
        messageKeys: message ? Object.keys(message) : [],
        bodyPreview: completionBody.slice(0, 1500),
      });
      return {
        ok: false,
        error: {
          provider,
          status: 502,
          message: "No content in completion response",
          body: completionBody,
        },
      };
    }

    if (provider === "cerebras" && !pickString(message?.content) && pickString(message?.reasoning)) {
      console.log("Cerebras: using reasoning field as response body");
    }

    return { ok: true, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        provider,
        status: 0,
        message,
        body: "",
      },
    };
  }
}

export class LlmProviderError extends Error {
  readonly groqError: ProviderApiError;
  readonly cerebrasError: ProviderApiError | null;

  constructor(groqError: ProviderApiError, cerebrasError: ProviderApiError | null) {
    const msg = cerebrasError
      ? `Groq API error (${groqError.status}): ${groqError.message}; Cerebras fallback (${cerebrasError.status}): ${cerebrasError.message}`
      : `Groq API error (${groqError.status}): ${groqError.message}`;
    super(msg);
    this.name = "LlmProviderError";
    this.groqError = groqError;
    this.cerebrasError = cerebrasError;
  }
}

/** Try Groq first; on any failure, retry with Cerebras. Throws LlmProviderError if both fail. */
export async function chatWithFailover(options: {
  groqApiKey: string;
  cerebrasApiKey?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const { groqApiKey, cerebrasApiKey, model, messages, maxTokens, temperature } = options;

  const groqResult = await callProvider(
    "groq",
    groqApiKey,
    model,
    messages,
    maxTokens,
    temperature
  );

  if (groqResult.ok) {
    console.log("Used Groq");
    return groqResult.content;
  }

  const groqError = groqResult.error;
  console.log("Groq failed, attempting Cerebras fallback:", {
    status: groqError.status,
    message: groqError.message,
  });

  const cerebrasKey = cerebrasApiKey?.trim();
  if (!cerebrasKey) {
    throw new LlmProviderError(groqError, null);
  }

  const cerebrasResult = await callCerebras(cerebrasKey, messages, maxTokens, temperature);

  if (cerebrasResult.ok) {
    console.log(`Used Cerebras fallback (${cerebrasResult.model})`);
    return cerebrasResult.content;
  }

  throw new LlmProviderError(groqError, cerebrasResult.error);
}
