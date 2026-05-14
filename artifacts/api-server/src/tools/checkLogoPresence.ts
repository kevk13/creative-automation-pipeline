import fs from "fs";
import { createAnthropicClient, TEXT_MODEL } from "../lib/ai-clients.js";
import { calcClaudeCost, logStep } from "../campaign-logger.js";
import { recordCost } from "../lib/runStore.js";

export type CheckLogoPresenceResult = {
  logoPresent: boolean;
  reasoning: string;
};

export async function checkLogoPresence(
  imagePath: string,
  runId?: string
): Promise<CheckLogoPresenceResult> {
  try {
    const anthropic = createAnthropicClient();
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");

    const response = await anthropic.messages.create({
      model: TEXT_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: 'Is there a brand logo, text logo, or watermark visible in this image? Answer with JSON only: {"logoPresent": true/false, "reasoning": "brief explanation"}',
            },
          ],
        },
      ],
    });

    const cost = calcClaudeCost(
      response.usage.input_tokens,
      response.usage.output_tokens
    );

    logStep("checkLogoPresence", "Logo check complete", {
      imagePath,
      costUSD: cost,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: TEXT_MODEL,
    });

    if (runId) {
      recordCost(runId, {
        tool: "checkLogoPresence",
        model: TEXT_MODEL,
        step: "checkCompliance",
        product: imagePath.split("/").slice(-3, -2)[0] ?? "unknown",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUSD: cost,
        timestamp: new Date().toISOString(),
      });
    }

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as CheckLogoPresenceResult;
      return parsed;
    }

    return {
      logoPresent: false,
      reasoning: "Could not parse vision response",
    };
  } catch (err) {
    return {
      logoPresent: false,
      reasoning: `Vision check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
