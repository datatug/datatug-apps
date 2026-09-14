import {
  participantRoleGrantsAccess,
  isIncidentParticipantRole,
} from './incident-participant-role';
import { INCIDENT_PARTICIPANT_ROLES } from './models';

describe('participantRoleGrantsAccess', () => {
  it.each(INCIDENT_PARTICIPANT_ROLES)(
    'never treats %s as an authorization grant',
    (role) => {
      expect(participantRoleGrantsAccess(role)).toBe(false);
      expect(isIncidentParticipantRole(role)).toBe(true);
    },
  );

  it('rejects unknown roles rather than granting them', () => {
    expect(isIncidentParticipantRole('owner')).toBe(false);
    expect(isIncidentParticipantRole('admin')).toBe(false);
  });
});
