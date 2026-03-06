"use client";

import { useMemo, useState } from "react";
import { buildProgressSteps, STATE_VARIANTS } from "@/data/stellaramp";
import type { WalletFlowState } from "@/types/stellaramp";

export interface UseWalletFlowResult {
  readonly state: WalletFlowState;
  readonly setState: (state: WalletFlowState) => void;
  readonly variant: (typeof STATE_VARIANTS)[WalletFlowState];
  readonly steps: ReturnType<typeof buildProgressSteps>;
}

export function useWalletFlow(initialState: WalletFlowState): UseWalletFlowResult {
  const [state, setState] = useState<WalletFlowState>(initialState);
  const variant = STATE_VARIANTS[state];
  const steps = useMemo(() => buildProgressSteps(variant), [variant]);

  return { state, setState, variant, steps };
}
