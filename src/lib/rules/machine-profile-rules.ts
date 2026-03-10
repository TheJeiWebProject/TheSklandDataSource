export interface MachineProfileOverride {
  useTemplate?: string;
  slots?: Array<Record<string, unknown>>;
  paramSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

// Rules for mapping skland machine names to AEF machine templates.
// `useTemplate` should be an AEF recipe type display name.
export const MACHINE_PROFILE_OVERRIDES: Record<string, MachineProfileOverride> = {
};
