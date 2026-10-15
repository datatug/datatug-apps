import { environmentPresentation } from './environment-presentation';
import { globeOutline } from 'ionicons/icons';
describe('environmentPresentation', () => {
  it('does not infer production safety from an ID', () => {
    expect(environmentPresentation({ id: 'prod' })).toMatchObject({
      label: 'prod',
      tone: 'medium',
      icon: globeOutline,
      safetyLabel: undefined,
    });
  });
  it('applies danger semantics to any configured environment', () => {
    expect(
      environmentPresentation({
        id: 'live-a',
        presentation: { label: 'Production', tone: 'danger' },
      }),
    ).toMatchObject({
      label: 'Production',
      tone: 'danger',
      safetyLabel: 'High caution',
    });
  });
  it('uses neutral fallbacks for unknown icon and tone metadata', () => {
    expect(
      environmentPresentation({
        id: 'qa',
        presentation: {
          label: ' ',
          icon: 'unknown',
          tone: 'unexpected' as 'danger',
        },
      }),
    ).toMatchObject({ label: 'qa', tone: 'medium', icon: globeOutline });
  });
});
