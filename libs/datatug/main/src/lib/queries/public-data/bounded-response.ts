/** One cumulative streaming byte guard, including failure bodies, with an abortable reader. */
export async function boundedResponseBytes(
  response: Response,
  remaining: number,
  signal?: AbortSignal,
  onBytes?: (bytes: number) => void,
): Promise<{ bytes: number; raw: Uint8Array }> {
  if (response.redirected || response.type === 'opaqueredirect') {
    await response.body?.cancel();
    throw new Error('A public-data redirect is refused.');
  }
  const advertised = response.headers.get('Content-Length');
  if (
    advertised !== null &&
    (!/^\d+$/.test(advertised) || Number(advertised) > remaining)
  ) {
    await response.body?.cancel();
    throw new Error('The public-data response exceeds the byte bound.');
  }
  const reader = response.body?.getReader();
  if (!reader) return { bytes: 0, raw: new Uint8Array() };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) break;
      onBytes?.(item.value.byteLength);
      bytes += item.value.byteLength;
      if (bytes > remaining)
        throw new Error('The public-data response exceeds the byte bound.');
      chunks.push(item.value);
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, raw: all };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Text consumers retain their existing fatal decoding and BOM behavior. */
export async function boundedResponseText(
  response: Response,
  remaining: number,
  signal?: AbortSignal,
  onBytes?: (bytes: number) => void,
): Promise<{ text: string; bytes: number; raw: Uint8Array }> {
  const read = await boundedResponseBytes(response, remaining, signal, onBytes);
  return {
    ...read,
    // Preserve BOMs in the decoded view; immutable checksums use raw bytes.
    text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      read.raw,
    ),
  };
}
