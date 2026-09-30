export function normaliseClutchSerial(serial: string | null | undefined): string {
  return serial?.trim().toLocaleLowerCase("en-GB") ?? "";
}
