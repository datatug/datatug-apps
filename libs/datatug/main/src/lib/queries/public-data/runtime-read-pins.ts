/** Exact immutable mount identity; record keys are never inferred from these pins. */
export interface RuntimeReadPins {
  readonly providerRevision: string;
  readonly sourceSha256: string;
  readonly servingSha256?: string;
  readonly manifestSha256?: string;
}
export type CompleteRuntimeReadPins = Required<RuntimeReadPins>;
export const RUNTIME_PIN_HEADERS = {
  providerRevision: 'OVDB-Provider-Revision',
  sourceSha256: 'OVDB-Source-SHA256',
  servingSha256: 'OVDB-Serving-SHA256',
  manifestSha256: 'OVDB-Manifest-SHA256',
} as const;

export function validateRuntimePins(
  value: RuntimeReadPins,
  complete = false,
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (name) =>
        !Object.prototype.hasOwnProperty.call(RUNTIME_PIN_HEADERS, name),
    ) ||
    typeof value.providerRevision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.providerRevision) ||
    typeof value.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
    (value.servingSha256 === undefined) !==
      (value.manifestSha256 === undefined) ||
    (complete && value.servingSha256 === undefined) ||
    (value.servingSha256 !== undefined &&
      (typeof value.servingSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.servingSha256) ||
        typeof value.manifestSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.manifestSha256)))
  )
    throw new Error(
      'The immutable runtime pins are missing, malformed or incomplete.',
    );
}

export function runtimePinHeaders(pins: RuntimeReadPins): Headers {
  validateRuntimePins(pins);
  const headers = new Headers();
  for (const name of Object.keys(
    RUNTIME_PIN_HEADERS,
  ) as (keyof RuntimeReadPins)[])
    if (pins[name] !== undefined)
      headers.set(RUNTIME_PIN_HEADERS[name], pins[name]);
  return headers;
}

/** Validate the entire mount identity before decoding or accepting any rows. */
export function checkedResponsePins(
  response: Response,
  expected: RuntimeReadPins,
): CompleteRuntimeReadPins {
  const pins = Object.fromEntries(
    Object.entries(RUNTIME_PIN_HEADERS).map(([name, header]) => [
      name,
      response.headers.get(header) ?? undefined,
    ]),
  ) as unknown as CompleteRuntimeReadPins;
  validateRuntimePins(pins, true);
  for (const name of Object.keys(
    RUNTIME_PIN_HEADERS,
  ) as (keyof RuntimeReadPins)[])
    if (expected[name] !== undefined && expected[name] !== pins[name])
      throw new Error(
        'The immutable runtime deployment changed. Acknowledge its new pins and run explicitly again.',
      );
  return pins;
}
