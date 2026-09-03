"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  MODEL_ROUTES
} = require("./ai-v2-core");

const {
  STUDIO_TERRA_MAX_OUTPUT_TOKENS,
  buildStudioTerraRequestBody,
  requestStudioTerra
} = require("./studio-gardener-v2-terra-adapter");

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
  additionalProperties:
    false
};

function testRequestBody() {
  const body =
    buildStudioTerraRequestBody({
      systemPrompt:
        "system",

      input: {
        hello: "world"
      },

      schema,

      schemaName:
        "studio_test"
    });

  assert.equal(
    body.model,
    MODEL_ROUTES.speaking
  );

  assert.equal(
    body.reasoning.effort,
    MODEL_ROUTES
      .speakingReasoningEffort
  );

  assert.equal(
    body.text.verbosity,
    "low"
  );

  assert.equal(
    body.text.format.strict,
    true
  );

  assert.equal(
    body.text.format.name,
    "studio_test"
  );

  assert.equal(
    body.max_output_tokens,
    STUDIO_TERRA_MAX_OUTPUT_TOKENS
  );
}

async function testSuccess() {
  let calls = 0;

  const result =
    await requestStudioTerra({
      systemPrompt:
        "system",

      input: {
        action: "deepen"
      },

      schema,

      schemaName:
        "studio_test",

      apiKey:
        "test-key",

      fetchImpl:
        async (
          url,
          options
        ) => {
          calls += 1;

          assert.equal(
            url,
            "https://api.openai.com/v1/responses"
          );

          assert.equal(
            options.method,
            "POST"
          );

          const body =
            JSON.parse(
              options.body
            );

          assert.equal(
            body.model,
            MODEL_ROUTES.speaking
          );

          return {
            ok: true,
            status: 200,

            text:
              async () =>
                JSON.stringify({
                  id:
                    "resp_terra_test",

                  output_text:
                    JSON.stringify({
                      decision:
                        "speak"
                    }),

                  usage: {
                    input_tokens:
                      300,

                    input_tokens_details: {
                      cached_tokens:
                        20
                    },

                    output_tokens:
                      100,

                    output_tokens_details: {
                      reasoning_tokens:
                        35
                    },

                    total_tokens:
                      400
                  }
                })
          };
        }
    });

  assert.equal(
    calls,
    1
  );

  assert.equal(
    result.ok,
    true
  );

  assert.equal(
    result.parsed.decision,
    "speak"
  );

  assert.equal(
    result.responseId,
    "resp_terra_test"
  );

  assert.equal(
    result.usage.totalTokens,
    400
  );

  assert.equal(
    result.usage.reasoningTokens,
    35
  );
}

async function testFailure() {
  const result =
    await requestStudioTerra({
      systemPrompt:
        "system",

      input: {},

      schema,

      apiKey:
        "test-key",

      fetchImpl:
        async () => ({
          ok: false,
          status: 429,

          text:
            async () =>
              JSON.stringify({
                error: {
                  message:
                    "rate limit"
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
  await testSuccess();
  await testFailure();

  console.log(
    "STUDIO_GARDENER_V2_TERRA_ADAPTER_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);