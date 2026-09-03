"use strict";

const assert = require("node:assert/strict");

const {
  MODEL_ROUTES
} = require("./ai-v2-core");

const {
  STUDIO_LUNA_SCHEMA_NAME,
  STUDIO_LUNA_MAX_OUTPUT_TOKENS,
  buildStudioLunaRequestBody,
  requestStudioLuna
} = require("./studio-gardener-v2-luna-adapter");

function testRequestBody() {
  const schema = {
    type: "object",
    properties: {
      decision: {
        type: "string"
      }
    },
    required: [
      "decision"
    ],
    additionalProperties: false
  };

  const body =
    buildStudioLunaRequestBody({
      systemPrompt:
        "planner prompt",

      input: {
        currentDraft:
          "내가 쓴 글"
      },

      schema
    });

  assert.equal(
    body.model,
    MODEL_ROUTES.discovery
  );

  assert.equal(
    body.input[0].role,
    "system"
  );

  assert.equal(
    body.input[0].content,
    "planner prompt"
  );

  assert.equal(
    body.input[1].role,
    "user"
  );

  assert.deepEqual(
    JSON.parse(
      body.input[1].content
    ),
    {
      currentDraft:
        "내가 쓴 글"
    }
  );

  assert.equal(
    body.reasoning.effort,
    "medium"
  );

  assert.equal(
    body.text.verbosity,
    "low"
  );

  assert.equal(
    body.text.format.type,
    "json_schema"
  );

  assert.equal(
    body.text.format.name,
    STUDIO_LUNA_SCHEMA_NAME
  );

  assert.equal(
    body.text.format.strict,
    true
  );

  assert.equal(
    body.text.format.schema,
    schema
  );

  assert.equal(
    body.max_output_tokens,
    STUDIO_LUNA_MAX_OUTPUT_TOKENS
  );
}

async function testSuccessfulRequest() {
  let capturedUrl = "";
  let capturedOptions = null;

  const fakePlan = {
    decision: "silent",
    mode: "silent",
    reason:
      "지금은 계속 쓰는 편이 낫다.",
    primaryEvidence: "",
    materialId: "",
    materialEvidence: "",
    scores: {
      grounded: 5,
      novel: 3,
      addsValue: 2,
      contextFit: 5,
      thinkingDeveloped: 2
    }
  };

  const fetchImpl =
    async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return {
        ok: true,
        status: 200,

        text:
          async () =>
            JSON.stringify({
              id:
                "resp_studio_test",

              output_text:
                JSON.stringify(
                  fakePlan
                ),

              usage: {
                input_tokens: 321,

                input_tokens_details: {
                  cached_tokens: 40
                },

                output_tokens: 91,

                output_tokens_details: {
                  reasoning_tokens: 25
                },

                total_tokens: 412
              }
            })
      };
    };

  const result =
    await requestStudioLuna({
      systemPrompt:
        "Studio planner",

      input: {
        projectTitle:
          "테스트 프로젝트"
      },

      schema: {
        type: "object"
      },

      apiKey:
        "test-api-key",

      fetchImpl
    });

  assert.equal(
    capturedUrl,
    "https://api.openai.com/v1/responses"
  );

  assert.equal(
    capturedOptions.method,
    "POST"
  );

  assert.equal(
    capturedOptions.headers.Authorization,
    "Bearer test-api-key"
  );

  assert.equal(
    capturedOptions.headers[
      "Content-Type"
    ],
    "application/json"
  );

  const sentBody =
    JSON.parse(
      capturedOptions.body
    );

  assert.equal(
    sentBody.model,
    MODEL_ROUTES.discovery
  );

  assert.equal(
    sentBody.text.format.strict,
    true
  );

  assert.equal(
    result.ok,
    true
  );

  assert.deepEqual(
    result.parsed,
    fakePlan
  );

  assert.equal(
    result.responseId,
    "resp_studio_test"
  );

  assert.equal(
    result.status,
    200
  );

  assert.deepEqual(
    result.usage,
    {
      inputTokens: 321,
      cachedInputTokens: 40,
      outputTokens: 91,
      reasoningTokens: 25,
      totalTokens: 412
    }
  );
}

async function testApiFailure() {
  const result =
    await requestStudioLuna({
      systemPrompt:
        "Studio planner",

      input: {},

      schema: {
        type: "object"
      },

      apiKey:
        "test-api-key",

      fetchImpl:
        async () => ({
          ok: false,
          status: 429,

          text:
            async () =>
              JSON.stringify({
                error: {
                  message:
                    "rate limited"
                },

                usage: {
                  total_tokens: 0
                }
              })
        })
    });

  assert.equal(
    result.ok,
    false
  );

  assert.equal(
    result.parsed,
    null
  );

  assert.equal(
    result.status,
    429
  );
}

async function main() {
  testRequestBody();
  await testSuccessfulRequest();
  await testApiFailure();

  console.log(
    "STUDIO_GARDENER_V2_LUNA_ADAPTER_TEST_PASS"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});