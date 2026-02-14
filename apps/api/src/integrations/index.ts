export { initializeManifests, manifestRegistry } from '@/integrations/manifest-loader'
export { executeManifestTool } from '@/integrations/manifest-executor'
export { interpolate, interpolateObject, buildQueryString } from '@/integrations/template-engine'
export { mapOutput, resolvePath } from '@/integrations/output-mapper'
export type {
  IntegrationManifest,
  BlockManifest,
  ToolManifest,
  TriggerManifest,
  SubBlockSchema,
  ParamDef,
  OutputDef,
  ExecutionMode,
} from '@/integrations/types'
