// The curated demo scenarios and the hand-off URL contract.
//
//   datatug.app/demo?scenario=<id>&q=<question>&lang=<en|ru>
//
// `scenario` names a curated scenario; `q` is the question as the visitor saw it on the landing page;
// `lang` is the language of the demo's own text. Anything unknown is ignored, never an error.

export type DemoLang = 'en' | 'ru';

export interface DemoScenario {
  readonly id: string;
  /** Other ids the sites or older links may use for this scenario. */
  readonly aliases: readonly string[];
  readonly question: Readonly<Record<DemoLang, string>>;
  /** Wordings that count as the canonical question (compared after normalisation). */
  readonly wordings: readonly string[];
  /** Whether this release can answer it. The others are listed honestly as coming next. */
  readonly available: boolean;
}

export const SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'countries-music-per-capita',
    aliases: ['sales-per-capita'],
    question: {
      en: 'Which countries buy the most music relative to their population?',
      ru: 'Какие страны покупают больше всего музыки на душу населения?',
    },
    wordings: [
      'which countries buy the most music relative to their population',
      'music sales per capita by country',
      'which country buys the most music per person',
      'top countries by music sales per capita',
      'какие страны покупают больше всего музыки на душу населения',
    ],
    available: true,
  },
  {
    id: 'jazz-artists',
    aliases: [],
    question: {
      en: 'Which artists are most popular with customers who buy jazz?',
      ru: 'Какие исполнители популярнее всего у покупателей джаза?',
    },
    wordings: ['which artists are most popular with customers who buy jazz'],
    available: false,
  },
  {
    id: 'customer-artist-path',
    aliases: [],
    question: {
      en: 'How is a customer connected to an artist in this data?',
      ru: 'Как в этих данных покупатель связан с исполнителем?',
    },
    wordings: ['how is a customer connected to an artist in this data'],
    available: false,
  },
];

export interface DemoHandoff {
  /** The scenario id after alias resolution, or undefined when absent or unknown. */
  readonly scenario?: string;
  /** What `scenario` said, when it was present but not a known scenario (or `custom`). */
  readonly unknownScenario?: string;
  readonly question?: string;
  /** Present only when the link said `lang=en` or `lang=ru`. */
  readonly lang?: DemoLang;
}

/** The question is shown, truncated, at most this long (bytes, UTF-8): the same bound the chat interpreter uses. */
export const MAX_QUESTION_BYTES = 1000;

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = '';
  for (const character of text) {
    if (encoder.encode(out + character).length > maxBytes) break;
    out += character;
  }
  return out;
}

export function normaliseQuestion(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function scenarioById(id: string | undefined): DemoScenario | undefined {
  if (!id) return undefined;
  return SCENARIOS.find((scenario) => scenario.id === id || scenario.aliases.includes(id));
}

export function matchScenarioByQuestion(question: string): DemoScenario | undefined {
  const wanted = normaliseQuestion(question);
  return SCENARIOS.find((scenario) => scenario.wordings.includes(wanted));
}

/** Parse `scenario`, `q` and `lang` from a query string. Never throws. */
export function parseHandoff(search: string): DemoHandoff {
  const params = new URLSearchParams(search);
  const rawScenario = params.get('scenario')?.trim() || undefined;
  const rawQuestion = params.get('q')?.trim();
  const rawLang = params.get('lang')?.trim().toLowerCase();
  const scenario = scenarioById(rawScenario);
  const question = rawQuestion ? truncateUtf8(rawQuestion, MAX_QUESTION_BYTES) : undefined;
  return {
    ...(scenario ? { scenario: scenario.id } : {}),
    ...(rawScenario && !scenario ? { unknownScenario: rawScenario.slice(0, 60) } : {}),
    ...(question ? { question } : {}),
    ...(rawLang === 'ru' || rawLang === 'en' ? { lang: rawLang } : {}),
  };
}

/** Where the app's eager shell stores the hand-off it captured and stripped from the address bar. */
export const DEMO_HANDOFF_STORAGE_KEY = 'datatug.demo.handoff.v1';
