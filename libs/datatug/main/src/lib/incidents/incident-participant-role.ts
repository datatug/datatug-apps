import {
  INCIDENT_PARTICIPANT_ROLES,
  type IncidentParticipantRole,
} from './models';

export { INCIDENT_PARTICIPANT_ROLES, type IncidentParticipantRole };

/**
 * Incident roles are presentation metadata (hub REQ:participants-and-roles).
 * They confer no data access; permission comes from current project policy.
 */
export function participantRoleGrantsAccess(
  role: IncidentParticipantRole,
): false {
  void role;
  return false;
}

export function isIncidentParticipantRole(
  value: unknown,
): value is IncidentParticipantRole {
  return (
    typeof value === 'string' &&
    (INCIDENT_PARTICIPANT_ROLES as readonly string[]).includes(value)
  );
}
