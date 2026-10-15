import {
  cloudOutline,
  desktopOutline,
  flaskOutline,
  globeOutline,
  shieldCheckmarkOutline,
  warningOutline,
} from 'ionicons/icons';
import { IEnvironmentBase } from './environments';

const icons: Record<string, string> = {
  'globe-outline': globeOutline,
  'desktop-outline': desktopOutline,
  'flask-outline': flaskOutline,
  'cloud-outline': cloudOutline,
  'shield-checkmark-outline': shieldCheckmarkOutline,
  'warning-outline': warningOutline,
};

/** Unknown metadata uses a neutral fallback; IDs never imply safety. */
export function environmentPresentation(env?: Partial<IEnvironmentBase>) {
  const presentation = env?.presentation;
  const tone = presentation?.tone;
  return {
    label:
      presentation?.label?.trim() || env?.title || env?.id || 'Environment',
    icon: icons[presentation?.icon || ''] || globeOutline,
    tone:
      tone && ['primary', 'success', 'warning', 'danger'].includes(tone)
        ? tone
        : 'medium',
    safetyLabel:
      tone === 'danger'
        ? 'High caution'
        : tone === 'warning'
          ? 'Use caution'
          : undefined,
  };
}
