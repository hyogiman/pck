"use strict";

const {
  MODEL_ROUTES
} = require("./ai-v2-core");

const STUDIO_TERRA_MAX_OUTPUT_TOKENS =
  1800;

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

function normalizeStudioTerraUsage(
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

function extractStudioTerraText(
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
    if (
      item?.type !==
      "message"
    ) {
      continue;
    }

    for (
      const part of
      Array.isArray(item.content)
        ? item.content
        : []
    ) {
      if (
        part?.type ===
          "output_text" &&
        typeof part.text ===
          "string" &&
        part.text.trim()
      ) {
        return part.text.trim();
      }
    }
  }

  return "";
}

function buildStudioTerraRequestBody({
  systemPrompt,
  input,
  schema,
  schemaName
} = {}) {
  return {
    model:
      MODEL_ROUTES.speaking,

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
      effort:
        MODEL_ROUTES
          .speakingReasoningEffort
    },

    text: {
      verbosity: "low",

      format: {
        type: "json_schema",

        name:
          String(
            schemaName ||
            "studio_gardener_v2_generation"
          ),

        strict: true,

        schema
      }
    },

    max_output_tokens:
      STUDIO_TERRA_MAX_OUTPUT_TOKENS
  };
}

async function requestStudioTerra({
  systemPrompt,
  input,
  schema,
  schemaName,

  apiKey =
    process.env
      .OPENAI_API_KEY,

  fetchImpl =
    globalThis.fetch
} = {}) {
  if (
    !String(
      apiKey || ""
    ).trim()
  ) {
    throw new TypeError(
      "OpenAI API key is required"
    );
  }

  if (
    typeof fetchImpl !==
    "function"
  ) {
    throw new TypeError(
      "fetch adapter is required"
    );
  }

  const response =
    await fetchImpl(
      "https://api.openai.com/v1/responses",

      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${apiKey}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            buildStudioTerraRequestBody({
              systemPrompt,
              input,
              schema,
              schemaName
            })
          )
      }
    );

  const raw =
    await response.text();

  let payload = null;

  try {
    payload =
      JSON.parse(raw);
  } catch (_) {
    payload = null;
  }

  const usage =
    normalizeStudioTerraUsage(
      payload
    );

  if (!response.ok) {
    return {
      ok: false,
      parsed: null,
      usage,

      responseId:
        String(
          payload?.id || ""
        ),

      status:
        Number(
          response.status || 0
        )
    };
  }

  const outputText =
    extractStudioTerraText(
      payload
    );

  let parsed = null;

  if (outputText) {
    try {
      parsed =
        JSON.parse(
          outputText
        );
    } catch (_) {
      parsed = null;
    }
  }

  return {
    ok:
      Boolean(parsed),

    parsed,

    usage,

    responseId:
      String(
        payload?.id || ""
      ),

    status:
      Number(
        response.status || 0
      )
  };
}

module.exports = {
  STUDIO_TERRA_MAX_OUTPUT_TOKENS,
  emptyUsage,
  normalizeStudioTerraUsage,
  extractStudioTerraText,
  buildStudioTerraRequestBody,
  requestStudioTerra
};