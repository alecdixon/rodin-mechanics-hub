import { supabase } from "@/lib/supabase";

export type ClutchAllocationResult = {
  car_id: number;
  clutch_id: string;
  serial_no: string;
  previous_clutch_id: string | null;
  previous_serial_no: string | null;
  changed: boolean;
};

export async function setCarDefaultClutch(
  carId: number,
  clutchId: string,
): Promise<ClutchAllocationResult> {
  const { data, error } = await supabase.rpc("set_car_default_clutch", {
    p_car_id: carId,
    p_clutch_id: clutchId,
  });

  if (error) throw new Error(error.message);
  return data as ClutchAllocationResult;
}
