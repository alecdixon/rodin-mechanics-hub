"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getUserRole, type UserRole } from "@/lib/userAccess";

type PlankStatus = "legal" | "warning" | "illegal";

type PlankLegalityRecord = {
  id: string;
  car_id: number;
  car_name: string | null;
  created_by: string | null;
  created_at: string | null;
  report_date: string | null;
  session: string | null;
  circuit: string | null;
  hole_1_a_mm: number | null;
  hole_1_b_mm: number | null;
  hole_1_c_mm: number | null;
  hole_2_a_mm: number | null;
  hole_2_b_mm: number | null;
  hole_2_c_mm: number | null;
  hole_3_a_mm: number | null;
  hole_3_b_mm: number | null;
  hole_3_c_mm: number | null;
  hole_4_a_mm: number | null;
  hole_4_b_mm: number | null;
  hole_4_c_mm: number | null;
  minimum_thickness_mm: number | null;
  status: PlankStatus | null;
  illegal_count: number | null;
  near_limit_count: number | null;
  notes: string | null;
  engineer_name: string | null;
  engineer_email: string | null;
  sent_to_engineer_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type CarAllocation = {
  id: string;
  carId: number;
  driverName: string;
};

type CarEngineerAllocation = {
  carId: number;
  engineerName: string;
  engineerEmail: string;
};

type PlankHolePdfPayload = {
  hole_key: string;
  hole_name: string;
  position: string;
  min_mm: number | null;
  max_mm: number | null;
  status: PlankStatus;
};

const PLANK_LIMIT_MM = 3.0;
const NEAR_LIMIT_MM = 3.2;

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

const CAR_ALLOCATIONS: CarAllocation[] = [
  { id: "car-1", carId: 1, driverName: "Rehm" },
  { id: "car-2", carId: 2, driverName: "Molnar" },
  { id: "car-3", carId: 3, driverName: "Pulling" },
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

const HOLES = [
  {
    id: "hole_1",
    label: "Hole 1",
    shortLabel: "H1",
    displayPosition: "Front plank · LH",
  },
  {
    id: "hole_2",
    label: "Hole 2",
    shortLabel: "H2",
    displayPosition: "Front plank · RH",
  },
  {
    id: "hole_3",
    label: "Hole 3",
    shortLabel: "H3",
    displayPosition: "Rear plank · Forward",
  },
  {
    id: "hole_4",
    label: "Hole 4",
    shortLabel: "H4",
    displayPosition: "Rear plank · Rearward",
  },
] as const;

const MEASUREMENT_FIELDS = ["min", "max"] as const;

type HoleId = (typeof HOLES)[number]["id"];
type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];
type MeasurementState = Record<HoleId, Record<MeasurementField, string>>;

type ReadingDetail = {
  holeId: HoleId;
  holeLabel: string;
  field: MeasurementField;
  raw: string;
  value: number | null;
  isMissing: boolean;
  isInvalidNumber: boolean;
};

type HoleAnalysis = {
  holeId: HoleId;
  holeLabel: string;
  shortLabel: string;
  displayPosition: string;
  minRaw: string;
  maxRaw: string;
  min: number | null;
  max: number | null;
  isComplete: boolean;
  hasInvalid: boolean;
  isIllegal: boolean;
  isWarning: boolean;
};

function createEmptyMeasurements(): MeasurementState {
  return {
    hole_1: { min: "", max: "" },
    hole_2: { min: "", max: "" },
    hole_3: { min: "", max: "" },
    hole_4: { min: "", max: "" },
  };
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReportDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function parseMeasurement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getReadings(measurements: MeasurementState): ReadingDetail[] {
  return HOLES.flatMap((hole) => {
    return MEASUREMENT_FIELDS.map((field) => {
      const raw = measurements[hole.id][field];
      const value = parseMeasurement(raw);
      const isMissing = raw.trim().length === 0;
      const isInvalidNumber = !isMissing && value === null;

      return {
        holeId: hole.id,
        holeLabel: hole.label,
        field,
        raw,
        value,
        isMissing,
        isInvalidNumber,
      };
    });
  });
}

function formatMm(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} mm`;
}

function getEngineerAllocationForCar(carId: number) {
  return (
    CAR_ENGINEER_ALLOCATIONS.find((allocation) => allocation.carId === carId) ??
    CAR_ENGINEER_ALLOCATIONS[0]
  );
}

function normaliseCircuit(value: string | null | undefined) {
  const cleanValue = value?.trim() || CIRCUIT_OPTIONS[0];
  const knownCircuit = CIRCUIT_OPTIONS.find((option) => option === cleanValue);

  if (knownCircuit) {
    return {
      circuit: knownCircuit,
      customCircuit: "",
    };
  }

  return {
    circuit: "Other" as (typeof CIRCUIT_OPTIONS)[number],
    customCircuit: cleanValue,
  };
}

function holeStatus(hole: HoleAnalysis): PlankStatus {
  if (hole.isIllegal) return "illegal";
  if (hole.isWarning) return "warning";
  return "legal";
}

function statusText(status: PlankStatus | "incomplete" | "invalid" | null | undefined) {
  if (status === "illegal") return "ILLEGAL";
  if (status === "warning") return "LEGAL BUT CLOSE TO LIMIT";
  if (status === "legal") return "LEGAL";
  if (status === "invalid") return "INVALID";
  return "INCOMPLETE";
}

function clampMax(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  if (min === null) return max;
  if (max === null) return min;
  return Math.max(min, max);
}

function clampMin(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  if (min === null) return max;
  if (max === null) return min;
  return Math.min(min, max);
}

function holeCardClass(hole: HoleAnalysis) {
  if (hole.hasInvalid) return "border-red-700 bg-red-950/25";
  if (!hole.isComplete) return "border-zinc-800 bg-[#0d0f12]";
  if (hole.isIllegal) return "border-red-700 bg-red-950/25";
  if (hole.isWarning) return "border-yellow-700 bg-yellow-950/20";
  return "border-green-800 bg-green-950/15";
}

function holeBadge(hole: HoleAnalysis) {
  if (hole.hasInvalid) {
    return {
      text: "Check",
      className: "border-red-700 text-red-200",
    };
  }

  if (!hole.isComplete) {
    return {
      text: "Open",
      className: "border-zinc-700 text-zinc-400",
    };
  }

  if (hole.isIllegal) {
    return {
      text: "Fail",
      className: "border-red-700 text-red-200",
    };
  }

  if (hole.isWarning) {
    return {
      text: "Close",
      className: "border-yellow-700 text-yellow-200",
    };
  }

  return {
    text: "Pass",
    className: "border-green-700 text-green-200",
  };
}

function MeasurementInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const numericValue = parseMeasurement(value);
  const isInvalid = value.trim().length > 0 && numericValue === null;
  const isIllegal = label === "Max" && numericValue !== null && numericValue < PLANK_LIMIT_MM;
  const isWarning =
    label === "Max" &&
    numericValue !== null &&
    numericValue >= PLANK_LIMIT_MM &&
    numericValue < NEAR_LIMIT_MM;

  return (
    <label>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>

      <div className="relative">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder="3.00"
          className={`w-full rounded-lg border bg-[#101317] px-3 py-2 pr-10 text-sm text-zinc-100 outline-none focus:border-red-500 ${
            isIllegal || isInvalid
              ? "border-red-600"
              : isWarning
                ? "border-yellow-600"
                : "border-zinc-700"
          }`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-zinc-500">
          mm
        </span>
      </div>
    </label>
  );
}

function HoleMeasurementCard({
  hole,
  measurements,
  onChange,
}: {
  hole: HoleAnalysis;
  measurements: MeasurementState;
  onChange: (holeId: HoleId, field: MeasurementField, value: string) => void;
}) {
  const badge = holeBadge(hole);

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${holeCardClass(hole)}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-100">
            {hole.shortLabel}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">{hole.displayPosition}</p>
        </div>

        <div className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${badge.className}`}>
          {badge.text}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MeasurementInput
          label="Min"
          value={measurements[hole.holeId].min}
          onChange={(value) => onChange(hole.holeId, "min", value)}
        />

        <MeasurementInput
          label="Max"
          value={measurements[hole.holeId].max}
          onChange={(value) => onChange(hole.holeId, "max", value)}
        />
      </div>
    </div>
  );
}

function SimplePlankDiagram() {
  return (
    <div className="rounded-[2rem] border border-zinc-800 bg-[#0d0f12] p-5 shadow-inner shadow-black/40">
      <svg
        viewBox="0 0 520 680"
        role="img"
        aria-label="Simple skid plank measurement hole diagram"
        className="mx-auto h-auto w-full max-w-[440px]"
      >
        <rect x="0" y="0" width="520" height="680" rx="28" fill="#0d0f12" />

        <text
          x="42"
          y="78"
          fill="#a1a1aa"
          fontSize="20"
          fontWeight="800"
          letterSpacing="3"
        >
          FRONT
        </text>

        <text
          x="42"
          y="620"
          fill="#a1a1aa"
          fontSize="20"
          fontWeight="800"
          letterSpacing="3"
        >
          REAR
        </text>

        <path
          d="M78 560 V150"
          stroke="#71717a"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M78 110 L48 160 H68 V560 H88 V160 H108 Z"
          fill="none"
          stroke="#71717a"
          strokeWidth="5"
          strokeLinejoin="round"
        />

        <g fill="#111418" stroke="#e4e4e7" strokeWidth="5">
          <rect x="190" y="55" width="200" height="190" rx="6" />
          <rect x="190" y="285" width="200" height="315" rx="6" />
        </g>

        <g fill="#0d0f12" stroke="#e4e4e7" strokeWidth="5">
          <circle cx="245" cy="150" r="24" />
          <circle cx="335" cy="150" r="24" />
          <circle cx="290" cy="365" r="24" />
          <circle cx="290" cy="535" r="24" />
        </g>

        <g
          fill="#f4f4f5"
          fontSize="17"
          fontWeight="900"
          letterSpacing="2"
        >
          <text x="231" y="107">H1</text>
          <text x="321" y="107">H2</text>
          <text x="306" y="352">H3</text>
          <text x="306" y="522">H4</text>
        </g>

        <g stroke="#3f3f46" strokeWidth="2">
          <line x1="245" y1="150" x2="150" y2="150" />
          <line x1="335" y1="150" x2="450" y2="150" />
          <line x1="290" y1="365" x2="450" y2="365" />
          <line x1="290" y1="535" x2="450" y2="535" />
        </g>

        <g fill="#a1a1aa" fontSize="13" fontWeight="800" letterSpacing="2">
          <text x="118" y="142">H1</text>
          <text x="458" y="142">H2</text>
          <text x="458" y="357">H3</text>
          <text x="458" y="527">H4</text>
        </g>
      </svg>

      <p className="mt-4 text-center text-xs leading-5 text-zinc-500">
        Simple plank layout. H1–H4 match the four measured holes.
      </p>
    </div>
  );
}

export default function PlankLegalityPage() {
  const [userRole, setUserRole] = useState<UserRole>("unknown");

  const [selectedAllocationId, setSelectedAllocationId] = useState(
    CAR_ALLOCATIONS[0]?.id || "",
  );

  const [reportDate, setReportDate] = useState(getTodayIsoDate());
  const [session, setSession] = useState("");

  const [circuit, setCircuit] =
    useState<(typeof CIRCUIT_OPTIONS)[number]>("Oulton Park");
  const [customCircuit, setCustomCircuit] = useState("");

  const [measurements, setMeasurements] = useState<MeasurementState>(
    createEmptyMeasurements,
  );
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [records, setRecords] = useState<PlankLegalityRecord[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [lastSentToEngineerAt, setLastSentToEngineerAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedAllocation = useMemo(() => {
    return (
      CAR_ALLOCATIONS.find(
        (allocation) => allocation.id === selectedAllocationId,
      ) ||
      CAR_ALLOCATIONS[0] ||
      null
    );
  }, [selectedAllocationId]);

  const activeCarId = selectedAllocation?.carId ?? 0;
  const activeDriverName = selectedAllocation?.driverName ?? "Unknown Driver";

  const carDisplayLabel = activeCarId
    ? `Car ${activeCarId} - ${activeDriverName}`
    : "No car selected";

  const selectedEngineer = useMemo(() => {
    return getEngineerAllocationForCar(activeCarId);
  }, [activeCarId]);

  const selectedCarHasEmail = Boolean(selectedEngineer.engineerEmail.trim());

  const finalSession = useMemo(() => session.trim(), [session]);

  const finalCircuit = useMemo(() => {
    if (circuit === "Other") return customCircuit.trim();
    return circuit;
  }, [circuit, customCircuit]);

  const analysis = useMemo(() => {
    const readings = getReadings(measurements);
    const validReadings = readings.filter((reading) => reading.value !== null);
    const invalidReadings = readings.filter((reading) => reading.isInvalidNumber);
    const missingReadings = readings.filter((reading) => reading.isMissing);

    const holeAnalyses: HoleAnalysis[] = HOLES.map((hole) => {
      const minRaw = measurements[hole.id].min;
      const maxRaw = measurements[hole.id].max;
      const parsedMin = parseMeasurement(minRaw);
      const parsedMax = parseMeasurement(maxRaw);
      const min = clampMin(parsedMin, parsedMax);
      const max = clampMax(parsedMin, parsedMax);
      const minInvalid = minRaw.trim().length > 0 && parsedMin === null;
      const maxInvalid = maxRaw.trim().length > 0 && parsedMax === null;
      const hasInvalid = minInvalid || maxInvalid;
      const isComplete =
        minRaw.trim().length > 0 &&
        maxRaw.trim().length > 0 &&
        !hasInvalid;

      const isIllegal = isComplete && (max ?? 0) < PLANK_LIMIT_MM;
      const isWarning =
        isComplete &&
        !isIllegal &&
        (max ?? 0) >= PLANK_LIMIT_MM &&
        (max ?? 0) < NEAR_LIMIT_MM;

      return {
        holeId: hole.id,
        holeLabel: hole.label,
        shortLabel: hole.shortLabel,
        displayPosition: hole.displayPosition,
        minRaw,
        maxRaw,
        min,
        max,
        isComplete,
        hasInvalid,
        isIllegal,
        isWarning,
      };
    });

    const failedHoles = holeAnalyses.filter((hole) => hole.isIllegal);
    const warningHoles = holeAnalyses.filter((hole) => hole.isWarning);

    const minimumReading = validReadings.reduce<ReadingDetail | null>(
      (currentMinimum, reading) => {
        if (!currentMinimum) return reading;
        return (reading.value ?? Infinity) < (currentMinimum.value ?? Infinity)
          ? reading
          : currentMinimum;
      },
      null,
    );

    const lowestMaxHole = holeAnalyses
      .filter((hole) => hole.max !== null)
      .reduce<HoleAnalysis | null>((currentMinimum, hole) => {
        if (!currentMinimum) return hole;
        return (hole.max ?? Infinity) < (currentMinimum.max ?? Infinity)
          ? hole
          : currentMinimum;
      }, null);

    const isComplete = holeAnalyses.every((hole) => hole.isComplete);

    let status: PlankStatus | "incomplete" | "invalid" = "incomplete";

    if (invalidReadings.length > 0 || holeAnalyses.some((hole) => hole.hasInvalid)) {
      status = "invalid";
    } else if (!isComplete) {
      status = "incomplete";
    } else if (failedHoles.length > 0) {
      status = "illegal";
    } else if (warningHoles.length > 0) {
      status = "warning";
    } else {
      status = "legal";
    }

    return {
      readings,
      validReadings,
      invalidReadings,
      missingReadings,
      holeAnalyses,
      failedHoles,
      warningHoles,
      minimumReading,
      lowestMaxHole,
      isComplete,
      status,
    };
  }, [measurements]);

  const showChiefDashboardButton =
    userRole === "chief_mechanic" || userRole === "engineer";

  const canDeletePlankReports = userRole === "chief_mechanic";
  const canSubmitPlankReports = userRole !== "guest";

  async function loadRecordsForCar(carId: number) {
    if (!Number.isFinite(carId) || carId <= 0) {
      setRecords([]);
      return;
    }

    const { data, error } = await supabase
      .from("plank_legality_reports")
      .select("*")
      .eq("car_id", carId)
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setRecords((data ?? []) as PlankLegalityRecord[]);
  }

  useEffect(() => {
    async function loadPageData() {
      setLoading(true);
      setMessage("");
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email ?? null;

      setCreatedBy(email);
      setUserRole(getUserRole(email));

      if (selectedAllocation) {
        await loadRecordsForCar(selectedAllocation.carId);
      }

      setLoading(false);
    }

    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAllocation?.carId]);

  function updateMeasurement(
    holeId: HoleId,
    field: MeasurementField,
    value: string,
  ) {
    setMeasurements((current) => ({
      ...current,
      [holeId]: {
        ...current[holeId],
        [field]: value,
      },
    }));
  }

  function resetFormAfterSubmit() {
    setMeasurements(createEmptyMeasurements());
    setNotes("");
  }

  function validatePlankSheet() {
    if (!canSubmitPlankReports) {
      return "Guest users cannot submit plank legality reports.";
    }

    if (!selectedAllocation) {
      return "Select a car before saving.";
    }

    if (!reportDate) {
      return "Select a report date.";
    }

    if (!finalSession) {
      return "Enter a session.";
    }

    if (!finalCircuit) {
      return "Enter a circuit.";
    }

    if (!selectedCarHasEmail) {
      return `No engineer email is configured for Car ${activeCarId}. Add NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_${activeCarId} in .env.local/Vercel.`;
    }

    if (analysis.status === "invalid") {
      return "One or more thickness measurements is not a valid number.";
    }

    if (!analysis.isComplete) {
      return `Complete Min and Max for all 4 holes before saving. Missing ${analysis.missingReadings.length}.`;
    }

    if (analysis.minimumReading?.value === null || analysis.minimumReading?.value === undefined) {
      return "Unable to calculate the minimum plank thickness.";
    }

    return "";
  }

  function createHolePdfPayload(): PlankHolePdfPayload[] {
    return analysis.holeAnalyses.map((hole) => ({
      hole_key: hole.holeId,
      hole_name: hole.holeLabel,
      position: hole.displayPosition,
      min_mm: hole.min,
      max_mm: hole.max,
      status: holeStatus(hole),
    }));
  }

  function createReportPayload() {
    const status: PlankStatus =
      analysis.status === "illegal"
        ? "illegal"
        : analysis.status === "warning"
          ? "warning"
          : "legal";

    return {
      report_date: reportDate,
      session: finalSession,
      circuit: finalCircuit,
      car_id: selectedAllocation?.carId ?? activeCarId,
      car_name: carDisplayLabel,

      // Existing database columns are reused:
      // A = Min, B = Max, C = unused/null for the simplified Min/Max input format.
      hole_1_a_mm: analysis.holeAnalyses[0]?.min ?? null,
      hole_1_b_mm: analysis.holeAnalyses[0]?.max ?? null,
      hole_1_c_mm: analysis.holeAnalyses[0]?.max ?? 0,
      hole_2_a_mm: analysis.holeAnalyses[1]?.min ?? null,
      hole_2_b_mm: analysis.holeAnalyses[1]?.max ?? null,
      hole_2_c_mm: analysis.holeAnalyses[1]?.max ?? 0,
      hole_3_a_mm: analysis.holeAnalyses[2]?.min ?? null,
      hole_3_b_mm: analysis.holeAnalyses[2]?.max ?? null,
      hole_3_c_mm: analysis.holeAnalyses[2]?.max ?? 0,
      hole_4_a_mm: analysis.holeAnalyses[3]?.min ?? null,
      hole_4_b_mm: analysis.holeAnalyses[3]?.max ?? null,
      hole_4_c_mm: analysis.holeAnalyses[3]?.max ?? 0,

      minimum_thickness_mm: analysis.minimumReading?.value ?? null,
      status,
      illegal_count: analysis.failedHoles.length,
      near_limit_count: analysis.warningHoles.length,
      notes: notes.trim() || null,
      engineer_name: selectedEngineer.engineerName,
      engineer_email: selectedEngineer.engineerEmail,
      created_by: createdBy,
      updated_by: createdBy,
      updated_at: new Date().toISOString(),
    };
  }

  async function sendPlankLegalityPdf(reportId: string, holes: PlankHolePdfPayload[]) {
    const notifyResponse = await fetch("/api/plank-legality", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        report_id: reportId,
        car_id: activeCarId,
        car_name: carDisplayLabel,
        driver: activeDriverName,
        circuit: finalCircuit,
        report_date: reportDate,
        session: finalSession,
        engineer_name: selectedEngineer.engineerName,
        engineer_email: selectedEngineer.engineerEmail,
        created_by: createdBy,
        status: analysis.status === "illegal" ? "illegal" : analysis.status === "warning" ? "warning" : "legal",
        minimum_thickness_mm: analysis.minimumReading?.value ?? null,
        failed_holes: analysis.failedHoles.length,
        near_limit_holes: analysis.warningHoles.length,
        notes: notes.trim() || null,
        holes,
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
        readableError || "Plank legality report saved, but the PDF email failed.",
      );
    }

    const sentAt = new Date().toISOString();

    await supabase
      .from("plank_legality_reports")
      .update({
        sent_to_engineer_at: sentAt,
        updated_by: createdBy,
        updated_at: sentAt,
      })
      .eq("id", reportId);

    setLastSentToEngineerAt(sentAt);

    return notifyResponse.json() as Promise<{
      ok: boolean;
      sent_to: string;
      engineer_name: string;
    }>;
  }

  async function submitPlankLegalityReport() {
    setMessage("");
    setErrorMessage("");

    const validationError = validatePlankSheet();

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSaving(true);

    try {
      const payload = createReportPayload();
      const existingReportId = activeReportId;
      let savedReport: PlankLegalityRecord | null = null;

      if (existingReportId) {
        const { data, error } = await supabase
          .from("plank_legality_reports")
          .update(payload)
          .eq("id", existingReportId)
          .select("*")
          .single();

        if (error) {
          throw new Error(error.message);
        }

        savedReport = data as PlankLegalityRecord;
      } else {
        const { data, error } = await supabase
          .from("plank_legality_reports")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw new Error(error.message);
        }

        savedReport = data as PlankLegalityRecord;
      }

      if (!savedReport?.id) {
        throw new Error("The plank legality report was saved without returning an ID. Reload and try again.");
      }

      setActiveReportId(savedReport.id);
      const holePayload = createHolePdfPayload();

      try {
        const notifyResult = await sendPlankLegalityPdf(savedReport.id, holePayload);
        setMessage(
          `${existingReportId ? "Plank legality report updated" : "Plank legality report saved"}. PDF sent to ${notifyResult.sent_to}. Result: ${statusText(payload.status)}. Lowest reading: ${formatMm(payload.minimum_thickness_mm)}.`,
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? `Plank legality report saved, but the engineer PDF was not sent.\n\n${error.message}`
            : "Plank legality report saved, but the engineer PDF was not sent.",
        );
      }

      await loadRecordsForCar(activeCarId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save plank legality report.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function resendCurrentPlankPdf() {
    setMessage("");
    setErrorMessage("");

    if (!activeReportId) {
      setErrorMessage("Save the plank legality report before sending the PDF.");
      return;
    }

    const validationError = validatePlankSheet();

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSending(true);

    try {
      const notifyResult = await sendPlankLegalityPdf(activeReportId, createHolePdfPayload());
      setMessage(`Plank legality PDF sent to ${notifyResult.sent_to}.`);
      await loadRecordsForCar(activeCarId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to send plank legality PDF.",
      );
    } finally {
      setSending(false);
    }
  }

  async function resendSavedPlankPdf(record: PlankLegalityRecord) {
    setMessage("");
    setErrorMessage("");

    if (!canSubmitPlankReports) {
      setErrorMessage("Guest users cannot send plank legality PDFs.");
      return;
    }

    const engineerEmail = record.engineer_email || getEngineerAllocationForCar(record.car_id).engineerEmail;
    const engineerName = record.engineer_name || getEngineerAllocationForCar(record.car_id).engineerName;

    if (!engineerEmail.trim()) {
      setErrorMessage(`No engineer email is configured for Car ${record.car_id}.`);
      return;
    }

    setSending(true);

    try {
      const holes: PlankHolePdfPayload[] = [
        {
          hole_key: "hole_1",
          hole_name: "Hole 1",
          position: "Front plank · LH",
          min_mm: Number(record.hole_1_a_mm ?? NaN),
          max_mm: Number(record.hole_1_b_mm ?? NaN),
          status: Number(record.hole_1_b_mm ?? 0) < PLANK_LIMIT_MM ? "illegal" : Number(record.hole_1_b_mm ?? 0) < NEAR_LIMIT_MM ? "warning" : "legal",
        },
        {
          hole_key: "hole_2",
          hole_name: "Hole 2",
          position: "Front plank · RH",
          min_mm: Number(record.hole_2_a_mm ?? NaN),
          max_mm: Number(record.hole_2_b_mm ?? NaN),
          status: Number(record.hole_2_b_mm ?? 0) < PLANK_LIMIT_MM ? "illegal" : Number(record.hole_2_b_mm ?? 0) < NEAR_LIMIT_MM ? "warning" : "legal",
        },
        {
          hole_key: "hole_3",
          hole_name: "Hole 3",
          position: "Rear plank · Forward",
          min_mm: Number(record.hole_3_a_mm ?? NaN),
          max_mm: Number(record.hole_3_b_mm ?? NaN),
          status: Number(record.hole_3_b_mm ?? 0) < PLANK_LIMIT_MM ? "illegal" : Number(record.hole_3_b_mm ?? 0) < NEAR_LIMIT_MM ? "warning" : "legal",
        },
        {
          hole_key: "hole_4",
          hole_name: "Hole 4",
          position: "Rear plank · Rearward",
          min_mm: Number(record.hole_4_a_mm ?? NaN),
          max_mm: Number(record.hole_4_b_mm ?? NaN),
          status: Number(record.hole_4_b_mm ?? 0) < PLANK_LIMIT_MM ? "illegal" : Number(record.hole_4_b_mm ?? 0) < NEAR_LIMIT_MM ? "warning" : "legal",
        },
      ].map<PlankHolePdfPayload>((hole) => ({
        ...hole,
        status: hole.status as PlankStatus,
        min_mm: Number.isFinite(hole.min_mm) ? hole.min_mm : null,
        max_mm: Number.isFinite(hole.max_mm) ? hole.max_mm : null,
      }));

      const notifyResponse = await fetch("/api/plank-legality", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_id: record.id,
          car_id: record.car_id,
          car_name: record.car_name || `Car ${record.car_id}`,
          driver: record.car_name || `Car ${record.car_id}`,
          circuit: record.circuit,
          report_date: record.report_date,
          session: record.session,
          engineer_name: engineerName,
          engineer_email: engineerEmail,
          created_by: createdBy,
          status: record.status || "legal",
          minimum_thickness_mm: record.minimum_thickness_mm,
          failed_holes: record.illegal_count ?? 0,
          near_limit_holes: record.near_limit_count ?? 0,
          notes: record.notes,
          holes,
        }),
      });

      if (!notifyResponse.ok) {
        const body = await notifyResponse.json().catch(() => null);
        throw new Error(body?.error || "Failed to send saved plank legality PDF.");
      }

      const sentAt = new Date().toISOString();

      await supabase
        .from("plank_legality_reports")
        .update({
          sent_to_engineer_at: sentAt,
          engineer_name: engineerName,
          engineer_email: engineerEmail,
          updated_by: createdBy,
          updated_at: sentAt,
        })
        .eq("id", record.id);

      const notifyResult = await notifyResponse.json() as {
        sent_to: string;
      };

      setMessage(`Plank legality PDF sent to ${notifyResult.sent_to}.`);
      await loadRecordsForCar(record.car_id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to send saved plank legality PDF.",
      );
    } finally {
      setSending(false);
    }
  }

  function openPlankLegalityRecord(record: PlankLegalityRecord) {
    const savedCircuit = normaliseCircuit(record.circuit);

    setActiveReportId(record.id);
    setSelectedAllocationId(`car-${record.car_id}`);
    setReportDate(record.report_date || getTodayIsoDate());
    setSession(record.session || "");
    setCircuit(savedCircuit.circuit);
    setCustomCircuit(savedCircuit.customCircuit);
    setMeasurements({
      hole_1: {
        min: record.hole_1_a_mm === null ? "" : String(record.hole_1_a_mm),
        max: record.hole_1_b_mm === null ? "" : String(record.hole_1_b_mm),
      },
      hole_2: {
        min: record.hole_2_a_mm === null ? "" : String(record.hole_2_a_mm),
        max: record.hole_2_b_mm === null ? "" : String(record.hole_2_b_mm),
      },
      hole_3: {
        min: record.hole_3_a_mm === null ? "" : String(record.hole_3_a_mm),
        max: record.hole_3_b_mm === null ? "" : String(record.hole_3_b_mm),
      },
      hole_4: {
        min: record.hole_4_a_mm === null ? "" : String(record.hole_4_a_mm),
        max: record.hole_4_b_mm === null ? "" : String(record.hole_4_b_mm),
      },
    });
    setNotes(record.notes || "");
    setLastSentToEngineerAt(record.sent_to_engineer_at || null);
    setMessage(`Opened plank legality report for ${record.car_name || `Car ${record.car_id}`} on ${formatReportDate(record.report_date)}.`);
    setErrorMessage("");
  }

  function resetToNewReport() {
    setActiveReportId(null);
    setLastSentToEngineerAt(null);
    setReportDate(getTodayIsoDate());
    setSession("");
    setCircuit(CIRCUIT_OPTIONS[0]);
    setCustomCircuit("");
    setMeasurements(createEmptyMeasurements());
    setNotes("");
    setMessage("");
    setErrorMessage("");
  }

  async function deletePlankLegalityRecord(record: PlankLegalityRecord) {
    setMessage("");
    setErrorMessage("");

    if (!canDeletePlankReports) {
      setErrorMessage("Only the chief mechanic can delete plank legality records.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this plank legality record?\n\n${record.car_name || `Car ${record.car_id}`}\n${record.circuit || "No circuit"} · ${record.session || "No session"} · Lowest ${formatMm(record.minimum_thickness_mm)} · ${record.status?.toUpperCase() || "NO STATUS"}`,
    );

    if (!confirmed) return;

    setDeletingId(record.id);

    const { error } = await supabase
      .from("plank_legality_reports")
      .delete()
      .eq("id", record.id);

    if (error) {
      setErrorMessage(error.message);
      setDeletingId(null);
      return;
    }

    setMessage("Plank legality record deleted.");

    if (activeReportId === record.id) {
      resetToNewReport();
    }

    setDeletingId(null);

    if (selectedAllocation) {
      await loadRecordsForCar(selectedAllocation.carId);
    }
  }

  function getWarningBarContent() {
    if (analysis.status === "invalid") {
      return {
        title: "Invalid Entry",
        text: "One or more readings is not a valid number. Enter millimetres only, for example 3.08.",
        className: "border-red-900 bg-red-950/40 text-red-200",
        badge: "CHECK INPUT",
      };
    }

    if (!analysis.isComplete) {
      return {
        title: "Measurement Incomplete",
        text: `${analysis.validReadings.length}/8 Min/Max readings entered. Enter Min and Max beside each of the 4 holes.`,
        className: "border-zinc-800 bg-[#101317] text-zinc-300",
        badge: "IN PROGRESS",
      };
    }

    if (analysis.status === "illegal") {
      return {
        title: "ILLEGAL — At Least One Hole Fails The Rule",
        text: `${analysis.failedHoles.length} hole${analysis.failedHoles.length === 1 ? "" : "s"} failed. For each hole, at least one point must be 3.00 mm or more. Failed: ${analysis.failedHoles.map((hole) => hole.holeLabel).join(", ")}.`,
        className: "border-red-700 bg-red-950/50 text-red-100 shadow-red-950/40",
        badge: "ILLEGAL",
      };
    }

    if (analysis.status === "warning") {
      return {
        title: "LEGAL — But Close To Limit",
        text: `All 4 holes pass, but ${analysis.warningHoles.length} hole${analysis.warningHoles.length === 1 ? " is" : "s are"} close to the 3.00 mm limit. Lowest hole max reading: ${formatMm(analysis.lowestMaxHole?.max)}.`,
        className: "border-yellow-700 bg-yellow-950/30 text-yellow-100 shadow-yellow-950/20",
        badge: "WARNING",
      };
    }

    return {
      title: "LEGAL — All Four Holes Pass",
      text: `Every hole has a Max / available point at or above 3.00 mm. Lowest overall reading: ${formatMm(analysis.minimumReading?.value)}.`,
      className: "border-green-800 bg-green-950/30 text-green-100 shadow-green-950/20",
      badge: "LEGAL",
    };
  }

  const warningBar = getWarningBarContent();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading plank legality page...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Technical Check
              </p>

              <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                Plank Legality
              </h1>

              <p className="mt-2 max-w-4xl text-sm text-zinc-400">
                Measure the 4 rule-book holes. Save the sheet and send the generated PDF to the assigned engineer.
                A hole passes if its Max / available point is at least 3.00 mm.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/team-jobs"
                className="rounded-xl border border-red-600 bg-red-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:border-red-400 hover:bg-red-600"
              >
                Team Jobs
              </Link>

              {showChiefDashboardButton && (
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-red-300"
                >
                  Chief Dashboard
                </Link>
              )}
            </div>
          </div>
        </header>

        {message && (
          <div className="mb-6 whitespace-pre-line rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 whitespace-pre-line rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-zinc-800 bg-[#101317] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                Rule Summary
              </p>

              <h2 className="mt-3 text-2xl font-semibold">
                One Point Per Hole Must Be At Least 3.00 mm
              </h2>

              <div className="mt-4 rounded-2xl border border-red-900/40 bg-[#181315] p-4 text-sm leading-6 text-zinc-300">
                <p>
                  <span className="font-semibold text-zinc-100">Rule 6.6:</span> The skid plank fitted under the chassis facing the ground must have a thickness of at least 3.00 mm.
                </p>
                <p className="mt-3">
                  To confirm conformity after use, the thickness must remain above the minimum at <span className="font-semibold text-zinc-100">at least one point around the circumference of each of the four holes</span>.
                </p>
                <p className="mt-3">
                  In practical terms for this page: enter the <span className="font-semibold text-zinc-100">minimum and maximum measured thickness</span> for each hole. If the maximum for any hole is below 3.00 mm, the plank is illegal.
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Holes</p>
                  <p className="mt-2 text-3xl font-bold text-zinc-100">4</p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Inputs</p>
                  <p className="mt-2 text-3xl font-bold text-zinc-100">8</p>
                </div>

                <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-red-300">Minimum Rule</p>
                  <p className="mt-2 text-3xl font-bold text-red-200">3.00 mm</p>
                </div>
              </div>
            </div>

            <div className={`rounded-2xl border p-5 shadow-xl ${warningBar.className}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                    Live Plank Warning
                  </p>
                  <h2 className="mt-3 text-2xl font-bold">{warningBar.title}</h2>
                </div>

                <div className="rounded-full border border-current px-4 py-2 text-xs font-bold uppercase tracking-[0.25em]">
                  {warningBar.badge}
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 opacity-90">{warningBar.text}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-current/20 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] opacity-70">Lowest Reading</p>
                  <p className="mt-1 text-3xl font-black tracking-tight">
                    {formatMm(analysis.minimumReading?.value)}
                  </p>
                </div>

                <div className="rounded-xl border border-current/20 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] opacity-70">Failed Holes</p>
                  <p className="mt-1 text-3xl font-black tracking-tight">
                    {analysis.failedHoles.length}
                  </p>
                  <p className="mt-1 text-xs opacity-70">
                    Near-limit holes: {analysis.warningHoles.length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#101317] p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
              Event Details
            </p>

            <div className="grid gap-4 md:grid-cols-5">
              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Date
                </span>

                <input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Session
                </span>

                <input
                  value={session}
                  onChange={(event) => setSession(event.target.value)}
                  placeholder="e.g. FP1, Qualifying, Race 1"
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Circuit
                </span>

                <select
                  value={circuit}
                  onChange={(event) => {
                    setCircuit(
                      event.target.value as (typeof CIRCUIT_OPTIONS)[number],
                    );
                    setCustomCircuit("");
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  {CIRCUIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Car
                </span>

                <select
                  value={selectedAllocationId}
                  onChange={(event) => {
                    setSelectedAllocationId(event.target.value);
                    setActiveReportId(null);
                    setLastSentToEngineerAt(null);
                    setMeasurements(createEmptyMeasurements());
                    setNotes("");
                    setMessage("");
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  {CAR_ALLOCATIONS.map((allocation) => (
                    <option key={allocation.id} value={allocation.id}>
                      Car {allocation.carId} — {allocation.driverName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-zinc-800 bg-[#0d0f12] px-4 py-3">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Engineer
                </span>
                <p className="truncate text-sm font-semibold text-zinc-100">
                  {selectedEngineer.engineerName}
                </p>
                <p className={`mt-1 truncate text-xs ${selectedCarHasEmail ? "text-zinc-500" : "text-red-300"}`}>
                  {selectedEngineer.engineerEmail || "No engineer email configured"}
                </p>
              </div>
            </div>

            {circuit === "Other" && (
              <div className="mt-4">
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Custom Circuit
                  </span>

                  <input
                    value={customCircuit}
                    onChange={(event) => setCustomCircuit(event.target.value)}
                    placeholder="e.g. Red Bull Ring"
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#101317] p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                  Plank Diagram
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  Min / Max Beside Each Hole
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Enter the minimum and maximum thickness for each hole.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                  Selected Car
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {carDisplayLabel}
                </p>
              </div>
            </div>

            <div className="hidden xl:grid xl:grid-cols-[270px_minmax(360px,0.9fr)_270px] xl:gap-5">
              <div className="grid grid-rows-[190px_230px_190px] gap-5 py-10">
                <div className="self-start">
                  <HoleMeasurementCard
                    hole={analysis.holeAnalyses[0]}
                    measurements={measurements}
                    onChange={updateMeasurement}
                  />
                </div>

                <div />

                <div />
              </div>

              <SimplePlankDiagram />

              <div className="grid grid-rows-[190px_230px_190px] gap-5 py-10">
                <div className="self-start">
                  <HoleMeasurementCard
                    hole={analysis.holeAnalyses[1]}
                    measurements={measurements}
                    onChange={updateMeasurement}
                  />
                </div>

                <div className="self-center">
                  <HoleMeasurementCard
                    hole={analysis.holeAnalyses[2]}
                    measurements={measurements}
                    onChange={updateMeasurement}
                  />
                </div>

                <div className="self-end">
                  <HoleMeasurementCard
                    hole={analysis.holeAnalyses[3]}
                    measurements={measurements}
                    onChange={updateMeasurement}
                  />
                </div>
              </div>
            </div>

            <div className="xl:hidden">
              <div className="mb-5">
                <SimplePlankDiagram />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {analysis.holeAnalyses.map((hole) => (
                  <HoleMeasurementCard
                    key={hole.holeId}
                    hole={hole}
                    measurements={measurements}
                    onChange={updateMeasurement}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#101317] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
              Rule Reference
            </p>
            <h2 className="mt-3 text-2xl font-semibold">Clear Plank Rule</h2>
            <div className="mt-4 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5 text-sm leading-7 text-zinc-300">
              <p>
                <span className="font-semibold text-zinc-100">For each one of the 4 holes:</span> at least one measured point around the circumference must be <span className="font-semibold text-red-300">3.00 mm or more</span>.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-400">
                <li>If the <span className="font-semibold text-zinc-200">maximum</span> measured value around a hole is below 3.00 mm, that hole fails.</li>
                <li>If the <span className="font-semibold text-zinc-200">maximum</span> measured value around a hole is 3.00 mm or more, that hole passes.</li>
                <li>If <span className="font-semibold text-zinc-200">any hole fails</span>, the plank is illegal.</li>
              </ul>
            </div>
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Notes
            </span>

            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional: wear pattern, paint marks, excessive wear area, contact notes, action required..."
              className="min-h-28 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-900/40 bg-[#181315] p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Save & Engineer PDF Preview
              </p>

              <p className="mt-2 text-sm text-zinc-300">
                {formatReportDate(reportDate)} · {finalCircuit || "No circuit"} · {finalSession || "No session"} · Car {activeCarId} · {activeDriverName}
              </p>

              <p className="mt-1 text-sm text-zinc-300">
                Lowest reading: <span className="font-bold text-red-300">{formatMm(analysis.minimumReading?.value)}</span> · Failed holes: <span className="font-bold text-red-300">{analysis.failedHoles.length}</span>
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                Result saved as: {analysis.isComplete ? statusText(analysis.status) : "INCOMPLETE"} · Engineer: {selectedEngineer.engineerName}
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                {lastSentToEngineerAt ? `Last sent: ${formatDateTime(lastSentToEngineerAt)}` : "Not sent to engineer yet"}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={submitPlankLegalityReport}
                disabled={saving || sending || !canSubmitPlankReports}
                className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : activeReportId ? "Update & Send PDF" : "Save & Send PDF"}
              </button>

              <button
                type="button"
                onClick={resendCurrentPlankPdf}
                disabled={saving || sending || !activeReportId || !canSubmitPlankReports}
                className="rounded-xl border border-zinc-700 bg-[#101317] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending..." : "Resend PDF"}
              </button>

              <button
                type="button"
                onClick={resetToNewReport}
                disabled={saving || sending}
                className="rounded-xl border border-zinc-700 bg-[#101317] px-5 py-3 text-sm font-semibold text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                New Check
              </button>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">
                Saved Plank Legality Reports
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Showing saved reports for {carDisplayLabel}.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Report Date</th>
                  <th className="px-4 py-3 text-left">Session</th>
                  <th className="px-4 py-3 text-left">Circuit</th>
                  <th className="px-4 py-3 text-left">Car / Driver</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Lowest</th>
                  <th className="px-4 py-3 text-left">Failed Holes</th>
                  <th className="px-4 py-3 text-left">Near Limit</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                  <th className="px-4 py-3 text-left">Submitted At</th>
                  <th className="px-4 py-3 text-left">Engineer</th>
                  <th className="px-4 py-3 text-left">Sent</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>

              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="px-4 py-6 text-center text-zinc-500"
                    >
                      No plank legality reports saved yet for {carDisplayLabel}.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => {
                    const statusClassName =
                      record.status === "illegal"
                        ? "text-red-300"
                        : record.status === "warning"
                          ? "text-yellow-300"
                          : "text-green-300";

                    return (
                      <tr key={record.id} className="border-t border-zinc-800">
                        <td className="px-4 py-3 text-zinc-300">
                          {formatReportDate(record.report_date)}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.session || "—"}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.circuit || "—"}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.car_name || `Car ${record.car_id}`}
                        </td>

                        <td className={`px-4 py-3 font-bold uppercase ${statusClassName}`}>
                          {record.status || "—"}
                        </td>

                        <td className="px-4 py-3 font-semibold text-red-300">
                          {formatMm(record.minimum_thickness_mm)}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.illegal_count ?? 0}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.near_limit_count ?? 0}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.notes || "—"}
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          {record.created_by || "—"}
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          {formatDateTime(record.created_at)}
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          <div className="max-w-[220px]">
                            <p className="truncate">{record.engineer_name || getEngineerAllocationForCar(record.car_id).engineerName}</p>
                            <p className="truncate text-xs text-zinc-500">
                              {record.engineer_email || getEngineerAllocationForCar(record.car_id).engineerEmail || "No email"}
                            </p>
                          </div>
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          {record.sent_to_engineer_at ? formatDateTime(record.sent_to_engineer_at) : "Not sent"}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openPlankLegalityRecord(record)}
                              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-red-500 hover:text-red-300"
                            >
                              Open
                            </button>

                            <button
                              type="button"
                              onClick={() => resendSavedPlankPdf(record)}
                              disabled={sending || !canSubmitPlankReports}
                              className="rounded-lg border border-green-800/70 px-3 py-2 text-xs font-semibold text-green-300 transition hover:bg-green-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Send PDF
                            </button>

                            {canDeletePlankReports && (
                              <button
                                type="button"
                                onClick={() => deletePlankLegalityRecord(record)}
                                disabled={deletingId === record.id}
                                className="rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {deletingId === record.id ? "Deleting..." : "Delete"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
