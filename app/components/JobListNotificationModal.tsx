"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type JobListNotification = {
  id: string;
  car_id: number;
  notice_type: string;
  title: string;
  message: string;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
};

type Props = {
  carId: number;
  enabled: boolean;
};

function formatDateTime(value: string) {
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

export default function JobListNotificationModal({ carId, enabled }: Props) {
  const [userEmail, setUserEmail] = useState("");
  const [notifications, setNotifications] = useState<JobListNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const loadingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);

  const activeNotification = notifications[0] ?? null;

  const loadUnacknowledgedNotifications = useCallback(
    async (email: string) => {
      if (!enabled || !Number.isFinite(carId) || !email) return;
      if (loadingRef.current) return;

      loadingRef.current = true;
      setLoading(true);
      setErrorMessage("");

      const { data: allNotifications, error: notificationError } =
        await supabase
          .from("job_list_notifications")
          .select("*")
          .eq("car_id", carId)
          .order("created_at", { ascending: true });

      if (notificationError) {
        setErrorMessage(notificationError.message);
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      const { data: acknowledgements, error: acknowledgementError } =
        await supabase
          .from("job_list_notification_acknowledgements")
          .select("notification_id")
          .eq("acknowledged_by", email);

      if (acknowledgementError) {
        setErrorMessage(acknowledgementError.message);
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      const acknowledgedIds = new Set(
        (acknowledgements ?? []).map((row) => row.notification_id),
      );

      const unacknowledged = (allNotifications ?? []).filter(
        (notice) => !acknowledgedIds.has(notice.id),
      );

      setNotifications(unacknowledged);
      setLoading(false);
      loadingRef.current = false;
    },
    [carId, enabled],
  );

  function getAudioContext() {
    if (typeof window === "undefined") return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    return audioContextRef.current;
  }

  function playRetroArcadeNote(
    audioContext: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    volume = 0.18,
  ) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    oscillator.type = "square";

    oscillator.frequency.setValueAtTime(frequency, startTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, startTime);
    filter.Q.setValueAtTime(1.2, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
    gain.gain.setValueAtTime(volume, startTime + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.03);
  }

  function playRetroArcadeAlert() {
    const audioContext = getAudioContext();

    if (!audioContext || audioContext.state !== "running") {
      setSoundBlocked(true);
      setSoundEnabled(false);
      return;
    }

    const now = audioContext.currentTime;

    /*
      Retro 8-bit arcade alert.
      This is deliberately NOT a Mario melody.
      It uses simple square-wave tones in a short original pattern.
    */

    const notes = [
      { frequency: 784, offset: 0.0, duration: 0.11 }, // G5
      { frequency: 988, offset: 0.13, duration: 0.11 }, // B5
      { frequency: 1175, offset: 0.26, duration: 0.14 }, // D6
      { frequency: 988, offset: 0.45, duration: 0.11 }, // B5
      { frequency: 784, offset: 0.58, duration: 0.11 }, // G5
      { frequency: 659, offset: 0.71, duration: 0.16 }, // E5
      { frequency: 880, offset: 0.96, duration: 0.12 }, // A5
      { frequency: 1175, offset: 1.1, duration: 0.2 }, // D6
    ];

    notes.forEach((note) => {
      playRetroArcadeNote(
        audioContext,
        note.frequency,
        now + note.offset,
        note.duration,
        0.18,
      );
    });
  }

  async function startAlarmSound() {
    try {
      const audioContext = getAudioContext();

      if (!audioContext) {
        setSoundBlocked(true);
        setSoundEnabled(false);
        return;
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      if (audioContext.state !== "running") {
        setSoundBlocked(true);
        setSoundEnabled(false);
        return;
      }

      if (alarmIntervalRef.current) {
        window.clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }

      playRetroArcadeAlert();

      alarmIntervalRef.current = window.setInterval(() => {
        playRetroArcadeAlert();
      }, 2500);

      setSoundBlocked(false);
      setSoundEnabled(true);
    } catch (error) {
      console.error("Alarm sound failed:", error);
      setSoundBlocked(true);
      setSoundEnabled(false);
    }
  }

  function stopAlarmSound() {
    if (alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }

    setSoundEnabled(false);
  }

  useEffect(() => {
    async function init() {
      if (!enabled || !Number.isFinite(carId)) return;

      const { data, error } = await supabase.auth.getUser();

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      const email = data.user?.email?.trim().toLowerCase() ?? "";
      setUserEmail(email);

      if (email) {
        await loadUnacknowledgedNotifications(email);
      }
    }

    init();
  }, [carId, enabled, loadUnacknowledgedNotifications]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(carId) || !userEmail) return;

    const channel = supabase
      .channel(`live-job-list-notifications-car-${carId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_list_notifications",
          filter: `car_id=eq.${carId}`,
        },
        () => {
          loadUnacknowledgedNotifications(userEmail);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_list_notification_acknowledgements",
        },
        () => {
          loadUnacknowledgedNotifications(userEmail);
        },
      )
      .subscribe((status) => {
        console.log("Job list notification realtime status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [carId, enabled, userEmail, loadUnacknowledgedNotifications]);

  useEffect(() => {
    if (!enabled || !activeNotification) {
      stopAlarmSound();
      return;
    }

    startAlarmSound();

    return () => {
      stopAlarmSound();
    };
  }, [enabled, activeNotification?.id]);

  async function acknowledgeNotification() {
    if (!activeNotification || !userEmail) return;

    stopAlarmSound();

    setAcknowledging(true);
    setErrorMessage("");

    const { error } = await supabase
      .from("job_list_notification_acknowledgements")
      .insert({
        notification_id: activeNotification.id,
        acknowledged_by: userEmail,
      });

    if (error) {
      setErrorMessage(error.message);
      setAcknowledging(false);
      return;
    }

    setNotifications((current) =>
      current.filter((notice) => notice.id !== activeNotification.id),
    );

    setAcknowledging(false);
  }

  if (!enabled || loading || !activeNotification) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 px-4 py-6 backdrop-blur-sm alarm-backdrop">
        <div className="flex min-h-dvh items-start justify-center sm:items-center">
          <div className="alarm-panel flex max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border-4 border-red-500 bg-neutral-950 shadow-2xl">
            <div className="shrink-0 border-b border-red-900/70 bg-red-950/70 p-5 text-center">
              <p className="text-xs font-black uppercase tracking-[0.35em] text-red-200">
                Job List Update
              </p>

              <h2 className="mt-3 text-3xl font-black uppercase text-white sm:text-4xl">
                Alarm
              </h2>

              <p className="mt-2 text-sm font-semibold text-red-100">
                New or updated job list instruction for Car{" "}
                {activeNotification.car_id}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-red-500">
                    Notification
                  </p>

                  <h3 className="mt-2 text-2xl font-bold text-white">
                    {activeNotification.title}
                  </h3>
                </div>

                <div className="rounded-full border border-red-800 bg-red-950 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-red-100">
                  Car {activeNotification.car_id}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-black p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">
                  {activeNotification.message}
                </p>

                {activeNotification.change_summary && (
                  <div className="mt-5 rounded-xl border border-yellow-700/60 bg-yellow-950/30 p-4">
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-yellow-300">
                      Change Summary
                    </p>

                    <p className="whitespace-pre-wrap text-sm leading-6 text-yellow-50">
                      {activeNotification.change_summary}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 text-xs text-neutral-400 sm:grid-cols-2">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                  <p className="mb-1 uppercase tracking-[0.2em] text-neutral-500">
                    Created By
                  </p>

                  <p className="font-semibold text-neutral-200">
                    {activeNotification.created_by || "Unknown"}
                  </p>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                  <p className="mb-1 uppercase tracking-[0.2em] text-neutral-500">
                    Created At
                  </p>

                  <p className="font-semibold text-neutral-200">
                    {formatDateTime(activeNotification.created_at)}
                  </p>
                </div>
              </div>

              {notifications.length > 1 && (
                <div className="mt-4 rounded-xl border border-orange-700 bg-orange-950/40 p-4 text-center text-sm font-semibold text-orange-100">
                  {notifications.length - 1} more update
                  {notifications.length - 1 === 1 ? "" : "s"} waiting after
                  this one.
                </div>
              )}

              {errorMessage && (
                <div className="mt-4 rounded-xl border border-red-700 bg-red-950/70 p-4 text-sm text-red-100">
                  {errorMessage}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/70 p-4 text-sm leading-6 text-neutral-300">
                Scroll this message if needed, then press acknowledge below.
                Acknowledging only confirms that you have seen the update. It
                does not mark any jobs as complete.
              </div>
            </div>

            <div className="shrink-0 border-t border-red-900/70 bg-neutral-950 p-4">
              <button
                type="button"
                onClick={startAlarmSound}
                className="mb-3 w-full rounded-2xl border border-yellow-500 bg-yellow-950 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-yellow-100 transition hover:bg-yellow-900"
              >
                {soundEnabled ? "Test Arcade Alert" : "Enable Arcade Alert"}
              </button>

              {soundEnabled && !soundBlocked && (
                <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
                  Arcade alert active
                </p>
              )}

              {soundBlocked && (
                <p className="mb-3 text-center text-xs font-semibold text-yellow-200">
                  Sound was blocked by the browser. Tap Enable Arcade Alert and
                  check the tablet media volume.
                </p>
              )}

              <button
                type="button"
                onClick={acknowledgeNotification}
                disabled={acknowledging}
                className="w-full rounded-2xl bg-red-600 px-6 py-5 text-lg font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/70 transition hover:bg-red-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-700"
              >
                {acknowledging ? "Acknowledging..." : "Acknowledge Update"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes alarmPanelFlash {
          0%,
          100% {
            border-color: rgb(239 68 68);
            box-shadow:
              0 0 0 0 rgba(239, 68, 68, 0.9),
              0 0 45px rgba(239, 68, 68, 0.65);
          }

          50% {
            border-color: rgb(254 202 202);
            box-shadow:
              0 0 0 10px rgba(239, 68, 68, 0.15),
              0 0 90px rgba(239, 68, 68, 0.95);
          }
        }

        @keyframes alarmBackdropFlash {
          0%,
          100% {
            background: rgba(0, 0, 0, 0.85);
          }

          50% {
            background: rgba(127, 29, 29, 0.78);
          }
        }

        .alarm-panel {
          animation: alarmPanelFlash 0.9s infinite;
        }

        .alarm-backdrop {
          animation: alarmBackdropFlash 1.2s infinite;
        }
      `}</style>
    </>
  );
}