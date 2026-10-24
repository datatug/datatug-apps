import { WorkDetail, WorkItem, WorkPage } from './work.models';
export const workFixture = (patch: Partial<WorkItem> = {}): WorkItem => ({
  id: 'task1',
  spaceID: 'space',
  projectID: 'project',
  type: 'task',
  title: 'Repair shipment allocation',
  ownerId: 'lead',
  assigneeIds: ['developer'],
  primaryAssigneeId: 'developer',
  status: 'open',
  lifecycle: 'open',
  priority: 'high',
  version: 1,
  contextSessionId: 'session1',
  createdBy: 'lead',
  createdAt: '2026-10-23T12:00:00Z',
  updatedAt: '2026-10-23T12:00:00Z',
  ...patch,
});
export const workDetailFixture = (): WorkDetail => ({
  item: workFixture(),
  links: [],
  activity: [],
  members: [
    { id: 'lead', title: 'Team Lead', role: 'owner' },
    { id: 'developer', title: 'Developer', role: 'contributor' },
  ],
  capabilities: {
    canRead: true,
    canCreate: true,
    canEdit: true,
    canAssign: true,
    canContext: true,
    transitions: ['in-progress', 'cancelled'],
  },
  environments: [
    {
      environmentId: 'demo',
      identityDomain: 'northwind',
      title: 'Demo',
      subjects: [
        {
          id: 'order',
          label: 'Order ID',
          subject: {
            conceptId: 'order',
            fieldId: 'OrderID',
            fieldMappingRef: 'order-id',
          },
          type: 'integer',
          shape: 'scalar',
        },
      ],
    },
  ],
  proposals: [],
});
export const workPageFixture = (): WorkPage => ({
  ...workDetailFixture(),
  items: [workFixture()],
  hasMore: false,
});
