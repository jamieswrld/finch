"use client";

import { injected } from "@wagmi/core";
import { http, createConfig } from "wagmi";
import { appChain } from "./chain";

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(),
  },
  ssr: true,
});
