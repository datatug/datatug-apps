import {
  ContextCapabilities,
  ContextSnapshot,
} from '../session-context/session-context-contract';
export const scope = { environmentId: 'demo', identityDomain: 'shipping:g1' };
export const subject = {
  conceptId: 'Order',
  fieldId: 'order_id',
  fieldMappingRef: 'Order.id',
};
export const appliedCapabilities: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'sarah',
  databaseId: 'db',
  projectId: 'project',
  environments: [scope],
  actions: [],
  subjects: [
    {
      id: 'order',
      label: 'Order ID',
      scope,
      subject,
      type: 'integer',
      shape: 'scalar',
    },
  ],
};
export function appliedSnapshot(): ContextSnapshot {
  return {
    session: {
      schemaVersion: 1,
      id: 'session',
      databaseId: 'db',
      projectId: 'project',
      owner: 'sarah',
      title: 'Order 11045',
      state: 'active',
      version: 3,
      defaultBagId: 'bag',
      contextSetId: 'set',
      bagIds: ['bag'],
      createdAt: '',
      updatedAt: '',
    },
    bags: [
      {
        id: 'bag',
        sessionId: 'session',
        title: 'Selected order',
        scope,
        version: 2,
        entryIds: ['entry'],
      },
    ],
    entries: [
      {
        id: 'entry',
        sessionId: 'session',
        bagId: 'bag',
        subject,
        version: 2,
        currentRevisionId: 'draft',
      },
    ],
    revisions: [
      {
        id: 'applied',
        entryId: 'entry',
        bagId: 'bag',
        subject,
        value: {
          schemaVersion: 1,
          kind: 'scalar',
          scalar: { type: 'integer', value: '11045' },
        },
        createdAt: '',
      },
    ],
    contextSet: {
      id: 'set',
      sessionId: 'session',
      enabled: true,
      createdAt: '',
      slots: [
        {
          scope,
          bagId: 'bag',
          bagVersion: 2,
          version: 1,
          entries: [{ entryId: 'entry', revisionId: 'applied' }],
        },
      ],
    },
  };
}
