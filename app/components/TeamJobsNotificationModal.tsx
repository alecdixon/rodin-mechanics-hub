"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type TeamJobNotification = {
  id: string;
  title: string;
  message: string;
  created_by: string | null;
  created_at: string;
};

type Props = {
  enabled: boolean;
};

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB");
}

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      220,
      context.currentTime + 0.8,
    );

    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.9);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + 0.9);
  } catch {
    // Some browsers block sound until the user has interacted with the page.
  }
}

export default function TeamJobsNotificationModal({ enabled }: Props) {
  const [notification, setNotification] =
    useState<TeamJobNotification | null>(null);

  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    async function loadLatestUnseenNotification() {
      const lastSeen = window.localStorage.getItem(
        "team_jobs_last_seen_notification",
      );

      const { data, error } = await supabase
        .from("team_job_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data || !mountedRef.current) return;

      const latest = data as TeamJobNotification;

      if (latest.id !== lastSeen) {
        setNotification(latest);
        playNotificationSound();
      }
    }

    loadLatestUnseenNotification();

    const channel = supabase
      .channel("team-job-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_job_notifications",
        },
        (payload) => {
          const nextNotification = payload.new as TeamJobNotification;
          setNotification(nextNotification);
          playNotificationSound();
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  function dismissNotification() {
    if (notification) {
      window.localStorage.setItem(
        "team_jobs_last_seen_notification",
        notification.id,
      );
    }

    setNotification(null);
  }

  if (!enabled || !notification) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-red-700 bg-neutral-950 p-6 shadow-2xl shadow-red-950/40">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
          Team Job Alert
        </p>

        <h2 className="mt-3 text-2xl font-bold text-white">
          {notification.title}
        </h2>

        <p className="mt-4 text-sm leading-6 text-neutral-300">
          {notification.message}
        </p>

        <div className="mt-5 rounded-xl border border-neutral-800 bg-black p-4 text-xs text-neutral-400">
          <p>
            Published:{" "}
            <span className="text-neutral-200">
              {formatDateTime(notification.created_at)}
            </span>
          </p>

          {notification.created_by && (
            <p className="mt-1">
              By:{" "}
              <span className="text-neutral-200">
                {notification.created_by}
              </span>
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/team-jobs"
            onClick={dismissNotification}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-red-500"
          >
            Open Team Jobs
          </Link>

          <button
            type="button"
            onClick={dismissNotification}
            className="flex-1 rounded-xl border border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-200 hover:border-red-500"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}