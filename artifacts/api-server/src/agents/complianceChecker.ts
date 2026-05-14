import { extractColors } from "../tools/extractColors.js";
import { checkLogoPresence } from "../tools/checkLogoPresence.js";
import { logStep, logStepError } from "../campaign-logger.js";
import type { CampaignBrief } from "../schemas/campaignBrief.js";

export type ColorComplianceItem = {
  imagePath: string;
  productName: string;
  aspectRatio: string;
  dominantColors: string[];
  score: number;
  pass: boolean;
};

export type LogoComplianceItem = {
  imagePath: string;
  productName: string;
  aspectRatio: string;
  logoPresent: boolean;
  reasoning: string;
};

export type LegalCompliance = {
  passed: boolean;
  matches: string[];
};

export type ComplianceReport = {
  generatedAt: string;
  colorCompliance: ColorComplianceItem[];
  logoCompliance: LogoComplianceItem[];
  legalCompliance: LegalCompliance;
};

/**
 * Compliance Checker Agent
 * System: "You verify creative assets against brand and legal guidelines."
 * Tools: extractColors, checkLogoPresence
 */
export async function runComplianceCheckerAgent(
  brief: CampaignBrief,
  renders: Record<string, Record<string, string>>,
  runId?: string
): Promise<ComplianceReport> {
  const colorCompliance: ColorComplianceItem[] = [];
  const logoCompliance: LogoComplianceItem[] = [];

  for (const [productName, ratioMap] of Object.entries(renders)) {
    for (const [ratio, filePath] of Object.entries(ratioMap)) {
      const finalPath = filePath.endsWith("final.png") ? filePath : filePath;

      try {
        logStep("complianceChecker", `Checking colors: ${productName} ${ratio}`);
        const colorResult = await extractColors(finalPath, brief.brandPalette || []);
        colorCompliance.push({
          imagePath: finalPath,
          productName,
          aspectRatio: ratio,
          dominantColors: colorResult.dominantColors,
          score: colorResult.paletteScore,
          pass: colorResult.paletteScore >= 0.3,
        });
      } catch (err) {
        logStepError("complianceChecker", err, { productName, ratio, step: "colors" });
        colorCompliance.push({
          imagePath: finalPath,
          productName,
          aspectRatio: ratio,
          dominantColors: [],
          score: 0,
          pass: false,
        });
      }

      try {
        logStep("complianceChecker", `Checking logo: ${productName} ${ratio}`);
        const logoResult = await checkLogoPresence(finalPath, runId);
        logoCompliance.push({
          imagePath: finalPath,
          productName,
          aspectRatio: ratio,
          logoPresent: logoResult.logoPresent,
          reasoning: logoResult.reasoning,
        });
      } catch (err) {
        logStepError("complianceChecker", err, { productName, ratio, step: "logo" });
        logoCompliance.push({
          imagePath: finalPath,
          productName,
          aspectRatio: ratio,
          logoPresent: false,
          reasoning: "Check failed",
        });
      }
    }
  }

  const legalMatches: string[] = [];
  const msg = brief.campaignMessage.toLowerCase();
  for (const word of brief.prohibitedWords || []) {
    if (msg.includes(word.toLowerCase())) {
      legalMatches.push(word);
    }
  }

  const legalCompliance: LegalCompliance = {
    passed: legalMatches.length === 0,
    matches: legalMatches,
  };

  logStep("complianceChecker", "Compliance check complete", {
    colorItems: colorCompliance.length,
    logoItems: logoCompliance.length,
    legalPassed: legalCompliance.passed,
  });

  return {
    generatedAt: new Date().toISOString(),
    colorCompliance,
    logoCompliance,
    legalCompliance,
  };
}
