"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export default function JobListNotificationModal({ carId, enabled }: Props) {
  const [userEmail, setUserEmail] = useState("");
  const [notifications, setNotifications] = useState<JobListNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadingRef = useRef(false);

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
          event: "INSERT",
          schema: "public",
          table: "job_list_notifications",
        },
        (payload) => {
          const newNotice = payload.new as JobListNotification;

          if (Number(newNotice.car_id) === Number(carId)) {
            loadUnacknowledgedNotifications(userEmail);
          }
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
    if (!enabled || !Number.isFinite(carId) || !userEmail) return;

    const interval = window.setInterval(() => {
      loadUnacknowledgedNotifications(userEmail);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [carId, enabled, userEmail, loadUnacknowledgedNotifications]);

  async function acknowledgeNotification() {
    if (!activeNotification || !userEmail) return;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-red-800 bg-neutral-950 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-red-500">
              Job List Update
            </p>

            <h2 className="mt-2 text-2xl font-bold text-white">
              {activeNotification.title}
            </h2>
          </div>

          <div className="rounded-full border border-red-900 bg-red-950 px-3 py-1 text-xs font-semibold text-red-200">
            Car {activeNotification.car_id}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-black p-4">
          <p className="text-sm leading-6 text-neutral-200">
            {activeNotification.message}
          </p>

          {activeNotification.change_summary && (
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <p className="mb-1 text-xs uppercase tracking-[0.2em] text-neutral-500">
                Change Summary
              </p>

              <p className="whitespace-pre-wrap text-sm text-neutral-200">
                {activeNotification.change_summary}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-2 text-xs text-neutral-500">
          <p>
            Created by:{" "}
            <span className="text-neutral-300">
              {activeNotification.created_by || "Unknown"}
            </span>
          </p>

          <p>
            Created at:{" "}
            <span className="text-neutral-300">
              {new Date(activeNotification.created_at).toLocaleString("en-GB")}
            </span>
          </p>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-red-700 bg-red-950/60 p-3 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <button
          type="button"
          onClick={acknowledgeNotification}
          disabled={acknowledging}
          className="mt-6 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {acknowledging ? "Acknowledging..." : "Acknowledge Update"}
        </button>

        {notifications.length > 1 && (
          <p className="mt-3 text-center text-xs text-neutral-500">
            {notifications.length - 1} more update
            {notifications.length - 1 === 1 ? "" : "s"} waiting after this one.
          </p>
        )}
      </div>
    </div>
  );
}