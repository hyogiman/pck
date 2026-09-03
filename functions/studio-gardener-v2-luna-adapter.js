"use strict";

const {
  MODEL_ROUTES
} = require("./ai-v2-core");

const STUDIO_LUNA_SCHEMA_NAME =
  "studio_gardener_v2_plan";

const STUDIO_LUNA_MAX_OUTPUT_TOKENS =
  1200;

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

function normalizeStudioLunaUsage(
  response
) {
  const usage =
    response?.usage || {};

  return {
    inputTokens:
      Number(
        usage.input_tokens || 0
      ),

    cachedInputTokens:
      Number(
        usage
          .input_tokens_details
          ?.cached_tokens || 0
      ),

    outputTokens:
      Number(
        usage.output_tokens || 0
      ),

    reasoningTokens:
      Number(
        usage
          .output_tokens_details
          ?.reasoning_tokens || 0
      ),

    totalTokens:
      Number(
        usage.total_tokens || 0
      )
  };
}

function extractStudioLunaText(
  response
) {
  if (
    typeof response?.output_text ===
      "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  for (
    const item of
    Array.isArray(response?.output)
      ? response.output
      : []
  ) {
    if (item?.type !== "message") {
      continue;
    }

    for (
      const part of
      Array.isArray(item.content)
        ? item.content
        : []
    ) {
      if (
        part?.type === "output_text" &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        return part.text.trim();
      }
    }
  }

  return "";
}

function buildStudioLunaRequestBody({
  systemPrompt,
  input,
  schema
} = {}) {
  return {
    model:
      MODEL_ROUTES.discovery,

    input: [
      {
        role: "system",
        content:
          String(
            systemPrompt || ""
          )
      },

      {
        role: "user",
        content:
          JSON.stringify(
            input || {}
          )
      }
    ],

    reasoning: {
      effort: "medium"
    },

    text: {
      verbosity: "low",

      format: {
        type: "json_schema",
        name:
          STUDIO_LUNA_SCHEMA_NAME,
        strict: true,
        schema
      }
    },

    max_output_tokens:
      STUDIO_LUNA_MAX_OUTPUT_TOKENS
  };
}

async function requestStudioLuna({
  systemPrompt,
  input,
  schema,
  apiKey =
    process.env.OPENAI_API_KEY,
  fetchImpl =
    globalThis.fetch
} = {}) {
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required"
    );
  }

  if (
    typeof fetchImpl !== "function"
  ) {
    throw new TypeError(
      "fetchImpl is required"
    );
  }

  const body =
    buildStudioLunaRequestBody({
      systemPrompt,
      input,
      schema
    });

  const response =
    await fetchImpl(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );

  const raw =
    await response.text();

  let data = null;

  try {
    data = JSON.parse(raw);
  } catch (_) {}

  const usage =
    normalizeStudioLunaUsage(
      data
    );

  if (!response.ok) {
    return {
      ok: false,
      parsed: null,
      usage,
      responseId:
        String(
          data?.id || ""
        ),
      status:
        Number(
          response.status || 0
        )
    };
  }

  const text =
    extractStudioLunaText(
      data
    );

  let parsed = null;

  try {
    if (text) {
      parsed =
        JSON.parse(text);
    }
  } catch (_) {}

  return {
    ok: Boolean(parsed),
    parsed,
    usage,
    responseId:
      String(
        data?.id || ""
      ),
    status:
      Number(
        response.status || 0
      )
  };
}

module.exports = {
  STUDIO_LUNA_SCHEMA_NAME,
  STUDIO_LUNA_MAX_OUTPUT_TOKENS,
  emptyUsage,
  normalizeStudioLunaUsage,
  extractStudioLunaText,
  buildStudioLunaRequestBody,
  requestStudioLuna
};