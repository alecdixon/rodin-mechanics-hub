export const GEAR_RATIOS = {
  STD: { label: "STD", gears: ["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"] },
  LONG: { label: "LONG", gears: ["12:37", "15:35", "18:33", "18:27", "20:25", "20:22"] },
  EXTRA_LONG: { label: "EXTRA LONG", gears: ["12:37", "15:35", "18:33", "18:27", "19:23", "25:26"] },
} as const;

export type GearRatioType = keyof typeof GEAR_RATIOS;

export type GearRatioConfig = {
  car_id: number;
  selected_ratio: GearRatioType;
  version: number;
  updated_at: string;
  updated_by: string;
  updated_by_email: string;
};

export type GearRatioChange = GearRatioConfig & {
  previous_ratio: GearRatioType | null;
};

export function gearRatioLabel(ratio: GearRatioType | null | undefined): string {
  return ratio ? GEAR_RATIOS[ratio].label : "NOT SET";
}

export function hasGearRatioChange(version: number | undefined, acknowledgedVersion: number): boolean {
  return version !== undefined && version > acknowledgedVersion;
}
