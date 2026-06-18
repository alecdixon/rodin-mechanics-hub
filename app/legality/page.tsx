"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import Link from "next/link";
import LogoutButton from "@/app/components/LogoutButton";
import { getCurrentUserEmail } from "@/lib/authHelpers";
import { supabase } from "@/lib/supabase";
import {
  canEditLegality,
  getAssignedCar,
  getUserRole,
  isReadOnlyUser,
  type UserRole,
} from "@/lib/userAccess";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
  active: boolean;
  sort_order: number | null;
};

type LegalityStatus = "legal" | "illegal";

type LegalitySide = "LH" | "RH" | "Centre";

type LegalityPoint = {
  key: string;
  label: string;
  shortLabel: string;
  side: LegalitySide;
  position: string;
  x: number;
  y: number;
  sort_order: number;
  active: boolean;
};

type LegalityLayoutPointRecord = {
  id: string;
  point_key: string;
  label: string;
  short_label: string;
  side: LegalitySide;
  position: string | null;
  x_percent: number | string | null;
  y_percent: number | string | null;
  sort_order: number | null;
  active: boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type LegalityItemState = {
  status: LegalityStatus;
  illegal_note: string;
};

type LegalityCheckRecord = {
  id: string;
  car_id: number;
  chassis_number: string | null;
  driver: string;
  circuit: string | null;
  engineer_name: string | null;
  engineer_email: string | null;
  check_date: string;
  sent_to_engineer_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type LegalityCheckItemRecord = {
  id: string;
  legality_check_id: string;
  item_key: string;
  item_name: string;
  item_side: string | null;
  item_position: string | null;
  status: LegalityStatus;
  illegal_note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type LegalityCheckWithItems = LegalityCheckRecord & {
  items: LegalityCheckItemRecord[];
};

type CarEngineerAllocation = {
  carId: number;
  engineerName: string;
  engineerEmail: string;
};

type PdfItemPayload = {
  item_key: string;
  item_name: string;
  item_side: string;
  item_position: string;
  status: LegalityStatus;
  illegal_note: string | null;
};

const DEFAULT_CAR_COLOUR = "#b91c1c";

const DEFAULT_CARS: DashboardCar[] = [
  {
    id: 1,
    name: "Rehm",
    colour: "#ef4444",
    active: true,
    sort_order: 1,
  },
  {
    id: 2,
    name: "Molnar",
    colour: "#3b82f6",
    active: true,
    sort_order: 2,
  },
  {
    id: 3,
    name: "Pulling",
    colour: "#f97316",
    active: true,
    sort_order: 3,
  },
];

const CAR_ENGINEER_ALLOCATIONS: CarEngineerAllocation[] = [
  {
    carId: 1,
    engineerName:
      process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_NAME_CAR_1 || "Engineer Car 1",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_1 || "",
  },
  {
    carId: 2,
    engineerName:
      process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_NAME_CAR_2 || "Engineer Car 2",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_2 || "",
  },
  {
    carId: 3,
    engineerName:
      process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_NAME_CAR_3 || "Engineer Car 3",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_3 || "",
  },
];

const CIRCUIT_OPTIONS = [
  "Oulton Park",
  "Silverstone",
  "Spa-Francorchamps",
  "Monza",
  "Hungaroring",
  "Zandvoort",
  "Brands Hatch",
  "Snetterton",
  "Donington Park",
  "Other",
] as const;

const DEFAULT_LEGALITY_POINTS: LegalityPoint[] = [
  {
    key: "fw_lh",
    label: "FW LH",
    shortLabel: "FW",
    side: "LH",
    position: "Front wing main plane / endplate area",
    x: 13,
    y: 18,
    sort_order: 10,
    active: true,
  },
  {
    key: "fwep_lh",
    label: "FWEP LH",
    shortLabel: "FWEP",
    side: "LH",
    position: "Front wing endplate",
    x: 13,
    y: 26,
    sort_order: 20,
    active: true,
  },
  {
    key: "front_lh",
    label: "FRONT LH",
    shortLabel: "FRONT",
    side: "LH",
    position: "Front floor / splitter legality point",
    x: 13,
    y: 43,
    sort_order: 30,
    active: true,
  },
  {
    key: "mid_lh",
    label: "MID LH",
    shortLabel: "MID",
    side: "LH",
    position: "Mid floor legality point",
    x: 13,
    y: 58,
    sort_order: 40,
    active: true,
  },
  {
    key: "rear_lh",
    label: "REAR LH",
    shortLabel: "REAR",
    side: "LH",
    position: "Rear floor legality point",
    x: 13,
    y: 74,
    sort_order: 50,
    active: true,
  },
  {
    key: "diffuser_lh",
    label: "DIFFUSER LH",
    shortLabel: "DIFFUSER",
    side: "LH",
    position: "Diffuser legality point",
    x: 14,
    y: 85,
    sort_order: 60,
    active: true,
  },
  {
    key: "fw_rh",
    label: "FW RH",
    shortLabel: "FW",
    side: "RH",
    position: "Front wing main plane / endplate area",
    x: 87,
    y: 18,
    sort_order: 70,
    active: true,
  },
  {
    key: "fwep_rh",
    label: "FWEP RH",
    shortLabel: "FWEP",
    side: "RH",
    position: "Front wing endplate",
    x: 87,
    y: 26,
    sort_order: 80,
    active: true,
  },
  {
    key: "front_rh",
    label: "FRONT RH",
    shortLabel: "FRONT",
    side: "RH",
    position: "Front floor / splitter legality point",
    x: 87,
    y: 43,
    sort_order: 90,
    active: true,
  },
  {
    key: "mid_rh",
    label: "MID RH",
    shortLabel: "MID",
    side: "RH",
    position: "Mid floor legality point",
    x: 87,
    y: 58,
    sort_order: 100,
    active: true,
  },
  {
    key: "rear_rh",
    label: "REAR RH",
    shortLabel: "REAR",
    side: "RH",
    position: "Rear floor legality point",
    x: 87,
    y: 74,
    sort_order: 110,
    active: true,
  },
  {
    key: "diffuser_rh",
    label: "DIFFUSER RH",
    shortLabel: "DIFFUSER",
    side: "RH",
    position: "Diffuser legality point",
    x: 86,
    y: 85,
    sort_order: 120,
    active: true,
  },
  {
    key: "rw_gap",
    label: "RW GAP",
    shortLabel: "RW GAP",
    side: "Centre",
    position: "Rear wing gap measurement",
    x: 50,
    y: 95,
    sort_order: 130,
    active: true,
  },
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(98, Math.max(2, Math.round(value * 10) / 10));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function normaliseLayoutPoint(
  point: LegalityLayoutPointRecord,
  fallbackIndex: number,
): LegalityPoint {
  return {
    key: point.point_key,
    label: point.label || point.point_key,
    shortLabel: point.short_label || point.label || point.point_key,
    side: point.side || "Centre",
    position: point.position || "",
    x: clampPercent(Number(point.x_percent ?? 50)),
    y: clampPercent(Number(point.y_percent ?? 50)),
    sort_order: point.sort_order ?? fallbackIndex + 1,
    active: point.active ?? true,
  };
}

function sortLayoutPoints(points: LegalityPoint[]) {
  return [...points]
    .filter((point) => point.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

function slugFromLabel(label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || `point_${Date.now()}`;
}

function createDefaultItemState(
  points: LegalityPoint[] = DEFAULT_LEGALITY_POINTS,
): Record<string, LegalityItemState> {
  return points.reduce<Record<string, LegalityItemState>>((state, point) => {
    state[point.key] = {
      status: "legal",
      illegal_note: "",
    };

    return state;
  }, {});
}

function niceDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function backHref(role: UserRole, assignedCar: number | null) {
  if (role === "chief_mechanic" || role === "engineer" || role === "guest") {
    return "/dashboard";
  }

  if (role === "number1_mechanic" && assignedCar) {
    return `/car/${assignedCar}/job-list`;
  }

  if (role === "number2_mechanic") {
    return "/drain-out";
  }

  return "/login";
}

function carDisplayName(car: DashboardCar) {
  return `Car ${car.id} - ${car.name}`;
}

function mergeCarsFromDashboard(rows: DashboardCar[]) {
  return DEFAULT_CARS.map((fallbackCar) => {
    const databaseCar = rows.find((car) => car.id === fallbackCar.id);

    return {
      ...fallbackCar,
      ...databaseCar,
      colour: databaseCar?.colour || fallbackCar.colour || DEFAULT_CAR_COLOUR,
      active: databaseCar?.active ?? fallbackCar.active,
      sort_order: databaseCar?.sort_order ?? fallbackCar.sort_order,
    };
  }).sort(
    (a, b) =>
      (a.sort_order ?? a.id) - (b.sort_order ?? b.id) || a.id - b.id,
  );
}

function summaryForItems(items: LegalityCheckItemRecord[]) {
  if (items.length === 0) return "No items saved";

  const illegalCount = items.filter((item) => item.status === "illegal").length;
  const legalCount = items.length - illegalCount;

  if (illegalCount === 0) {
    return `${legalCount}/${items.length} legal`;
  }

  return `${illegalCount} illegal · ${legalCount} legal`;
}

function summaryTone(items: LegalityCheckItemRecord[]) {
  const hasIllegal = items.some((item) => item.status === "illegal");

  return hasIllegal
    ? "border-red-700 bg-red-950/50 text-red-100"
    : "border-green-700 bg-green-950/35 text-green-100";
}

function getPointState(
  itemStates: Record<string, LegalityItemState>,
  key: string,
): LegalityItemState {
  return (
    itemStates[key] ?? {
      status: "legal",
      illegal_note: "",
    }
  );
}

function getEngineerAllocationForCar(carId: number) {
  return (
    CAR_ENGINEER_ALLOCATIONS.find((allocation) => allocation.carId === carId) ??
    CAR_ENGINEER_ALLOCATIONS[0]
  );
}

function formatSupabaseInList(values: string[]) {
  return `(${values.map((value) => `"${value.replace(/"/g, "\\\"")}"`).join(",")})`;
}

function LegalityCarOverview({
  points,
  itemStates,
  readOnly,
  layoutEditMode,
  selectedLayoutKey,
  onSelectLayoutPoint,
  onMoveLayoutPoint,
  onTogglePointStatus,
}: {
  points: LegalityPoint[];
  itemStates: Record<string, LegalityItemState>;
  readOnly: boolean;
  layoutEditMode: boolean;
  selectedLayoutKey: string | null;
  onSelectLayoutPoint: (key: string) => void;
  onMoveLayoutPoint: (key: string, x: number, y: number) => void;
  onTogglePointStatus: (key: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  function movePointFromPointer(
    key: string,
    event: PointerEvent<HTMLButtonElement>,
  ) {
    if (!layoutEditMode || readOnly) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const y = clampPercent(((event.clientY - rect.top) / rect.height) * 100);

    onMoveLayoutPoint(key, x, y);
  }

  return (
    <div
      ref={canvasRef}
      className="relative mx-auto aspect-[3/4] min-h-[620px] w-full max-w-[640px] overflow-hidden rounded-[2rem] border border-zinc-300 bg-white shadow-inner"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(228,228,231,0.44)_1px,transparent_1px),linear-gradient(to_bottom,rgba(228,228,231,0.44)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.08),transparent_58%)]" />

      <img
        src="/legality-car-overview.png"
        alt="Top-down formula car legality overview"
        className="pointer-events-none absolute inset-[4%] h-[92%] w-[92%] object-contain opacity-95 [filter:contrast(1.08)_saturate(0.7)]"
      />

      <div className="pointer-events-none absolute inset-x-[22%] top-[4%] h-[92%] border-x border-zinc-300/80" />

      {points.map((point) => {
        const state = getPointState(itemStates, point.key);
        const isIllegal = state.status === "illegal";
        const isSelected = selectedLayoutKey === point.key;
        const statusClasses = isIllegal
          ? "border-red-500 bg-red-50 text-red-700 shadow-red-950/10"
          : "border-green-500 bg-green-50 text-green-700 shadow-green-950/10";
        const editClasses = isSelected
          ? "ring-4 ring-red-500/30"
          : "ring-0";

        return (
          <button
            key={point.key}
            type="button"
            disabled={readOnly && !layoutEditMode}
            onClick={() => {
              if (layoutEditMode) {
                onSelectLayoutPoint(point.key);
                return;
              }

              if (!readOnly) {
                onTogglePointStatus(point.key);
              }
            }}
            onPointerDown={(event) => {
              if (!layoutEditMode || readOnly) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              onSelectLayoutPoint(point.key);
              movePointFromPointer(point.key, event);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              movePointFromPointer(point.key, event);
            }}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
            }}
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white/95 px-2.5 py-2 text-left shadow-lg backdrop-blur-sm transition hover:scale-[1.03] ${
              layoutEditMode && !readOnly ? "cursor-move border-red-500" : statusClasses
            } ${editClasses}`}
            title={
              layoutEditMode
                ? `Drag ${point.label} to reposition it`
                : `${point.label} · ${state.status}`
            }
          >
            <div className="flex items-center gap-2">
              <span className="min-w-[56px] text-[10px] font-black uppercase tracking-[0.18em] text-zinc-950">
                {point.shortLabel}
              </span>
              <span
                className={`h-5 w-14 rounded border-2 ${
                  isIllegal
                    ? "border-red-600 bg-red-100"
                    : "border-zinc-950 bg-white"
                }`}
              />
            </div>
            {layoutEditMode && (
              <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-red-600">
                X {point.x.toFixed(1)} · Y {point.y.toFixed(1)}
              </div>
            )}
          </button>
        );
      })}

      {layoutEditMode && !readOnly && (
        <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-red-200 bg-white/95 p-3 text-xs text-zinc-700 shadow-lg">
          Drag boxes around the car, then use the layout editor above to rename,
          change side/position, add or remove points.
        </div>
      )}
    </div>
  );
}

function StatusButton({
  active,
  children,
  disabled,
  tone,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled: boolean;
  tone: "legal" | "illegal";
  onClick: () => void;
}) {
  const activeClass =
    tone === "legal"
      ? "border-green-500 bg-green-600 text-white"
      : "border-red-500 bg-red-600 text-white";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? activeClass
          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-500 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function LegalityPointCard({
  point,
  state,
  disabled,
  onStatusChange,
  onNoteChange,
}: {
  point: LegalityPoint;
  state: LegalityItemState;
  disabled: boolean;
  onStatusChange: (status: LegalityStatus) => void;
  onNoteChange: (note: string) => void;
}) {
  const isIllegal = state.status === "illegal";

  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.18em] text-zinc-950">
            {point.label}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-zinc-500">
            {point.position}
          </div>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
            isIllegal
              ? "border-red-400 bg-red-50 text-red-700"
              : "border-green-400 bg-green-50 text-green-700"
          }`}
        >
          {state.status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <StatusButton
          active={state.status === "legal"}
          disabled={disabled}
          tone="legal"
          onClick={() => onStatusChange("legal")}
        >
          Legal
        </StatusButton>
        <StatusButton
          active={state.status === "illegal"}
          disabled={disabled}
          tone="illegal"
          onClick={() => onStatusChange("illegal")}
        >
          Illegal
        </StatusButton>
      </div>

      {isIllegal && (
        <label className="mt-3 block">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-red-700">
            Illegal note required
          </span>
          <textarea
            disabled={disabled}
            value={state.illegal_note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Enter what is illegal..."
            className="mt-2 min-h-20 w-full resize-y rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-zinc-950 outline-none transition placeholder:text-red-300 focus:border-red-600 disabled:cursor-not-allowed disabled:bg-zinc-100"
          />
        </label>
      )}
    </div>
  );
}

export default function LegalityPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>("unknown");
  const [assignedCar, setAssignedCar] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);

  const [cars, setCars] = useState<DashboardCar[]>(DEFAULT_CARS);
  const [selectedCarId, setSelectedCarId] = useState(1);
  const [checkDate, setCheckDate] = useState(todayIsoDate());
  const [selectedCircuit, setSelectedCircuit] = useState<string>(CIRCUIT_OPTIONS[0]);
  const [customCircuit, setCustomCircuit] = useState("");
  const [driver, setDriver] = useState(DEFAULT_CARS[0].name);
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null);
  const [lastSentToEngineerAt, setLastSentToEngineerAt] = useState<string | null>(null);
  const [layoutPoints, setLayoutPoints] = useState<LegalityPoint[]>(
    DEFAULT_LEGALITY_POINTS,
  );
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [selectedLayoutKey, setSelectedLayoutKey] = useState<string | null>(
    DEFAULT_LEGALITY_POINTS[0]?.key ?? null,
  );
  const [itemStates, setItemStates] = useState(() =>
    createDefaultItemState(DEFAULT_LEGALITY_POINTS),
  );

  const [history, setHistory] = useState<LegalityCheckWithItems[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedCar = useMemo(() => {
    return cars.find((car) => car.id === selectedCarId) ?? cars[0] ?? null;
  }, [cars, selectedCarId]);

  const activeLayoutPoints = useMemo(() => {
    return sortLayoutPoints(layoutPoints);
  }, [layoutPoints]);

  const leftPoints = useMemo(() => {
    return activeLayoutPoints.filter((point) => point.side === "LH");
  }, [activeLayoutPoints]);

  const rightPoints = useMemo(() => {
    return activeLayoutPoints.filter((point) => point.side === "RH");
  }, [activeLayoutPoints]);

  const centrePoints = useMemo(() => {
    return activeLayoutPoints.filter((point) => point.side === "Centre");
  }, [activeLayoutPoints]);

  const selectedLayoutPoint = useMemo(() => {
    return (
      activeLayoutPoints.find((point) => point.key === selectedLayoutKey) ??
      activeLayoutPoints[0] ??
      null
    );
  }, [activeLayoutPoints, selectedLayoutKey]);

  const selectedEngineer = useMemo(() => {
    return getEngineerAllocationForCar(selectedCarId);
  }, [selectedCarId]);

  const finalCircuit = useMemo(() => {
    return selectedCircuit === "Other" ? customCircuit.trim() : selectedCircuit;
  }, [customCircuit, selectedCircuit]);

  const selectedCarHasEmail = Boolean(selectedEngineer.engineerEmail.trim());

  const dirtyStatus = useMemo(() => {
    const illegalItems = activeLayoutPoints.filter(
      (point) => getPointState(itemStates, point.key).status === "illegal",
    );

    if (illegalItems.length === 0) {
      return {
        illegalCount: 0,
        label: `${activeLayoutPoints.length}/${activeLayoutPoints.length} legal`,
        className: "border-green-700 bg-green-950/35 text-green-100",
      };
    }

    return {
      illegalCount: illegalItems.length,
      label: `${illegalItems.length} illegal · ${
        activeLayoutPoints.length - illegalItems.length
      } legal`,
      className: "border-red-700 bg-red-950/50 text-red-100",
    };
  }, [activeLayoutPoints, itemStates]);

  const activeExistingCheckForCarDateCircuit = useMemo(() => {
    return history.find(
      (check) =>
        check.car_id === selectedCarId &&
        check.check_date === checkDate &&
        (check.circuit || "") === finalCircuit &&
        check.id !== activeCheckId,
    );
  }, [activeCheckId, checkDate, finalCircuit, history, selectedCarId]);

  const loadLayout = useCallback(async (): Promise<LegalityPoint[]> => {
    const { data, error } = await supabase
      .from("legality_layout_points")
      .select(
        "id,point_key,label,short_label,side,position,x_percent,y_percent,sort_order,active,created_by,created_at,updated_by,updated_at",
      )
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error || !data || data.length === 0) {
      setLayoutPoints(DEFAULT_LEGALITY_POINTS);
      setSelectedLayoutKey(DEFAULT_LEGALITY_POINTS[0]?.key ?? null);
      setItemStates((current) => ({
        ...createDefaultItemState(DEFAULT_LEGALITY_POINTS),
        ...current,
      }));
      return DEFAULT_LEGALITY_POINTS;
    }

    const nextLayout = sortLayoutPoints(
      (data as LegalityLayoutPointRecord[]).map((point, index) =>
        normaliseLayoutPoint(point, index),
      ),
    );

    setLayoutPoints(nextLayout);
    setSelectedLayoutKey(nextLayout[0]?.key ?? null);
    setItemStates((current) => ({
      ...createDefaultItemState(nextLayout),
      ...current,
    }));

    return nextLayout;
  }, []);

  const loadCars = useCallback(async (): Promise<DashboardCar[]> => {
    const { data, error } = await supabase
      .from("dashboard_cars")
      .select("id,name,colour,active,sort_order")
      .in("id", [1, 2, 3]);

    if (error) {
      setCars(DEFAULT_CARS);
      setSelectedCarId(1);
      setDriver(DEFAULT_CARS[0].name);
      return DEFAULT_CARS;
    }

    const mergedCars = mergeCarsFromDashboard((data ?? []) as DashboardCar[]);
    const firstCar = mergedCars.find((car) => car.id === 1) ?? mergedCars[0] ?? null;

    setCars(mergedCars);
    setSelectedCarId(firstCar?.id ?? 1);
    setDriver(firstCar?.name ?? "");

    return mergedCars;
  }, []);

  const loadHistory = useCallback(
    async (pointsForSort: LegalityPoint[] = DEFAULT_LEGALITY_POINTS) => {
      const { data: checkData, error: checkError } = await supabase
        .from("legality_checks")
        .select("*")
        .order("check_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(80);

      if (checkError) {
        setHistory([]);
        setErrorMessage((current) => current || checkError.message);
        return;
      }

      const checks = (checkData ?? []) as LegalityCheckRecord[];
      const checkIds = checks.map((check) => check.id);

      if (checkIds.length === 0) {
        setHistory([]);
        return;
      }

      const { data: itemData, error: itemError } = await supabase
        .from("legality_check_items")
        .select("*")
        .in("legality_check_id", checkIds);

      if (itemError) {
        setHistory(checks.map((check) => ({ ...check, items: [] })));
        setErrorMessage((current) => current || itemError.message);
        return;
      }

      const itemRows = (itemData ?? []) as LegalityCheckItemRecord[];
      const itemsByCheckId = new Map<string, LegalityCheckItemRecord[]>();

      itemRows.forEach((item) => {
        const existing = itemsByCheckId.get(item.legality_check_id) ?? [];
        existing.push(item);
        itemsByCheckId.set(item.legality_check_id, existing);
      });

      const sortOrder = new Map(
        sortLayoutPoints(pointsForSort).map((point, index) => [point.key, index]),
      );

      setHistory(
        checks.map((check) => ({
          ...check,
          items: (itemsByCheckId.get(check.id) ?? []).sort(
            (a, b) =>
              (sortOrder.get(a.item_key) ?? 999) -
              (sortOrder.get(b.item_key) ?? 999),
          ),
        })),
      );
    },
    [],
  );

  useEffect(() => {
    let mounted = true;

    async function initialiseLegalityPage() {
      let layoutForHistory = DEFAULT_LEGALITY_POINTS;

      try {
        const email = await withTimeout(getCurrentUserEmail(), 1500, null);
        const resolvedEmail = email || "guest@local";
        const resolvedRole = getUserRole(resolvedEmail);
        const resolvedAssignedCar = getAssignedCar(resolvedEmail);

        if (!mounted) return;

        setUserEmail(resolvedEmail);
        setUserRole(resolvedRole === "unknown" ? "guest" : resolvedRole);
        setAssignedCar(resolvedAssignedCar);
        setReadOnly(
          isReadOnlyUser(resolvedEmail) || !canEditLegality(resolvedEmail),
        );

        await withTimeout(loadCars(), 2500, DEFAULT_CARS);
        layoutForHistory = await withTimeout(
          loadLayout(),
          2500,
          DEFAULT_LEGALITY_POINTS,
        );
        await withTimeout(loadHistory(layoutForHistory), 3500, undefined);
      } catch (error) {
        console.error("Legality startup failed:", error);

        if (mounted) {
          setUserEmail("guest@local");
          setUserRole("guest");
          setAssignedCar(null);
          setReadOnly(true);
          setCars(DEFAULT_CARS);
          setSelectedCarId(1);
          setDriver(DEFAULT_CARS[0].name);
          setLayoutPoints(DEFAULT_LEGALITY_POINTS);
          setItemStates(createDefaultItemState(DEFAULT_LEGALITY_POINTS));
          setHistory([]);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Legality page failed to initialise. Showing offline fallback layout.",
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initialiseLegalityPage();

    return () => {
      mounted = false;
    };
  }, [loadCars, loadHistory, loadLayout]);

  function updatePointStatus(key: string, status: LegalityStatus) {
    setItemStates((current) => ({
      ...current,
      [key]: {
        ...getPointState(current, key),
        status,
        illegal_note:
          status === "legal" ? "" : getPointState(current, key).illegal_note,
      },
    }));
  }

  function updatePointNote(key: string, note: string) {
    setItemStates((current) => ({
      ...current,
      [key]: {
        ...getPointState(current, key),
        illegal_note: note,
      },
    }));
  }

  function togglePointStatus(key: string) {
    const state = getPointState(itemStates, key);
    updatePointStatus(key, state.status === "legal" ? "illegal" : "legal");
  }

  function updateLayoutPoint(key: string, patch: Partial<LegalityPoint>) {
    setLayoutPoints((current) =>
      sortLayoutPoints(
        current.map((point) =>
          point.key === key
            ? {
                ...point,
                ...patch,
                shortLabel:
                  patch.label && !patch.shortLabel
                    ? patch.label
                    : patch.shortLabel ?? point.shortLabel,
                x:
                  typeof patch.x === "number"
                    ? clampPercent(patch.x)
                    : point.x,
                y:
                  typeof patch.y === "number"
                    ? clampPercent(patch.y)
                    : point.y,
              }
            : point,
        ),
      ),
    );
  }

  function addLayoutPoint() {
    const baseLabel = "NEW POINT";
    const key = `${slugFromLabel(baseLabel)}_${Date.now().toString(36)}`;

    const nextPoint: LegalityPoint = {
      key,
      label: baseLabel,
      shortLabel: "NEW",
      side: "Centre",
      position: "New legality measurement point",
      x: 50,
      y: 50,
      sort_order:
        Math.max(0, ...layoutPoints.map((point) => point.sort_order)) + 10,
      active: true,
    };

    setLayoutPoints((current) => sortLayoutPoints([...current, nextPoint]));
    setSelectedLayoutKey(key);
    setItemStates((current) => ({
      ...current,
      [key]: {
        status: "legal",
        illegal_note: "",
      },
    }));
  }

  function removeLayoutPoint(key: string) {
    if (layoutPoints.length <= 1) {
      setErrorMessage("At least one legality point must remain on the sheet.");
      return;
    }

    const nextLayout = layoutPoints.filter((point) => point.key !== key);

    setLayoutPoints(nextLayout);
    setItemStates((current) => {
      const nextState = { ...current };
      delete nextState[key];
      return nextState;
    });
    setSelectedLayoutKey((current) => {
      if (current !== key) return current;
      return nextLayout[0]?.key ?? null;
    });
  }

  async function saveLayout() {
    if (readOnly) {
      setErrorMessage("Guest/read-only users cannot edit the legality layout.");
      return;
    }

    setSavingLayout(true);
    setMessage("");
    setErrorMessage("");

    try {
      const cleanPoints = sortLayoutPoints(layoutPoints).map((point, index) => ({
        ...point,
        sort_order: (index + 1) * 10,
        label: point.label.trim() || point.key,
        shortLabel: point.shortLabel.trim() || point.label.trim() || point.key,
        position: point.position.trim(),
        x: clampPercent(point.x),
        y: clampPercent(point.y),
        active: true,
      }));

      const { error: upsertError } = await supabase
        .from("legality_layout_points")
        .upsert(
          cleanPoints.map((point) => ({
            point_key: point.key,
            label: point.label,
            short_label: point.shortLabel,
            side: point.side,
            position: point.position,
            x_percent: point.x,
            y_percent: point.y,
            sort_order: point.sort_order,
            active: true,
            updated_by: userEmail,
          })),
          {
            onConflict: "point_key",
          },
        );

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      const activeKeys = cleanPoints.map((point) => point.key);

      if (activeKeys.length > 0) {
        const { error: deactivateError } = await supabase
          .from("legality_layout_points")
          .update({
            active: false,
            updated_by: userEmail,
          })
          .filter("point_key", "not.in", formatSupabaseInList(activeKeys));

        if (deactivateError) {
          throw new Error(deactivateError.message);
        }
      }

      setLayoutPoints(cleanPoints);
      setItemStates((current) => ({
        ...createDefaultItemState(cleanPoints),
        ...current,
      }));
      setLayoutEditMode(false);
      setMessage("Legality layout saved. New sheets will use the updated measurement box positions.");
      await loadHistory(cleanPoints);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save legality layout.",
      );
    } finally {
      setSavingLayout(false);
    }
  }

  function resetToNewSheet(carId = selectedCarId) {
    const car = cars.find((current) => current.id === carId) ?? cars[0] ?? null;

    setActiveCheckId(null);
    setSelectedCarId(car?.id ?? 1);
    setCheckDate(todayIsoDate());
    setSelectedCircuit(CIRCUIT_OPTIONS[0]);
    setCustomCircuit("");
    setDriver(car?.name ?? "");
    setLastSentToEngineerAt(null);
    setItemStates(createDefaultItemState(activeLayoutPoints));
    setMessage("");
    setErrorMessage("");
  }

  function applyCircuitFromSavedValue(value: string | null | undefined) {
    const cleanCircuit = value?.trim() || CIRCUIT_OPTIONS[0];
    const knownCircuit = CIRCUIT_OPTIONS.find((option) => option === cleanCircuit);

    if (knownCircuit) {
      setSelectedCircuit(knownCircuit);
      setCustomCircuit("");
      return;
    }

    setSelectedCircuit("Other");
    setCustomCircuit(cleanCircuit);
  }

  function openCheck(check: LegalityCheckWithItems) {
    const nextState = createDefaultItemState(activeLayoutPoints);

    check.items.forEach((item) => {
      nextState[item.item_key] = {
        status: item.status,
        illegal_note: item.illegal_note ?? "",
      };
    });

    setActiveCheckId(check.id);
    setSelectedCarId(check.car_id);
    setCheckDate(check.check_date);
    applyCircuitFromSavedValue(check.circuit);
    setDriver(check.driver ?? "");
    setLastSentToEngineerAt(check.sent_to_engineer_at ?? null);
    setItemStates(nextState);
    setMessage(`Opened legality check for Car ${check.car_id} on ${niceDate(check.check_date)}.`);
    setErrorMessage("");
  }

  function validateSheet() {
    const cleanDriver = driver.trim();

    if (!selectedCarId) {
      return "Select a car.";
    }

    if (!checkDate) {
      return "Enter a check date.";
    }

    if (!finalCircuit) {
      return "Select a circuit. Use Other if the circuit is not in the list.";
    }

    if (!cleanDriver) {
      return "Driver is missing. Select the car again or enter the driver manually.";
    }

    if (!selectedCarHasEmail) {
      return `No engineer email is configured for Car ${selectedCarId}. Add NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_${selectedCarId} in .env.local/Vercel.`;
    }

    const illegalWithoutNotes = activeLayoutPoints.filter((point) => {
      const state = getPointState(itemStates, point.key);

      return state.status === "illegal" && !state.illegal_note.trim();
    });

    if (illegalWithoutNotes.length > 0) {
      return `Illegal items need notes: ${illegalWithoutNotes
        .map((point) => point.label)
        .join(", ")}.`;
    }

    return "";
  }

  function createItemPayload(): PdfItemPayload[] {
    return activeLayoutPoints.map((point) => {
      const state = getPointState(itemStates, point.key);
      const illegalNote = state.status === "illegal" ? state.illegal_note.trim() : null;

      return {
        item_key: point.key,
        item_name: point.label,
        item_side: point.side,
        item_position: point.position,
        status: state.status,
        illegal_note: illegalNote,
      };
    });
  }

  async function sendLegalityPdf(checkId: string, items: PdfItemPayload[]) {
    const carLabel = selectedCar ? carDisplayName(selectedCar) : `Car ${selectedCarId}`;

    const notifyResponse = await fetch("/api/legality", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        check_id: checkId,
        car_id: selectedCarId,
        car_name: carLabel,
        driver: driver.trim(),
        circuit: finalCircuit,
        check_date: checkDate,
        engineer_name: selectedEngineer.engineerName,
        engineer_email: selectedEngineer.engineerEmail,
        created_by: userEmail,
        items,
      }),
    });

    if (!notifyResponse.ok) {
      const body = await notifyResponse.json().catch(() => null);

      const readableError = [
        body?.error,
        body?.likely_cause ? `Cause: ${body.likely_cause}` : null,
        body?.fix ? `Fix: ${body.fix}` : null,
        body?.technical_error ? `Technical: ${body.technical_error}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      throw new Error(
        readableError || "Legality check saved, but the PDF email failed.",
      );
    }

    const sentAt = new Date().toISOString();

    await supabase
      .from("legality_checks")
      .update({
        sent_to_engineer_at: sentAt,
        updated_by: userEmail,
      })
      .eq("id", checkId);

    setLastSentToEngineerAt(sentAt);

    return notifyResponse.json() as Promise<{
      ok: boolean;
      sent_to: string;
      engineer_name: string;
    }>;
  }

  async function saveCheck() {
    if (readOnly) {
      setMessage("");
      setErrorMessage("Guest/read-only users can view legality checks but cannot edit, save or email them.");
      return;
    }

    const validationError = validateSheet();

    setMessage("");
    setErrorMessage("");

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSaving(true);

    try {
      const cleanDriver = driver.trim();
      const now = new Date().toISOString();
      const existingCheckId = activeCheckId ?? activeExistingCheckForCarDateCircuit?.id ?? null;

      let savedCheckId = existingCheckId;

      if (existingCheckId) {
        const { error } = await supabase
          .from("legality_checks")
          .update({
            car_id: selectedCarId,
            chassis_number: "N/A",
            driver: cleanDriver,
            circuit: finalCircuit,
            engineer_name: selectedEngineer.engineerName,
            engineer_email: selectedEngineer.engineerEmail,
            check_date: checkDate,
            updated_by: userEmail,
            updated_at: now,
          })
          .eq("id", existingCheckId);

        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { data, error } = await supabase
          .from("legality_checks")
          .insert({
            car_id: selectedCarId,
            chassis_number: "N/A",
            driver: cleanDriver,
            circuit: finalCircuit,
            engineer_name: selectedEngineer.engineerName,
            engineer_email: selectedEngineer.engineerEmail,
            check_date: checkDate,
            created_by: userEmail,
            updated_by: userEmail,
            updated_at: now,
          })
          .select("id")
          .single();

        if (error) {
          throw new Error(error.message);
        }

        savedCheckId = data?.id ?? null;
      }

      if (!savedCheckId) {
        throw new Error("The legality sheet was saved without returning an ID. Please reload and try again.");
      }

      const itemPayload = createItemPayload();

      const { error: itemError } = await supabase
        .from("legality_check_items")
        .upsert(
          itemPayload.map((item) => ({
            legality_check_id: savedCheckId,
            item_key: item.item_key,
            item_name: item.item_name,
            item_side: item.item_side,
            item_position: item.item_position,
            status: item.status,
            illegal_note: item.illegal_note,
            updated_at: now,
          })),
          {
            onConflict: "legality_check_id,item_key",
          },
        );

      if (itemError) {
        throw new Error(itemError.message);
      }

      setActiveCheckId(savedCheckId);

      try {
        const notifyResult = await sendLegalityPdf(savedCheckId, itemPayload);
        setMessage(
          `${existingCheckId ? "Legality check updated" : "Legality check saved"}. PDF sent to ${notifyResult.sent_to}.`,
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? `Legality check saved, but the engineer PDF was not sent.\n\n${error.message}`
            : "Legality check saved, but the engineer PDF was not sent.",
        );
      }

      await loadHistory(activeLayoutPoints);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save legality check.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function resendCurrentPdf() {
    if (readOnly) {
      setErrorMessage("Guest/read-only users cannot send legality PDFs.");
      return;
    }

    if (!activeCheckId) {
      setErrorMessage("Save the legality check before sending the PDF.");
      return;
    }

    const validationError = validateSheet();

    setMessage("");
    setErrorMessage("");

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSending(true);

    try {
      const notifyResult = await sendLegalityPdf(activeCheckId, createItemPayload());
      setMessage(`Legality PDF sent to ${notifyResult.sent_to}.`);
      await loadHistory(activeLayoutPoints);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to send legality PDF.",
      );
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading legality...
      </main>
    );
  }

  const backTo = backHref(userRole, assignedCar);

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#111418] shadow-2xl shadow-black/30">
        <div className="relative isolate overflow-hidden border-b border-zinc-800 bg-gradient-to-br from-black via-[#101317] to-[#171114]">
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/2 items-center justify-start overflow-hidden md:flex">
            <img
              src="/rodin-logo.png"
              alt=""
              className="ml-8 h-48 w-auto object-contain opacity-[0.24]"
            />
          </div>

          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 items-center justify-end overflow-hidden md:flex">
            <img
              src="/gb3-logo.png"
              alt=""
              className="mr-8 h-52 w-auto object-contain opacity-[0.26]"
            />
          </div>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0d0f12]/58 via-[#111418]/76 to-[#0d0f12]/58" />

          <div className="relative grid min-h-[210px] gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.42em] text-red-400">
                Rodin Motorsport · GB3 Championship
              </p>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Legality Check
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                Choose the car, circuit and date. The assigned engineer is selected automatically and receives a PDF copy when the sheet is saved.
              </p>
            </div>

            <div className="flex flex-wrap justify-start gap-3 lg:justify-end">
              <Link
                href={backTo}
                className="rounded-2xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-red-500 hover:bg-[#222832] hover:text-red-200"
              >
                Back to Dashboard
              </Link>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      {readOnly && (
        <div className="mb-6 rounded-2xl border border-amber-800 bg-amber-950/25 p-4 text-sm text-amber-200">
          Guest/read-only mode is enabled. You can open and view previous legality checks, but editing, saving and PDF sending are disabled.
        </div>
      )}

      {message && (
        <div className="mb-6 whitespace-pre-wrap rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 whitespace-pre-wrap rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Active Sheet
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
                {activeCheckId ? "Editing saved check" : "New legality check"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                Car, driver and engineer allocation are handled from the selected car. Chassis number is not required.
              </p>
            </div>

            <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${dirtyStatus.className}`}>
              {dirtyStatus.label}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Car
              </span>
              <select
                disabled={readOnly}
                value={selectedCarId}
                onChange={(event) => {
                  const nextCarId = Number(event.target.value);
                  const nextCar = cars.find((car) => car.id === nextCarId);
                  setSelectedCarId(nextCarId);
                  setDriver(nextCar?.name ?? "");
                  setActiveCheckId(null);
                  setLastSentToEngineerAt(null);
                }}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {carDisplayName(car)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Circuit
              </span>
              <select
                disabled={readOnly}
                value={selectedCircuit}
                onChange={(event) => {
                  setSelectedCircuit(event.target.value);
                  setActiveCheckId(null);
                  setLastSentToEngineerAt(null);
                }}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {CIRCUIT_OPTIONS.map((circuit) => (
                  <option key={circuit} value={circuit}>
                    {circuit}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Date
              </span>
              <input
                disabled={readOnly}
                type="date"
                value={checkDate}
                onChange={(event) => {
                  setCheckDate(event.target.value);
                  setActiveCheckId(null);
                  setLastSentToEngineerAt(null);
                }}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>

            <label>
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Driver
              </span>
              <input
                disabled={readOnly}
                value={driver}
                onChange={(event) => setDriver(event.target.value)}
                placeholder="Driver"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>
          </div>

          {selectedCircuit === "Other" && (
            <label className="mt-4 block max-w-xl">
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Other Circuit
              </span>
              <input
                disabled={readOnly}
                value={customCircuit}
                onChange={(event) => {
                  setCustomCircuit(event.target.value);
                  setActiveCheckId(null);
                  setLastSentToEngineerAt(null);
                }}
                placeholder="Enter circuit name"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>
          )}

          <div className="mt-5 rounded-2xl border border-zinc-700 bg-[#0d0f12] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
              Auto-selected Engineer
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-zinc-100">
                  {selectedEngineer.engineerName}
                </div>
                <div className={`mt-1 text-sm ${selectedCarHasEmail ? "text-zinc-400" : "text-red-300"}`}>
                  {selectedCarHasEmail
                    ? selectedEngineer.engineerEmail
                    : `No engineer email configured for Car ${selectedCarId}`}
                </div>
              </div>
              <span className="rounded-full border border-red-900/60 bg-red-950/30 px-3 py-1 text-xs font-semibold text-red-200">
                Car {selectedCarId}
              </span>
            </div>
            {lastSentToEngineerAt && (
              <p className="mt-3 text-xs text-zinc-500">
                Last PDF sent: {niceDateTime(lastSentToEngineerAt)}
              </p>
            )}
          </div>

          {!readOnly && (
            <div className="mt-5 rounded-2xl border border-zinc-700 bg-[#0d0f12] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
                    Measurement Layout
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Chief mechanic can edit the box names and drag their positions on the car overview.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLayoutEditMode((current) => !current)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      layoutEditMode
                        ? "bg-red-700 text-white hover:bg-red-600"
                        : "border border-zinc-700 bg-[#1b2026] text-zinc-100 hover:border-red-500 hover:text-red-200"
                    }`}
                  >
                    {layoutEditMode ? "Close Layout Edit" : "Edit Measurement Boxes"}
                  </button>

                  {layoutEditMode && (
                    <>
                      <button
                        type="button"
                        onClick={addLayoutPoint}
                        className="rounded-xl border border-zinc-700 bg-[#1b2026] px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-red-500 hover:text-red-200"
                      >
                        Add Box
                      </button>

                      <button
                        type="button"
                        onClick={saveLayout}
                        disabled={savingLayout}
                        className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingLayout ? "Saving Layout..." : "Save Layout"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {layoutEditMode && selectedLayoutPoint && (
                <div className="mt-4 grid gap-4 rounded-2xl border border-red-900/50 bg-red-950/10 p-4 lg:grid-cols-2">
                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Box Name
                    </span>
                    <input
                      value={selectedLayoutPoint.label}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          label: event.target.value,
                        })
                      }
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Short Display Label
                    </span>
                    <input
                      value={selectedLayoutPoint.shortLabel}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          shortLabel: event.target.value,
                        })
                      }
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Side
                    </span>
                    <select
                      value={selectedLayoutPoint.side}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          side: event.target.value as LegalitySide,
                        })
                      }
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    >
                      <option value="LH">LH</option>
                      <option value="RH">RH</option>
                      <option value="Centre">Centre</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Position Description
                    </span>
                    <input
                      value={selectedLayoutPoint.position}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          position: event.target.value,
                        })
                      }
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Horizontal Position
                    </span>
                    <input
                      type="range"
                      min="2"
                      max="98"
                      step="0.5"
                      value={selectedLayoutPoint.x}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          x: Number(event.target.value),
                        })
                      }
                      className="mt-3 w-full accent-red-600"
                    />
                    <div className="mt-1 text-xs text-zinc-500">
                      X {selectedLayoutPoint.x.toFixed(1)}%
                    </div>
                  </label>

                  <label>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      Vertical Position
                    </span>
                    <input
                      type="range"
                      min="2"
                      max="98"
                      step="0.5"
                      value={selectedLayoutPoint.y}
                      onChange={(event) =>
                        updateLayoutPoint(selectedLayoutPoint.key, {
                          y: Number(event.target.value),
                        })
                      }
                      className="mt-3 w-full accent-red-600"
                    />
                    <div className="mt-1 text-xs text-zinc-500">
                      Y {selectedLayoutPoint.y.toFixed(1)}%
                    </div>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4 lg:col-span-2">
                    <div className="text-xs leading-5 text-zinc-500">
                      Selected key: <span className="font-mono text-zinc-300">{selectedLayoutPoint.key}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLayoutPoint(selectedLayoutPoint.key)}
                      className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-900/40"
                    >
                      Remove Selected Box
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeExistingCheckForCarDateCircuit && !activeCheckId && !readOnly && (
            <div className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/25 p-4 text-sm text-amber-200">
              A saved legality check already exists for this car/date/circuit. Pressing save will update that sheet rather than creating a duplicate.
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            {!readOnly && (
              <button
                type="button"
                onClick={saveCheck}
                disabled={saving || sending || !selectedCarHasEmail}
                className="rounded-2xl bg-red-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Saving & sending PDF..."
                  : activeCheckId
                    ? "Update & Send PDF"
                    : "Save & Send PDF"}
              </button>
            )}

            {!readOnly && activeCheckId && (
              <button
                type="button"
                onClick={resendCurrentPdf}
                disabled={saving || sending || !selectedCarHasEmail}
                className="rounded-2xl border border-red-800 bg-red-950/30 px-6 py-3 text-sm font-semibold text-red-100 transition hover:border-red-500 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending..." : "Resend PDF"}
              </button>
            )}

            <button
              type="button"
              onClick={() => resetToNewSheet()}
              className="rounded-2xl border border-zinc-700 bg-[#1b2026] px-6 py-3 text-sm font-semibold text-zinc-100 transition hover:border-red-500 hover:bg-[#222832] hover:text-red-200"
            >
              New Blank Sheet
            </button>
          </div>
        </div>

        <aside className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
            Previous Checks
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
            History
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Open any saved sheet to view or edit it. Saved sheets are grouped by date, car and circuit.
          </p>

          <div className="mt-5 max-h-[500px] space-y-3 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-4 text-sm text-zinc-500">
                No previous legality checks found.
              </div>
            ) : (
              history.map((check) => {
                const car = cars.find((current) => current.id === check.car_id);

                return (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => openCheck(check)}
                    className={`w-full rounded-2xl border p-4 text-left transition hover:border-red-500 hover:bg-[#1b2026] ${
                      activeCheckId === check.id
                        ? "border-red-600 bg-red-950/25"
                        : "border-zinc-800 bg-[#0d0f12]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">
                          {niceDate(check.check_date)} · Car {check.car_id}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {check.circuit || "No circuit"} · {car?.name ?? check.driver}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          Engineer: {check.engineer_email || "—"}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${summaryTone(check.items)}`}>
                        {summaryForItems(check.items)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      <span>Updated {niceDateTime(check.updated_at || check.created_at)}</span>
                      <span>{check.sent_to_engineer_at ? `PDF ${niceDateTime(check.sent_to_engineer_at)}` : "PDF not sent"}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </section>

      <section className="rounded-[2rem] border border-zinc-800 bg-[#111418] p-4 shadow-2xl shadow-black/30">
        <div className="overflow-hidden rounded-[1.5rem] border border-zinc-300 bg-zinc-50 text-zinc-950">
          <div className="grid gap-4 border-b border-zinc-300 bg-white p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex flex-wrap items-center gap-5">
              <img src="/rodin-logo.png" alt="Rodin Motorsport" className="h-12 w-auto" />
              <div className="h-10 w-px bg-zinc-300" />
              <img src="/gb3-logo.png" alt="GB3 Championship" className="h-12 w-auto" />
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2 md:min-w-[500px] lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Date</span>
                <div className="mt-1 font-semibold">{niceDate(checkDate)}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Circuit</span>
                <div className="mt-1 font-semibold">{finalCircuit || "—"}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Car</span>
                <div className="mt-1 font-semibold">Car {selectedCarId}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Driver</span>
                <div className="mt-1 font-semibold">{driver.trim() || selectedCar?.name || "—"}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Engineer</span>
                <div className="mt-1 font-semibold">{selectedEngineer.engineerName}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{selectedEngineer.engineerEmail || "No email configured"}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(220px,280px)_minmax(360px,1fr)_minmax(220px,280px)] xl:items-start">
            <div className="grid gap-3 xl:pt-10">
              {leftPoints.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly || layoutEditMode}
                  onStatusChange={(status) => updatePointStatus(point.key, status)}
                  onNoteChange={(note) => updatePointNote(point.key, note)}
                />
              ))}
            </div>

            <LegalityCarOverview
              points={activeLayoutPoints}
              itemStates={itemStates}
              readOnly={readOnly}
              layoutEditMode={layoutEditMode}
              selectedLayoutKey={selectedLayoutKey}
              onSelectLayoutPoint={setSelectedLayoutKey}
              onMoveLayoutPoint={(key, x, y) => updateLayoutPoint(key, { x, y })}
              onTogglePointStatus={togglePointStatus}
            />

            <div className="grid gap-3 xl:pt-10">
              {rightPoints.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly || layoutEditMode}
                  onStatusChange={(status) => updatePointStatus(point.key, status)}
                  onNoteChange={(note) => updatePointNote(point.key, note)}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-300 bg-white p-4">
            <div className="mx-auto max-w-xl">
              {centrePoints.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly || layoutEditMode}
                  onStatusChange={(status) => updatePointStatus(point.key, status)}
                  onNoteChange={(note) => updatePointNote(point.key, note)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
