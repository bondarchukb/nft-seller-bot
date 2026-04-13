import Anthropic from "@anthropic-ai/sdk";
import { NFTAttribute } from "../models/NFT";

// ── Generated NFT metadata ─────────────────────────────────────────────────

export interface GeneratedMetadata {
  name: string;
  description: string;
  image: string;          // Descriptive prompt / placeholder — swap for real image URL
  attributes: NFTAttribute[];
  generatedBy: "llm" | "fallback";
}

export interface GenerationOptions {
  theme?: string;         // e.g. "cyberpunk warriors", "space cats", "medieval knights"
  collectionName?: string;
  tokenId: number;
  existingNames?: string[];  // Avoid duplicate names in the collection
}

// ── Retry config ────────────────────────────────────────────────────────────

const MAX_RETRIES    = 3;
const BASE_DELAY_MS  = 1000;   // 1 s → 2 s → 4 s

// ── Fallback trait pools (used when LLM is unavailable) ────────────────────

const FALLBACK_BACKGROUNDS = [
  "Void", "Nebula", "Sunset", "Forest", "Ocean", "City", "Desert", "Glacier",
  "Volcano", "Aurora", "Storm", "Crystal Cave",
];
const FALLBACK_TYPES = [
  "Warrior", "Mage", "Scout", "Guardian", "Oracle", "Phantom",
  "Titan", "Nomad", "Rogue", "Sage", "Bard", "Alchemist",
];
const FALLBACK_RARITIES: Array<{ label: string; weight: number }> = [
  { label: "Common",    weight: 50 },
  { label: "Uncommon",  weight: 25 },
  { label: "Rare",      weight: 15 },
  { label: "Epic",      weight: 7  },
  { label: "Legendary", weight: 3  },
];
const FALLBACK_POWERS = [
  "Fire", "Ice", "Lightning", "Shadow", "Light", "Nature",
  "Time", "Gravity", "Sonic", "Void", "Arcane", "Steel",
];

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── GenerationService ───────────────────────────────────────────────────────

export class GenerationService {
  private client: Anthropic | null = null;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.client = new Anthropic({ apiKey: key });
    }
  }

  // ── Public entry point ───────────────────────────────────────────────────

  /**
   * Generate NFT metadata. Tries the LLM first (with retries), falls back
   * to the algorithmic generator if the API is unavailable or all retries
   * are exhausted.
   */
  async generate(opts: GenerationOptions): Promise<GeneratedMetadata> {
    if (!this.client) {
      return this.fallback(opts);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.llmGenerate(opts);
      } catch (err: unknown) {
        const isLast = attempt === MAX_RETRIES;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `  [generation] LLM attempt ${attempt}/${MAX_RETRIES} failed: ${msg}` +
          (isLast ? " — using fallback" : ` — retrying in ${BASE_DELAY_MS * attempt}ms…`)
        );
        if (!isLast) {
          await this.delay(BASE_DELAY_MS * attempt);
        }
      }
    }

    return this.fallback(opts);
  }

  // ── LLM generation ───────────────────────────────────────────────────────

  private async llmGenerate(opts: GenerationOptions): Promise<GeneratedMetadata> {
    const themeClause = opts.theme
      ? `The collection theme is: "${opts.theme}".`
      : "Choose a creative fantasy/sci-fi theme.";

    const avoidClause = opts.existingNames?.length
      ? `Avoid these already-used names: ${opts.existingNames.join(", ")}.`
      : "";

    const prompt = `You are generating procedural NFT metadata for token #${opts.tokenId} in a collection${opts.collectionName ? ` called "${opts.collectionName}"` : ""}.
${themeClause}
${avoidClause}

Respond with ONLY a valid JSON object — no markdown, no explanation — in this exact shape:
{
  "name": "<unique NFT name, 2–5 words>",
  "description": "<vivid 1–2 sentence description of the NFT>",
  "imagePrompt": "<detailed prompt for an image generator describing the visual>",
  "attributes": [
    { "trait_type": "Background",  "value": "<string>" },
    { "trait_type": "Type",        "value": "<string>" },
    { "trait_type": "Rarity",      "value": "<Common|Uncommon|Rare|Epic|Legendary>" },
    { "trait_type": "Power",       "value": "<string>" },
    { "trait_type": "Level",       "value": <integer 1–100> }
  ]
}`;

    const response = await this.client!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const parsed = JSON.parse(raw) as {
      name: string;
      description: string;
      imagePrompt: string;
      attributes: NFTAttribute[];
    };

    // Basic validation
    if (!parsed.name || !parsed.description || !Array.isArray(parsed.attributes)) {
      throw new Error("LLM returned malformed metadata");
    }

    return {
      name: parsed.name,
      description: parsed.description,
      image: parsed.imagePrompt,  // Caller can swap with actual image URL
      attributes: parsed.attributes,
      generatedBy: "llm",
    };
  }

  // ── Algorithmic fallback ─────────────────────────────────────────────────

  /**
   * Pure algorithmic generation — no external calls, never fails.
   */
  fallback(opts: GenerationOptions): GeneratedMetadata {
    const type       = pick(FALLBACK_TYPES);
    const background = pick(FALLBACK_BACKGROUNDS);
    const power      = pick(FALLBACK_POWERS);
    const rarity     = weightedRandom(FALLBACK_RARITIES).label;
    const level      = Math.floor(Math.random() * 100) + 1;
    const collection = opts.collectionName ?? opts.theme ?? "NFT";

    const name = `${collection} ${type} #${opts.tokenId}`;
    const description =
      `A ${rarity.toLowerCase()} ${type.toLowerCase()} from the ${collection} collection. ` +
      `Wielding the power of ${power.toLowerCase()}, standing against a ${background.toLowerCase()} backdrop.`;

    return {
      name,
      description,
      image: `${power} ${type} ${background} digital art, NFT style`,
      attributes: [
        { trait_type: "Background", value: background },
        { trait_type: "Type",       value: type       },
        { trait_type: "Rarity",     value: rarity     },
        { trait_type: "Power",      value: power      },
        { trait_type: "Level",      value: level      },
      ],
      generatedBy: "fallback",
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
