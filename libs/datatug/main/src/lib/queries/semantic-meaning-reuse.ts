import type { IQueryDef } from '../models/definition/query-def';
import {
  conceptId,
  rebuildMeaningBindings,
  validateSemanticModel,
  type SemanticConcept,
  type SemanticModel,
} from './semantic-mapping';

export interface SavedMeaningChoice {
  readonly key: string;
  readonly sourceQueryId: string;
  readonly sourceTitle: string;
  readonly entity: SemanticConcept;
  readonly property: SemanticConcept;
}
export interface SavedMeaningChoices {
  readonly choices: readonly SavedMeaningChoice[];
  readonly skipped: number;
}
const definition = (concept: SemanticConcept): SemanticConcept => {
  const copy = structuredClone(concept);
  delete copy.bindings;
  return copy;
};

/** Validate the supported document, then detach its query-output bindings. */
export function meaningDefinitions(
  document: unknown,
  template: SemanticModel,
): SemanticConcept[] {
  if (
    !document ||
    typeof document !== 'object' ||
    !Array.isArray((document as { concepts?: unknown }).concepts)
  )
    throw new Error('Choose a supported MeaningGraph JSON export.');
  const candidate = {
    ...structuredClone(template),
    meaning: structuredClone(document),
    bindings: [],
  } as unknown as SemanticModel;
  for (const concept of candidate.meaning.concepts) {
    if (!concept || typeof concept !== 'object')
      throw new Error('Meaning document is invalid.');
    if (
      concept.bindings !== undefined &&
      (!Array.isArray(concept.bindings) ||
        concept.bindings.length > 512 ||
        concept.bindings.some(
          (binding) =>
            !binding ||
            Object.keys(binding).some(
              (key) => !['model', 'field', 'role'].includes(key),
            ) ||
            binding.model !== 'modelspec:///query.QueryResult' ||
            binding.role !== 'value' ||
            typeof binding.field !== 'string' ||
            !/^column[1-9][0-9]*$/.test(binding.field),
        ))
    )
      throw new Error(
        'This meaning file contains unsupported bindings. Export supported query meanings to reuse them.',
      );
    // Retain invalid entity bindings for validation rather than silently dropping them.
    if (concept.kind === 'property') delete concept.bindings;
  }
  validateSemanticModel(candidate);
  return candidate.meaning.concepts.map(definition);
}

/** Invalid unrelated saved queries never prevent editing the current query. */
export function savedMeaningChoices(
  queries: readonly IQueryDef[],
  currentQueryId: string,
): SavedMeaningChoices {
  const choices: SavedMeaningChoice[] = [];
  let skipped = 0;
  for (const query of queries) {
    if (!query || typeof query !== 'object' || typeof query.id !== 'string') {
      skipped++;
      continue;
    }
    if (query.id === currentQueryId || !query.semanticModel) continue;
    try {
      validateSemanticModel(query.semanticModel);
      const concepts = query.semanticModel.meaning.concepts;
      for (const property of concepts.filter(
        (concept) => concept.kind === 'property',
      )) {
        const entity = concepts.find((concept) => concept.id === property.of);
        if (!entity) continue;
        choices.push({
          key: `saved:${query.id}:${property.id}`,
          sourceQueryId: query.id,
          sourceTitle: (query.title?.trim() || 'Untitled query').slice(0, 120),
          entity: definition(entity),
          property: definition(property),
        });
      }
    } catch {
      skipped++;
    }
  }
  return { choices, skipped };
}

/** Copy only the selected property's ownership pair, with collision-safe local IDs. */
export function copySavedMeaning(
  target: SemanticModel,
  choice: SavedMeaningChoice,
): { bundle: SemanticModel; propertyId: string } {
  const definitions = meaningDefinitions(
    { ...target.meaning, concepts: [choice.entity, choice.property] },
    target,
  );
  const entity = definitions.find((concept) => concept.kind === 'entity');
  const property = definitions.find((concept) => concept.kind === 'property');
  if (!entity || !property || property.of !== entity.id)
    throw new Error('This saved meaning is no longer available.');
  const bundle = structuredClone(target);
  const add = (source: SemanticConcept): string => {
    const existing = bundle.meaning.concepts.find(
      (concept) => concept.id === source.id,
    );
    const candidate = definition(source);
    if (
      existing &&
      JSON.stringify(definition(existing)) === JSON.stringify(candidate)
    )
      return existing.id;
    if (existing) candidate.id = conceptId(source.id, bundle.meaning.concepts);
    bundle.meaning.concepts.push(candidate);
    return candidate.id;
  };
  const entityId = add(entity);
  const propertyId = add({ ...property, of: entityId });
  const result = rebuildMeaningBindings(bundle);
  validateSemanticModel(result);
  return { bundle: result, propertyId };
}

/** File imports retain their existing refusal on conflicting IDs. */
export function importMeaningDefinitions(
  target: SemanticModel,
  document: unknown,
): SemanticModel {
  const concepts = meaningDefinitions(document, target),
    merged = structuredClone(target);
  for (const concept of concepts) {
    const existing = merged.meaning.concepts.find(
      (item) => item.id === concept.id,
    );
    if (
      existing &&
      JSON.stringify(definition(existing)) !== JSON.stringify(concept)
    )
      throw new Error(
        `Meaning ${concept.id} already exists with a different definition.`,
      );
    if (!existing) merged.meaning.concepts.push(concept);
  }
  const result = rebuildMeaningBindings(merged);
  validateSemanticModel(result);
  return result;
}
