import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

const Input = z.object({
  isolateLabel: z.string().trim().min(1).max(80),
  organism: z.string().trim().min(2).max(120),
  specimenSource: z.string().trim().min(2).max(80),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  location: z.string().trim().max(120).nullable(),
  clinicalNotes: z.string().trim().max(1000).nullable(),
  fileName: z.string().max(255),
  fileSizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
  stats: z.object({
    format: z.enum(["FASTA", "FASTQ"]),
    records: z.number().int().min(1),
    totalBases: z.number().int().min(100),
    gcPercent: z.number().min(0).max(100),
    nPercent: z.number().min(0).max(100),
    longestRecord: z.number().int(),
    n50: z.number().int(),
    headers: z.array(z.string().max(120)).max(8),
    excerpt: z.string().max(4000).regex(/^[ACGTNRYKMSWBDHV]*$/),
  }),
});

const SummarySchema = z.object({
  overall_risk: z.enum(["low", "moderate", "high", "critical"]),
  headline: z.string(),
  summary: z.string(),
  drug_risks: z.array(
    z.object({
      drug: z.string(),
      risk: z.enum(["low", "moderate", "high"]),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
  evidence: z.array(z.object({ finding: z.string(), significance: z.string() })),
  recommendations: z.array(z.string()),
  limitations: z.array(z.string()),
});

export type AmrSummary = z.infer<typeof SummarySchema>;
export type AmrSummaryResult =
  | { ok: true; id: string; summary: AmrSummary }
  | { ok: false; message: string };

const SYSTEM = `You are BactoAI's antimicrobial-resistance (AMR) interpretation assistant for laboratory scientists.
You receive organism metadata plus summary statistics and a short excerpt of a bacterial genome sequence.
Produce an explainable AMR risk summary. Base it on: intrinsic and commonly acquired resistance for the organism,
specimen source, regional epidemiology (e.g. East Africa) if a location is given, and assembly quality signals.
Be honest: you cannot detect specific resistance genes from a short excerpt — say so in limitations and frame drug risks
as prior-informed estimates, never definitive calls. Cover 6-8 clinically relevant antibiotics for this organism.
confidence is 0-100. Keep summary under 120 words, each rationale under 35 words, 3-5 evidence items, 3-5 recommendations,
2-4 limitations. Always recommend confirmatory phenotypic AST. Research use only.`;

export const generateAmrSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AmrSummaryResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok: false, message: "AI analysis isn't configured yet." };

    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const { excerpt, ...stats } = data.stats;
    const prompt = `Isolate: ${data.isolateLabel}
Organism: ${data.organism}
Specimen: ${data.specimenSource}
Collection date: ${data.collectionDate ?? "not provided"}
Location: ${data.location ?? "not provided"}
Clinical notes: ${data.clinicalNotes ?? "none"}
File: ${data.fileName}
Sequence stats: ${JSON.stringify(stats)}
Sequence excerpt (first ${excerpt.length} bases): ${excerpt.slice(0, 1500)}`;

    let summary: AmrSummary;
    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        prompt,
        output: Output.object({ schema: SummarySchema }),
        maxRetries: 0,
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      summary = await result.output;
    } catch (err) {
      console.error("[amr-summary] generation failed", err);
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 402) return { ok: false, message: "AI credits are exhausted. Add credits in workspace settings and try again." };
      if (status === 429) return { ok: false, message: "The AI service is busy. Please wait a minute and try again." };
      if (NoObjectGeneratedError.isInstance(err))
        return { ok: false, message: "The AI returned an incomplete summary. Please try again." };
      return { ok: false, message: "The AI summary couldn't be generated. Please try again shortly." };
    }

    summary.drug_risks = summary.drug_risks.slice(0, 10).map((d) => ({
      ...d,
      confidence: Math.max(0, Math.min(100, Math.round(d.confidence))),
    }));

    const { data: row, error } = await context.supabase
      .from("genome_analyses")
      .insert({
        user_id: context.userId,
        isolate_label: data.isolateLabel,
        organism: data.organism,
        specimen_source: data.specimenSource,
        collection_date: data.collectionDate,
        location: data.location,
        clinical_notes: data.clinicalNotes,
        file_name: data.fileName,
        file_size_bytes: data.fileSizeBytes,
        sequence_stats: stats,
        overall_risk: summary.overall_risk,
        summary,
      })
      .select("id")
      .single();
    if (error) console.error("[amr-summary] save failed", error);

    return { ok: true, id: row?.id ?? "", summary };
  });
