"use client";

import React from "react";
import dynamic from "next/dynamic";

const DynamicParkingProvider = dynamic(
  () => import("@/context/ParkingContext").then((mod) => mod.ParkingProvider),
  { ssr: false }
);

export default function ClientParkingProvider({ children }: { children: React.ReactNode }) {
  return <DynamicParkingProvider>{children}</DynamicParkingProvider>;
}
