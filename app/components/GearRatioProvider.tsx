"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { canAccessCarPages, canAcknowledgeGearRatio, canChangeGearRatio } from "@/lib/userAccess";
import { hasGearRatioChange, type GearRatioChange, type GearRatioConfig, type GearRatioType } from "@/lib/gearRatios";

type GearRatioState = {
  config: GearRatioConfig | null;
  history: GearRatioChange[];
  acknowledgedVersion: number;
  canChange: boolean;
  canAcknowledge: boolean;
};

type GearRatioContextValue = GearRatioState & {
  carId: number;
  loading: boolean;
  error: string;
  changed: boolean;
  openCount: number;
  openPanel: () => void;
  refresh: () => Promise<void>;
  save: (ratio: GearRatioType, expectedVersion: number) => Promise<void>;
  acknowledge: (version: number) => Promise<void>;
};

const GearRatioContext = createContext<GearRatioContextValue | null>(null);

export function useGearRatio() {
  const value = useContext(GearRatioContext);
  if (!value) throw new Error("Gear Ratio requires a car workspace provider.");
  return value;
}

export default function GearRatioProvider({ carId, children }: { carId: number; children: ReactNode }) {
  const [state, setState] = useState<GearRatioState>({
    config: null, history: [], acknowledgedVersion: 0, canChange: false, canAcknowledge: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const requestSequence = useRef({ sequence: 0 });

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current.sequence;
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user || !canAccessCarPages(auth.user.email, carId)) {
        throw new Error("You do not have access to this car's gear ratio.");
      }
      const canChange = canChangeGearRatio(auth.user.email);
      const canAcknowledge = canAcknowledgeGearRatio(auth.user.email, carId);
      const [configuration, acknowledgement, history] = await Promise.all([
        supabase.from("car_gear_ratio_config").select("*").eq("car_id", carId).maybeSingle(),
        canAcknowledge
          ? supabase.from("car_gear_ratio_acknowledgements").select("acknowledged_version")
            .eq("car_id", carId).eq("user_id", auth.user.id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        canChange
          ? supabase.from("car_gear_ratio_history").select("*").eq("car_id", carId)
            .order("version", { ascending: false }).limit(10)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (configuration.error) throw configuration.error;
      if (acknowledgement.error) throw acknowledgement.error;
      if (history.error) throw history.error;
      if (sequence !== requestSequence.current.sequence) return;
      setState({
        config: configuration.data as GearRatioConfig | null,
        history: (history.data ?? []) as GearRatioChange[],
        acknowledgedVersion: acknowledgement.data?.acknowledged_version ?? 0,
        canChange, canAcknowledge,
      });
      setError("");
    } catch (cause) {
      if (sequence !== requestSequence.current.sequence) return;
      setError(cause instanceof Error ? cause.message : (cause as { message?: string })?.message || "Unable to load gear ratio.");
    } finally {
      if (sequence === requestSequence.current.sequence) setLoading(false);
    }
  }, [carId]);

  useEffect(() => {
    const requests = requestSequence.current;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(refreshVisible, 15000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      ++requests.sequence;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  const save = async (ratio: GearRatioType, expectedVersion: number) => {
    if (!state.canChange) throw new Error("Only the Chief Mechanic can change gear ratios.");
    ++requestSequence.current.sequence;
    const { data, error: saveError } = await supabase.rpc("set_car_gear_ratio", {
      p_car_id: carId, p_ratio: ratio, p_expected_version: expectedVersion,
    }).single();
    if (saveError) throw new Error(saveError.message);
    ++requestSequence.current.sequence;
    setState((current) => ({ ...current, config: data as GearRatioConfig }));
    await refresh();
  };

  const acknowledge = useCallback(async (version: number) => {
    if (!state.canAcknowledge) return;
    const { data, error: acknowledgementError } = await supabase.rpc("acknowledge_car_gear_ratio", {
      p_car_id: carId, p_version: version,
    });
    if (acknowledgementError) throw new Error(acknowledgementError.message);
    ++requestSequence.current.sequence;
    setState((current) => ({
      ...current, acknowledgedVersion: Math.max(current.acknowledgedVersion, Number(data)),
    }));
  }, [carId, state.canAcknowledge]);

  return (
    <GearRatioContext.Provider value={{
      ...state, carId, loading, error, refresh, save, acknowledge, openCount,
      openPanel: () => setOpenCount((count) => count + 1),
      changed: state.canAcknowledge && hasGearRatioChange(state.config?.version, state.acknowledgedVersion),
    }}>
      {children}
    </GearRatioContext.Provider>
  );
}
