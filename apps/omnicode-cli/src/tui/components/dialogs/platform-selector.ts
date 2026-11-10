import { OPEN_PLATFORMS } from '@hilbras/omnicode-auth';

import { OMNICODE_GLOBAL_PLATFORM_VALUE } from '#/utils/region';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const OMNICODE_MAINLAND_CN_OPTION: ChoiceOption = {
  value: 'omnicode',
  label: 'Omnicode (omnicode.com/code)',
};
const OMNICODE_GLOBAL_OPTION: ChoiceOption = {
  value: OMNICODE_GLOBAL_PLATFORM_VALUE,
  label: 'Omnicode (omnicode.ai/code)',
};

function platformOptions(): readonly ChoiceOption[] {
  return [
    OMNICODE_MAINLAND_CN_OPTION,
    OMNICODE_GLOBAL_OPTION,
    ...OPEN_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name })),
  ];
}

export interface PlatformSelectorOptions {
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...platformOptions()],
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
