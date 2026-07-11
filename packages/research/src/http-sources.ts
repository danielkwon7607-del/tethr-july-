import { QuotaExceededError } from "./quota";
import type { ResearchQuery, ResearchSource, SourceEvidence } from "./sources";

// Real source clients (Ch 11 §11.2, §21). Deploy-time: exercised by the runner
// against live providers, gated on API keys — the same posture as the Spectrum
// adapter (ADR 0009), so the acceptance suite runs against fakes and live-wire
// verification is a deploy-time smoke (tracked, ADR 0013). Every call is
// centralized here behind the ResearchSource port — never a raw SDK call in
// pipeline stage code (Rec #6). A provider 429 throws QuotaExceededError so the
// pipeline fails fast on that source instead of hammering it.
//
// Build 7 source scope (CEO, 2026-07-10): xAI X Search (primary), Hacker News
// (free, keyless), Serper (web presence) + Serper funding queries as the
// funded_competition stand-in (Crunchbase deferred on cost, ADR 0013).

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

async function guardedFetch(url: string, init: RequestInit, source: string): Promise<unknown> {
  const response = await fetch(url, init);
  if (response.status === 429) throw new QuotaExceededError(source);
  if (!response.ok) throw new Error(`${source} responded ${response.status}`);
  return response.json();
}

// --- Hacker News (Algolia HN Search API — free, keyless) ---
type HnResponse = { hits?: { title?: string; url?: string; objectID?: string; points?: number }[] };

function hackerNewsSource(): ResearchSource {
  return {
    id: "hackernews",
    signalType: "technical_reception",
    async fetch(query) {
      const url = `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query.idea)}`;
      const data = (await guardedFetch(url, {}, "hackernews")) as HnResponse;
      const hits = (data.hits ?? []).slice(0, 10).filter((h) => h.title);
      return hits.map(
        (h): SourceEvidence => ({
          source: "hackernews",
          signalType: "technical_reception",
          title: h.title ?? "",
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID ?? ""}`,
          // v0 strength: early-adopter interest from points, normalized to ~200.
          strength: clamp01((h.points ?? 0) / 200),
        }),
      );
    },
  };
}

// --- Serper (google.serper.dev) — web presence + funding-query substitute ---
type SerperResponse = { organic?: { title?: string; link?: string; snippet?: string }[] };

function serperSource(apiKey: string, variant: "web" | "funding"): ResearchSource {
  const id = variant === "web" ? "serper" : "serper_funding";
  const signalType = variant === "web" ? "web_presence" : "funded_competition";
  const fundingTerms = /funding|raised|series [a-e]\b|seed round|venture/i;
  return {
    id,
    signalType,
    async fetch(query) {
      const q =
        variant === "web"
          ? query.idea
          : `${query.idea} funding round OR "Series A" OR raised venture`;
      const data = (await guardedFetch(
        "https://google.serper.dev/search",
        {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        },
        id,
      )) as SerperResponse;
      const organic = (data.organic ?? []).slice(0, 10).filter((r) => r.title && r.link);
      const items = organic.map(
        (r): SourceEvidence => ({
          source: id,
          signalType,
          title: r.title ?? "",
          url: r.link ?? "",
          // v0 strength. web: competitor surface density (results present /10).
          // funding: fraction of results that actually mention funding — the
          // lower-fidelity Crunchbase stand-in.
          strength:
            variant === "web"
              ? clamp01(organic.length / 10)
              : clamp01(fundingTerms.test(r.snippet ?? "") ? 0.8 : 0.2),
        }),
      );
      return items;
    },
  };
}

// --- xAI X Search (Grok live search over X) ---
type XaiResponse = { choices?: { message?: { content?: string } }[] };

function xaiSource(apiKey: string): ResearchSource {
  return {
    id: "xai",
    signalType: "live_sentiment",
    async fetch(query) {
      // Grok chat completion with Live Search over X; asked to return evidence
      // JSON with a 0..1 demand-sentiment strength per item.
      const data = (await guardedFetch(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "grok-4",
            search_parameters: { mode: "on", sources: [{ type: "x" }] },
            messages: [
              {
                role: "system",
                content:
                  'Search X for real demand signal on the idea. Return ONLY JSON {"items":[{"title","url","strength"}]} where strength is 0..1 demand/interest. Max 10.',
              },
              { role: "user", content: query.idea },
            ],
          }),
        },
        "xai",
      )) as XaiResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      let parsed: { items?: { title?: string; url?: string; strength?: number }[] };
      try {
        parsed = JSON.parse(
          content
            .trim()
            .replace(/^```[a-z0-9]*\s*/i, "")
            .replace(/\s*```$/, ""),
        );
      } catch {
        return []; // a malformed model response degrades to no signal, not a crash
      }
      return (parsed.items ?? [])
        .slice(0, 10)
        .filter((i) => i.title)
        .map(
          (i): SourceEvidence => ({
            source: "xai",
            signalType: "live_sentiment",
            title: i.title ?? "",
            url: i.url ?? "https://x.com",
            strength: clamp01(typeof i.strength === "number" ? i.strength : 0.5),
          }),
        );
    },
  };
}

export type HttpSourcesConfig = {
  xaiApiKey?: string;
  serperApiKey?: string;
};

/**
 * The live source set for the runner. HN is always included (keyless); xAI and
 * Serper are included only when their key is present, so a missing key drops a
 * source rather than crashing the pipeline (which synthesizes over what it has).
 */
export function createHttpSources(config: HttpSourcesConfig): ResearchSource[] {
  const sources: ResearchSource[] = [hackerNewsSource()];
  if (config.xaiApiKey) sources.push(xaiSource(config.xaiApiKey));
  if (config.serperApiKey) {
    sources.push(serperSource(config.serperApiKey, "web"));
    sources.push(serperSource(config.serperApiKey, "funding"));
  }
  return sources;
}
