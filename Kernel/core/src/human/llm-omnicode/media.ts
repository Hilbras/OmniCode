import type { ProviderMediaContribution } from '#/llm/media/upload';
import { modelKey, type LlmModel } from '#/llm/model';

import { OmnicodeFiles } from './files';
import { OMNICODE_DEFAULT_BASE_URL } from './trait';

const filesByModel = new Map<string, OmnicodeFiles>();

function resolveFiles(model: LlmModel): OmnicodeFiles {
  const key = modelKey(model);
  let files = filesByModel.get(key);
  if (files === undefined) {
    files = new OmnicodeFiles({
      apiKey: model.apiKey,
      baseUrl: model.baseUrl ?? OMNICODE_DEFAULT_BASE_URL,
      defaultHeaders:
        model.defaultHeaders === undefined ? undefined : { ...model.defaultHeaders },
    });
    filesByModel.set(key, files);
  }
  return files;
}

export const omnicodeMediaContribution: ProviderMediaContribution = {
  uploadVideo: (video, { model, signal }) => resolveFiles(model).uploadVideo(video, { signal }),
};
