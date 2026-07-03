"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { useState } from "react";

function RainbowKit({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const rk =
    theme === "light"
      ? lightTheme({ accentColor: "#006bb6", borderRadius: "small", overlayBlur: "small" })
      : darkTheme({ accentColor: "#f58426", borderRadius: "small", overlayBlur: "small" });
  return <RainbowKitProvider theme={rk}>{children}</RainbowKitProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <RainbowKit>
            <AuthProvider>{children}</AuthProvider>
          </RainbowKit>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
