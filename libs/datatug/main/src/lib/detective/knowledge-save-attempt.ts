/** Keep a resource identity through an uncertain acknowledgment of the same draft. */
export function knowledgeSaveAttempt(
  previous: { key: string; proposalId: string } | undefined,
  key: string,
  newId: () => string = () => `proposal-${crypto.randomUUID()}`,
): { key: string; proposalId: string } {
  return previous?.key === key ? previous : { key, proposalId: newId() };
}
