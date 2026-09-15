import { ISneatUserState } from '@sneat/auth-core';
import {
  datatugUserExtPath,
  withDatatugUserData,
} from './datatug-user-service';
import { IDatatugBriefForUser } from '../../models/interfaces';

const sneatUserState = (record: unknown): ISneatUserState =>
  ({
    status: 'authenticated',
    user: { uid: 'user1' },
    record,
  }) as unknown as ISneatUserState;

const extDoc = (projectTitle: string): IDatatugBriefForUser => ({
  stores: {
    firestore: {
      title: 'DataTug cloud',
      type: 'firestore',
      projects: { proj1234: { title: projectTitle } },
    },
  },
});

describe('datatugUserExtPath', () => {
  it('points at the extension-owned user document', () => {
    expect(datatugUserExtPath('user1')).toBe('users/user1/ext/datatug');
  });
});

describe('withDatatugUserData', () => {
  it('takes the DataTug index from the extension document', () => {
    const state = withDatatugUserData(
      sneatUserState({ title: 'Alexander' }),
      extDoc('From ext doc'),
    );
    expect(
      state.record?.datatug?.stores?.firestore?.projects?.['proj1234']?.title,
    ).toBe('From ext doc');
  });

  it('lets the extension document win over the legacy nested field', () => {
    const state = withDatatugUserData(
      sneatUserState({ title: 'Alexander', datatug: extDoc('Legacy') }),
      extDoc('From ext doc'),
    );
    expect(
      state.record?.datatug?.stores?.firestore?.projects?.['proj1234']?.title,
    ).toBe('From ext doc');
  });

  it('falls back to the legacy nested field when there is no extension document', () => {
    const state = withDatatugUserData(
      sneatUserState({ title: 'Alexander', datatug: extDoc('Legacy') }),
      undefined,
    );
    expect(
      state.record?.datatug?.stores?.firestore?.projects?.['proj1234']?.title,
    ).toBe('Legacy');
  });

  it('defaults to an empty index when neither source has one', () => {
    const state = withDatatugUserData(sneatUserState({ title: 'Alexander' }));
    expect(state.record?.datatug?.stores).toEqual({});
  });

  it('keeps the "still loading" state untouched', () => {
    const loading = sneatUserState(undefined);
    const state = withDatatugUserData(loading, extDoc('From ext doc'));
    expect(state.record).toBeUndefined();
  });

  it('handles a user whose record does not exist yet', () => {
    const state = withDatatugUserData(sneatUserState(null), extDoc('Created'));
    expect(state.record?.title).toBe('');
    expect(
      state.record?.datatug?.stores?.firestore?.projects?.['proj1234']?.title,
    ).toBe('Created');
  });
});
