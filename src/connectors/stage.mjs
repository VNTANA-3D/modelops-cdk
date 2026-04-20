import { parse } from "yaml";
import { getProfile } from "./profiles.mjs";

export function yamlToPipelineJson(yamlString) {
  const doc = parse(yamlString);
  return JSON.stringify(doc, null, 2);
}

export function pipelineS3Key(profileName) {
  const profile = getProfile(profileName);
  return `pipelines/${profile.pipeline}.json`;
}
