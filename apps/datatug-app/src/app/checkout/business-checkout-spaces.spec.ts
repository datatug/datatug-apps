import { manageableBusinessSpaces } from './business-checkout-spaces';

it('lists only ordinary Spaces the signed-in user can administer', () => {
  expect(
    manageableBusinessSpaces({
      family: { title: 'Family', type: 'family', roles: ['owner'] },
      company: { title: 'Company', type: 'company', roles: ['admin'] },
      group: { title: 'Group', type: 'group', roles: ['member'] },
      personal: { title: 'Personal', type: 'personal', roles: ['owner'] },
      spot: { title: 'Spot', type: 'spot', roles: ['admin'] },
      custom: {
        title: 'Custom ordinary type',
        type: 'registered-company',
        roles: ['owner'],
      },
      noRole: { title: 'No role', type: 'company', roles: [] },
    }),
  ).toEqual([
    { id: 'company', title: 'Company', type: 'company' },
    { id: 'custom', title: 'Custom ordinary type', type: 'registered-company' },
    { id: 'family', title: 'Family', type: 'family' },
  ]);
});

it('does not infer current activity status from the user-space brief', () => {
  expect(
    manageableBusinessSpaces({
      inactive: {
        title: 'Status is not part of this read model',
        type: 'company',
        roles: ['owner'],
      },
    }),
  ).toEqual([
    {
      id: 'inactive',
      title: 'Status is not part of this read model',
      type: 'company',
    },
  ]);
});
