"use client";

import { useEffect, useState } from "react";
import { TZ_LABELS } from "./constants";

function formatTimeInTz(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeStyle: "medium", hour12: true }).format(date);
}

function formatLocalTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "medium", hour12: true }).format(date);
}

export function TimeZoneClocks({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = TZ_LABELS[timezone] ?? timezone;
  return (
    <div className="text-sm text-muted-foreground space-y-0.5 pt-1">
      <p>
        <span className="font-medium text-foreground">{label}:</span> {formatTimeInTz(now, timezone)}
      </p>
      <p>
        <span className="font-medium text-foreground">Your local time:</span> {formatLocalTime(now)}
      </p>
    </div>
  );
}
