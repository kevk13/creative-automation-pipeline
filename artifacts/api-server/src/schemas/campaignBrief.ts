import { z } from "zod";

export const ProductSchema = z.object({
  productName: z.string().min(1),
  productDescription: z.string().min(1),
  localAssetPath: z.string().optional(),
});

export const CampaignBriefSchema = z.object({
  clientName: z.string().min(1),
  products: z.array(ProductSchema).min(2),
  targetRegion: z.string().min(1),
  targetAudience: z.string().min(1),
  campaignMessage: z.string().min(1),
  brandPalette: z.array(z.string()).optional(),
  prohibitedWords: z.array(z.string()).optional(),
});

export type Product = z.infer<typeof ProductSchema>;
export type CampaignBrief = z.infer<typeof CampaignBriefSchema>;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
