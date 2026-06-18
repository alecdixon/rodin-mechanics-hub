"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { getCurrentUserEmail } from "@/lib/authHelpers";
import { supabase } from "@/lib/supabase";
import {
  canEditLegality,
  getAssignedCar,
  getUserRole,
  hasPermission,
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

type LegalityPoint = {
  key: string;
  label: string;
  shortLabel: string;
  side: "LH" | "RH" | "Centre";
  position: string;
};

type LegalityItemState = {
  status: LegalityStatus;
  illegal_note: string;
};

type LegalityCheckRecord = {
  id: string;
  car_id: number;
  chassis_number: string;
  driver: string;
  check_date: string;
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

const LEGALITY_POINTS: LegalityPoint[] = [
  {
    key: "fw_lh",
    label: "FW LH",
    shortLabel: "FW",
    side: "LH",
    position: "Front wing main plane / endplate area",
  },
  {
    key: "fwep_lh",
    label: "FWEP LH",
    shortLabel: "FWEP",
    side: "LH",
    position: "Front wing endplate",
  },
  {
    key: "front_lh",
    label: "FRONT LH",
    shortLabel: "FRONT",
    side: "LH",
    position: "Front floor / splitter legality point",
  },
  {
    key: "mid_lh",
    label: "MID LH",
    shortLabel: "MID",
    side: "LH",
    position: "Mid floor legality point",
  },
  {
    key: "rear_lh",
    label: "REAR LH",
    shortLabel: "REAR",
    side: "LH",
    position: "Rear floor legality point",
  },
  {
    key: "diffuser_lh",
    label: "DIFFUSER LH",
    shortLabel: "DIFFUSER",
    side: "LH",
    position: "Diffuser legality point",
  },
  {
    key: "fw_rh",
    label: "FW RH",
    shortLabel: "FW",
    side: "RH",
    position: "Front wing main plane / endplate area",
  },
  {
    key: "fwep_rh",
    label: "FWEP RH",
    shortLabel: "FWEP",
    side: "RH",
    position: "Front wing endplate",
  },
  {
    key: "front_rh",
    label: "FRONT RH",
    shortLabel: "FRONT",
    side: "RH",
    position: "Front floor / splitter legality point",
  },
  {
    key: "mid_rh",
    label: "MID RH",
    shortLabel: "MID",
    side: "RH",
    position: "Mid floor legality point",
  },
  {
    key: "rear_rh",
    label: "REAR RH",
    shortLabel: "REAR",
    side: "RH",
    position: "Rear floor legality point",
  },
  {
    key: "diffuser_rh",
    label: "DIFFUSER RH",
    shortLabel: "DIFFUSER",
    side: "RH",
    position: "Diffuser legality point",
  },
  {
    key: "rw_gap",
    label: "RW GAP",
    shortLabel: "RW GAP",
    side: "Centre",
    position: "Rear wing gap measurement",
  },
];

const LEFT_POINTS = LEGALITY_POINTS.filter((point) => point.side === "LH");
const RIGHT_POINTS = LEGALITY_POINTS.filter((point) => point.side === "RH");
const CENTRE_POINTS = LEGALITY_POINTS.filter((point) => point.side === "Centre");

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultItemState(): Record<string, LegalityItemState> {
  return LEGALITY_POINTS.reduce<Record<string, LegalityItemState>>(
    (state, point) => {
      state[point.key] = {
        status: "legal",
        illegal_note: "",
      };

      return state;
    },
    {},
  );
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

function TopDownRaceCar() {
  return (
    <svg
      viewBox="0 0 360 760"
      role="img"
      aria-label="Top-down race car legality layout"
      className="h-full w-full"
    >
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13" />
        </filter>
        <linearGradient id="carbonFade" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e4e4e7" />
        </linearGradient>
      </defs>

      <rect x="94" y="28" width="172" height="698" fill="none" stroke="#d4d4d8" strokeWidth="2" />
      <line x1="180" y1="34" x2="180" y2="724" stroke="#71717a" strokeDasharray="12 10" strokeWidth="2" />

      <g filter="url(#softShadow)" fill="url(#carbonFade)" stroke="#27272a" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M105 92 C130 64 160 50 180 48 C200 50 230 64 255 92 L270 160 C236 143 204 134 180 132 C156 134 124 143 90 160 Z"
          strokeWidth="2.5"
        />
        <path d="M112 105 L42 72 L28 155 L92 185" fill="none" strokeWidth="2.2" />
        <path d="M248 105 L318 72 L332 155 L268 185" fill="none" strokeWidth="2.2" />
        <path d="M56 86 L70 173" fill="none" strokeWidth="1.6" />
        <path d="M304 86 L290 173" fill="none" strokeWidth="1.6" />

        <path
          d="M159 58 C170 25 190 25 201 58 L205 212 L196 278 L164 278 L155 212 Z"
          strokeWidth="2.4"
        />
        <rect x="151" y="202" width="58" height="28" rx="5" fill="#f4f4f5" strokeWidth="2" />
        <rect x="158" y="270" width="44" height="32" rx="7" fill="#f4f4f5" strokeWidth="2" />

        <rect x="27" y="232" width="70" height="88" rx="20" strokeWidth="2.3" />
        <rect x="263" y="232" width="70" height="88" rx="20" strokeWidth="2.3" />
        <line x1="35" y1="249" x2="88" y2="249" strokeWidth="1.3" />
        <line x1="35" y1="302" x2="88" y2="302" strokeWidth="1.3" />
        <line x1="272" y1="249" x2="325" y2="249" strokeWidth="1.3" />
        <line x1="272" y1="302" x2="325" y2="302" strokeWidth="1.3" />

        <path d="M96 271 L150 236 M96 285 L155 294 M264 271 L210 236 M264 285 L205 294" fill="none" strokeWidth="2" />
        <path d="M94 276 H266" fill="none" strokeWidth="2" />

        <path
          d="M134 318 C146 280 214 280 226 318 L246 505 C231 574 212 624 180 664 C148 624 129 574 114 505 Z"
          strokeWidth="2.4"
        />
        <path d="M143 332 C155 314 205 314 217 332 L225 452 C212 500 196 532 180 553 C164 532 148 500 135 452 Z" fill="#ffffff" strokeWidth="1.6" />
        <path d="M154 384 C161 350 199 350 206 384 C207 423 199 452 180 473 C161 452 153 423 154 384 Z" fill="#e5e7eb" strokeWidth="1.6" />
        <path d="M158 383 C165 360 195 360 202 383 C199 404 193 421 180 436 C167 421 161 404 158 383 Z" fill="#f8fafc" strokeWidth="1.2" />
        <path d="M127 370 H88 L82 470 L112 512" fill="none" strokeWidth="1.8" />
        <path d="M233 370 H272 L278 470 L248 512" fill="none" strokeWidth="1.8" />
        <path d="M129 505 L77 594 M231 505 L283 594" fill="none" strokeWidth="2" />

        <rect x="31" y="590" width="74" height="100" rx="20" strokeWidth="2.3" />
        <rect x="255" y="590" width="74" height="100" rx="20" strokeWidth="2.3" />
        <line x1="39" y1="611" x2="96" y2="611" strokeWidth="1.3" />
        <line x1="39" y1="670" x2="96" y2="670" strokeWidth="1.3" />
        <line x1="264" y1="611" x2="321" y2="611" strokeWidth="1.3" />
        <line x1="264" y1="670" x2="321" y2="670" strokeWidth="1.3" />
        <path d="M105 633 H255" fill="none" strokeWidth="2" />
        <path d="M106 646 L147 614 M254 646 L213 614" fill="none" strokeWidth="2" />

        <path d="M110 676 H250 L270 720 H90 Z" strokeWidth="2.3" />
        <rect x="82" y="705" width="196" height="32" rx="3" strokeWidth="2.1" />
        <path d="M119 705 V737 M241 705 V737" fill="none" strokeWidth="1.5" />
      </g>

      <g stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="7 7">
        <line x1="94" y1="145" x2="45" y2="145" />
        <line x1="266" y1="145" x2="315" y2="145" />
        <line x1="94" y1="205" x2="45" y2="205" />
        <line x1="266" y1="205" x2="315" y2="205" />
        <line x1="94" y1="355" x2="45" y2="355" />
        <line x1="266" y1="355" x2="315" y2="355" />
        <line x1="94" y1="450" x2="45" y2="450" />
        <line x1="266" y1="450" x2="315" y2="450" />
        <line x1="94" y1="565" x2="45" y2="565" />
        <line x1="266" y1="565" x2="315" y2="565" />
        <line x1="94" y1="665" x2="45" y2="665" />
        <line x1="266" y1="665" x2="315" y2="665" />
      </g>
    </svg>
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
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>("unknown");
  const [assignedCar, setAssignedCar] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);

  const [cars, setCars] = useState<DashboardCar[]>(DEFAULT_CARS);
  const [selectedCarId, setSelectedCarId] = useState(1);
  const [checkDate, setCheckDate] = useState(todayIsoDate());
  const [chassisNumber, setChassisNumber] = useState("");
  const [driver, setDriver] = useState(DEFAULT_CARS[0].name);
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null);
  const [itemStates, setItemStates] = useState(createDefaultItemState);

  const [history, setHistory] = useState<LegalityCheckWithItems[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedCar = useMemo(() => {
    return cars.find((car) => car.id === selectedCarId) ?? cars[0] ?? null;
  }, [cars, selectedCarId]);

  const dirtyStatus = useMemo(() => {
    const illegalItems = LEGALITY_POINTS.filter(
      (point) => getPointState(itemStates, point.key).status === "illegal",
    );

    if (illegalItems.length === 0) {
      return {
        illegalCount: 0,
        label: `${LEGALITY_POINTS.length}/${LEGALITY_POINTS.length} legal`,
        className: "border-green-700 bg-green-950/35 text-green-100",
      };
    }

    return {
      illegalCount: illegalItems.length,
      label: `${illegalItems.length} illegal · ${
        LEGALITY_POINTS.length - illegalItems.length
      } legal`,
      className: "border-red-700 bg-red-950/50 text-red-100",
    };
  }, [itemStates]);

  const activeExistingCheckForCarDate = useMemo(() => {
    return history.find(
      (check) =>
        check.car_id === selectedCarId &&
        check.check_date === checkDate &&
        check.id !== activeCheckId,
    );
  }, [activeCheckId, checkDate, history, selectedCarId]);

  const loadCars = useCallback(async () => {
    const { data, error } = await supabase
      .from("dashboard_cars")
      .select("id,name,colour,active,sort_order")
      .in("id", [1, 2, 3]);

    if (error) {
      setCars(DEFAULT_CARS);
      return;
    }

    const mergedCars = mergeCarsFromDashboard((data ?? []) as DashboardCar[]);
    const firstCar = mergedCars.find((car) => car.id === 1) ?? mergedCars[0] ?? null;

    setCars(mergedCars);
    setSelectedCarId(firstCar?.id ?? 1);
    setDriver(firstCar?.name ?? "");
  }, []);

  const loadHistory = useCallback(async () => {
    const { data: checkData, error: checkError } = await supabase
      .from("legality_checks")
      .select("*")
      .order("check_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(80);

    if (checkError) {
      setErrorMessage(checkError.message);
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
      setErrorMessage(itemError.message);
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
      LEGALITY_POINTS.map((point, index) => [point.key, index]),
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
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      const email = await getCurrentUserEmail();

      if (!mounted) return;

      if (!email) {
        router.replace("/login");
        return;
      }

      if (!hasPermission(email, "legality:view")) {
        router.replace(backHref(getUserRole(email), getAssignedCar(email)));
        return;
      }

      setUserEmail(email);
      setUserRole(getUserRole(email));
      setAssignedCar(getAssignedCar(email));
      setReadOnly(isReadOnlyUser(email) || !canEditLegality(email));

      await loadCars();
      await loadHistory();

      if (mounted) {
        setLoading(false);
      }
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [loadCars, loadHistory, router]);

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

  function resetToNewSheet(carId = selectedCarId) {
    const car = cars.find((current) => current.id === carId) ?? cars[0] ?? null;

    setActiveCheckId(null);
    setSelectedCarId(car?.id ?? 1);
    setCheckDate(todayIsoDate());
    setChassisNumber("");
    setDriver(car?.name ?? "");
    setItemStates(createDefaultItemState());
    setMessage("");
    setErrorMessage("");
  }

  function openCheck(check: LegalityCheckWithItems) {
    const nextState = createDefaultItemState();

    check.items.forEach((item) => {
      nextState[item.item_key] = {
        status: item.status,
        illegal_note: item.illegal_note ?? "",
      };
    });

    setActiveCheckId(check.id);
    setSelectedCarId(check.car_id);
    setCheckDate(check.check_date);
    setChassisNumber(check.chassis_number ?? "");
    setDriver(check.driver ?? "");
    setItemStates(nextState);
    setMessage(`Opened legality check for Car ${check.car_id} on ${niceDate(check.check_date)}.`);
    setErrorMessage("");
  }

  function validateSheet() {
    const cleanChassis = chassisNumber.trim();
    const cleanDriver = driver.trim();

    if (!selectedCarId) {
      return "Select a car.";
    }

    if (!checkDate) {
      return "Enter a check date.";
    }

    if (!cleanChassis) {
      return "Enter the chassis number.";
    }

    if (!cleanDriver) {
      return "Enter the driver.";
    }

    const illegalWithoutNotes = LEGALITY_POINTS.filter((point) => {
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

  async function saveCheck() {
    if (readOnly) {
      setMessage("");
      setErrorMessage("Guest/read-only users can view legality checks but cannot edit or save them.");
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

    const cleanChassis = chassisNumber.trim();
    const cleanDriver = driver.trim();
    const now = new Date().toISOString();
    const existingCheckId = activeCheckId ?? activeExistingCheckForCarDate?.id ?? null;

    let savedCheckId = existingCheckId;

    if (existingCheckId) {
      const { error } = await supabase
        .from("legality_checks")
        .update({
          car_id: selectedCarId,
          chassis_number: cleanChassis,
          driver: cleanDriver,
          check_date: checkDate,
          updated_by: userEmail,
          updated_at: now,
        })
        .eq("id", existingCheckId);

      if (error) {
        setErrorMessage(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("legality_checks")
        .insert({
          car_id: selectedCarId,
          chassis_number: cleanChassis,
          driver: cleanDriver,
          check_date: checkDate,
          created_by: userEmail,
          updated_by: userEmail,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        setErrorMessage(error.message);
        setSaving(false);
        return;
      }

      savedCheckId = data?.id ?? null;
    }

    if (!savedCheckId) {
      setErrorMessage("The legality sheet was saved without returning an ID. Please reload and try again.");
      setSaving(false);
      return;
    }

    const itemPayload = LEGALITY_POINTS.map((point) => {
      const state = getPointState(itemStates, point.key);
      const illegalNote = state.status === "illegal" ? state.illegal_note.trim() : null;

      return {
        legality_check_id: savedCheckId,
        item_key: point.key,
        item_name: point.label,
        item_side: point.side,
        item_position: point.position,
        status: state.status,
        illegal_note: illegalNote,
        updated_at: now,
      };
    });

    const { error: itemError } = await supabase
      .from("legality_check_items")
      .upsert(itemPayload, {
        onConflict: "legality_check_id,item_key",
      });

    if (itemError) {
      setErrorMessage(itemError.message);
      setSaving(false);
      return;
    }

    setActiveCheckId(savedCheckId);
    setMessage(
      existingCheckId
        ? "Legality check updated."
        : "Legality check saved.",
    );

    await loadHistory();
    setSaving(false);
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
                Select a car, complete the legality worksheet and record any illegal items with required notes.
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
          Guest/read-only mode is enabled. You can open and view previous legality checks, but editing and saving are disabled.
        </div>
      )}

      {message && (
        <div className="mb-6 rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
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
                Illegal selections cannot be saved unless the note box explains what is illegal.
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
                Chassis #
              </span>
              <input
                disabled={readOnly}
                value={chassisNumber}
                onChange={(event) => setChassisNumber(event.target.value)}
                placeholder="e.g. 022"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
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

          {activeExistingCheckForCarDate && !activeCheckId && !readOnly && (
            <div className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/25 p-4 text-sm text-amber-200">
              A saved legality check already exists for this car/date. Pressing save will update that sheet rather than creating a duplicate.
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            {!readOnly && (
              <button
                type="button"
                onClick={saveCheck}
                disabled={saving}
                className="rounded-2xl bg-red-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : activeCheckId ? "Update Legality Check" : "Save Legality Check"}
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
            Open any saved sheet to view or edit it.
          </p>

          <div className="mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1">
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
                          {car?.name ?? check.driver} · Chassis {check.chassis_number || "—"}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${summaryTone(check.items)}`}>
                        {summaryForItems(check.items)}
                      </span>
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      Updated {niceDateTime(check.updated_at || check.created_at)}
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

            <div className="grid gap-2 text-sm sm:grid-cols-2 md:min-w-[360px]">
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Chassis #</span>
                <div className="mt-1 font-semibold">{chassisNumber.trim() || "—"}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Date</span>
                <div className="mt-1 font-semibold">{niceDate(checkDate)}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Car</span>
                <div className="mt-1 font-semibold">Car {selectedCarId}</div>
              </div>
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Driver</span>
                <div className="mt-1 font-semibold">{driver.trim() || selectedCar?.name || "—"}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(220px,280px)_minmax(360px,1fr)_minmax(220px,280px)] xl:items-start">
            <div className="grid gap-3 xl:pt-10">
              {LEFT_POINTS.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly}
                  onStatusChange={(status) => updatePointStatus(point.key, status)}
                  onNoteChange={(note) => updatePointNote(point.key, note)}
                />
              ))}
            </div>

            <div className="relative min-h-[620px] rounded-3xl border border-zinc-300 bg-white p-4 shadow-inner">
              <TopDownRaceCar />
            </div>

            <div className="grid gap-3 xl:pt-10">
              {RIGHT_POINTS.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly}
                  onStatusChange={(status) => updatePointStatus(point.key, status)}
                  onNoteChange={(note) => updatePointNote(point.key, note)}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-300 bg-white p-4">
            <div className="mx-auto max-w-xl">
              {CENTRE_POINTS.map((point) => (
                <LegalityPointCard
                  key={point.key}
                  point={point}
                  state={getPointState(itemStates, point.key)}
                  disabled={readOnly}
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
