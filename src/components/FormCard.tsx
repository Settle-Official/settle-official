"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";
import {
  getAllbridgeQuote,
  getAllbridgeTokens,
  initializeAllbridgeSdk,
} from "@/lib/offramp/adapters/allbridge-adapter";

export interface FormCardProps {
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly isExecutingOfframp?: boolean;
  readonly onConnect: () => void;
  readonly onInitiateOfframp?: (tradeData: {
    amount: string;
    rate: number;
    token: string;
    beneficiary: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
      currency: string;
      memo?: string;
    };
  }) => Promise<void> | void;
  readonly onPricingUpdate?: (data: {
    amount: string;
    quote: Quote | null;
    isLoadingQuote: boolean;
    currency: string;
  }) => void;
}

interface Bank {
  code: string;
  name: string;
}

interface Currency {
  code: string;
  name: string;
  symbol: string;
}

interface Quote {
  quoteId: string;
  sourceAmount: string;
  destinationAmount: string;
  rate: number;
  currency: string;
  estimatedTimeMs: number;
}

const PAYCREST_API_BASE = "https://api.paycrest.io/v1";
let allbridgeContextPromise: Promise<{ sdk: any; tokens: any }> | null = null;

async function getAllbridgeContext() {
  if (!allbridgeContextPromise) {
    allbridgeContextPromise = (async () => {
      const sdk = await initializeAllbridgeSdk();
      const tokens = await getAllbridgeTokens(sdk);
      return { sdk, tokens };
    })();
  }
  return allbridgeContextPromise;
}

function isValidQuote(data: unknown): data is Quote {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<Quote>;
  return (
    typeof candidate.quoteId === "string" &&
    typeof candidate.sourceAmount === "string" &&
    typeof candidate.destinationAmount === "string" &&
    typeof candidate.currency === "string" &&
    typeof candidate.rate === "number" &&
    Number.isFinite(candidate.rate) &&
    typeof candidate.estimatedTimeMs === "number" &&
    Number.isFinite(candidate.estimatedTimeMs)
  );
}

function formatEstimatedTime(estimatedTimeMs: number): string {
  if (!Number.isFinite(estimatedTimeMs) || estimatedTimeMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.max(1, Math.round(estimatedTimeMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }
  const totalMinutes = Math.ceil(totalSeconds / 60);
  return `${totalMinutes} min`;
}

export function FormCard({
  isConnected,
  isConnecting,
  isExecutingOfframp = false,
  onConnect,
  onInitiateOfframp,
  onPricingUpdate,
}: Readonly<FormCardProps>) {
  const getCurrencyPrefix = (code?: string) =>
    (code || "NGN").toUpperCase() === "NGN" ? "₦" : (code || "NGN").toUpperCase();

  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bank, setBank] = useState("");
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [isVerifyingAccount, setIsVerifyingAccount] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  // Fetch supported currencies on mount
  useEffect(() => {
    const fetchCurrencies = async () => {
      setIsLoadingCurrencies(true);
      try {
        const response = await fetch(`${PAYCREST_API_BASE}/currencies`, {
          method: "GET",
        });
        if (!response.ok) {
          throw new Error(`Currencies request failed: ${response.status}`);
        }
        const data = await response.json();
        const supportedCurrencies = Array.isArray(data?.data) ? data.data : [];
        setCurrencies(supportedCurrencies);
        if (supportedCurrencies.some((c: Currency) => c.code === "NGN")) {
          setCurrency("NGN");
        } else if (supportedCurrencies[0]?.code) {
          setCurrency(supportedCurrencies[0].code);
        }
      } catch (error) {
        console.error("Failed to fetch currencies:", error);
      } finally {
        setIsLoadingCurrencies(false);
      }
    };

    fetchCurrencies();
  }, []);

  // Fetch banks when currency changes
  useEffect(() => {
    const fetchBanks = async () => {
      if (!currency) {
        setBanks([]);
        return;
      }
      setIsLoadingBanks(true);
      try {
        const response = await fetch(
          `${PAYCREST_API_BASE}/institutions/${encodeURIComponent(currency)}`,
          { method: "GET" }
        );
        if (!response.ok) {
          throw new Error(`Institutions request failed: ${response.status}`);
        }
        const data = await response.json();
        const institutions = Array.isArray(data?.data) ? data.data : [];
        setBanks(institutions);
      } catch (error) {
        console.error("Failed to fetch banks:", error);
        setBanks([]);
      } finally {
        setIsLoadingBanks(false);
      }
    };

    fetchBanks();
  }, [currency]);

  // Verify account when both account number and bank are provided
  useEffect(() => {
    const verifyAccount = async () => {
      if (accountNumber.length === 10 && bank) {
        setIsVerifyingAccount(true);
        try {
          const response = await fetch(`${PAYCREST_API_BASE}/verify-account`, {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              institution: bank, 
              accountIdentifier: accountNumber 
            })
          });
          if (!response.ok) {
            throw new Error(`Verify account failed: ${response.status}`);
          }
          const data = await response.json();
          const resolvedAccountName =
            data?.data?.accountName ||
            data?.data ||
            data?.accountName ||
            "";
          setAccountName(typeof resolvedAccountName === "string" ? resolvedAccountName : "");
        } catch (error) {
          console.error("Failed to verify account:", error);
          setAccountName("");
        } finally {
          setIsVerifyingAccount(false);
        }
      } else {
        setAccountName("");
      }
    };

    verifyAccount();
  }, [accountNumber, bank]);

  // Get quote when amount changes
  useEffect(() => {
    const getQuote = async () => {
      if (amount && parseFloat(amount) >= 0.7) {
        setIsLoadingQuote(true);
        try {
          const { sdk, tokens } = await getAllbridgeContext();
          if (!tokens?.stellar?.usdc || !tokens?.base?.usdc) {
            throw new Error("USDC tokens not found on Allbridge");
          }

          const bridgeQuote = await getAllbridgeQuote(
            sdk,
            tokens.stellar.usdc,
            tokens.base.usdc,
            amount
          );

          const rateResponse = await fetch(
            `${PAYCREST_API_BASE}/rates/USDC/${encodeURIComponent(
              bridgeQuote.receiveAmount
            )}/${encodeURIComponent(currency)}?network=base`,
            { method: "GET" }
          );
          if (!rateResponse.ok) {
            throw new Error(`Rates request failed: ${rateResponse.status}`);
          }
          const ratePayload = await rateResponse.json();
          const rateRaw =
            typeof ratePayload?.data === "string" || typeof ratePayload?.data === "number"
              ? ratePayload.data
              : ratePayload;
          const rate = Number.parseFloat(String(rateRaw));
          const receivedAmount = Number.parseFloat(bridgeQuote.receiveAmount);
          if (!Number.isFinite(rate) || !Number.isFinite(receivedAmount)) {
            throw new Error("Invalid rate or bridge quote payload");
          }

          const destinationAmount = (receivedAmount * rate * 0.99).toFixed(2); // 1% platform fee
          const directQuote: Quote = {
            quoteId: `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            sourceAmount: amount,
            destinationAmount,
            rate,
            currency,
            estimatedTimeMs: bridgeQuote.estimatedTime,
          };

          if (!isValidQuote(directQuote)) {
            setQuote(null);
            return;
          }
          setQuote(directQuote);
        } catch (error) {
          console.error("Failed to get quote:", error);
          setQuote(null);
        } finally {
          setIsLoadingQuote(false);
        }
      } else {
        setQuote(null);
      }
    };

    const debounce = setTimeout(getQuote, 500);
    return () => clearTimeout(debounce);
  }, [amount, currency]);

  useEffect(() => {
    onPricingUpdate?.({ amount, quote, isLoadingQuote, currency });
  }, [amount, quote, isLoadingQuote, currency, onPricingUpdate]);

  const getButtonText = () => {
    if (isExecutingOfframp) return "INITIATING OFFRAMP...";
    if (isConnecting) return "WAITING FOR SIGNATURE...";
    if (isConnected) return "INITIATE OFFRAMP →";
    return "CONNECT WALLET";
  };

  const canInitiateOfframp =
    isConnected &&
    !isConnecting &&
    !isExecutingOfframp &&
    !!quote &&
    Number.parseFloat(amount) >= 0.7 &&
    accountNumber.length === 10 &&
    !!bank &&
    !!accountName;

  const handlePrimaryAction = async () => {
    if (!isConnected) {
      onConnect();
      return;
    }

    if (!canInitiateOfframp || !quote || !onInitiateOfframp) return;

    await onInitiateOfframp({
      amount,
      rate: quote.rate,
      token: "USDC",
      beneficiary: {
        institution: bank,
        accountIdentifier: accountNumber,
        accountName,
        currency,
        memo: "Stellaramp offramp",
      },
    });
  };

  return (
    <section className="flex flex-col gap-[1.1rem] border border-[var(--line)] bg-[#0a0a0a] p-[1.2rem]">
      <div>
        <h2 className="m-0 font-space-grotesk font-bold text-[1.50rem]">
          {isConnected ? "READY TO OFFRAMP" : isConnecting ? "CONNECTING WALLET" : "CONNECT WALLET"}
        </h2>
        <p className="mt-[0.3rem] mb-0 text-[0.75rem] text-[var(--muted)]">
          {isConnected 
            ? "Connected wallet detected. Confirm amount and settlement bank details."
            : isConnecting
            ? "Waiting for wallet signature before opening the off-ramp form."
            : "Securely connect a Stellar-compatible wallet before entering payout details."}
        </p>
      </div>

      <div className="flex flex-col gap-[0.6rem]">
        <InputField 
          label="AMOUNT IN USDC" 
          value={amount}
          onChange={setAmount}
          type="number"
          min={0.7}
          step="0.000001"
          placeholder="0.00"
          suffix={
            isLoadingQuote
              ? "..."
              : quote
                ? `≈ ${getCurrencyPrefix(quote.currency)} ${quote.destinationAmount}`
                : "Min 0.7 USDC"
          }
        />
        <div className="grid grid-cols-2 gap-[0.6rem] max-[720px]:grid-cols-1">
          <SelectField
            label="OFFRAMP CURRENCY"
            value={currency}
            onChange={(value) => {
              setCurrency(value);
              setBank("");
              setAccountName("");
            }}
            options={currencies.map((c) => ({ code: c.code, name: `${c.name} (${c.symbol})` }))}
            isLoading={isLoadingCurrencies}
          />
          <InputField 
            label="ACCOUNT NUMBER" 
            value={accountNumber}
            onChange={setAccountNumber}
            placeholder="0000000000"
            maxLength={10}
          />
          <SelectField
            label="BANK"
            value={bank}
            onChange={setBank}
            options={banks}
            isLoading={isLoadingBanks}
          />
        </div>
        <Field
          label="ACCOUNT NAME"
          value={isVerifyingAccount ? "Verifying..." : accountName || "—"}
          tone={accountName ? "accent" : "muted"}
        />
        {quote && (
          <div className="mt-2 p-3 bg-[#1a1a1a] border border-[var(--line)] rounded">
            <div className="text-[0.75rem] text-[var(--muted)] mb-1">ESTIMATED PAYOUT</div>
            <div className="text-[1.5rem] font-bold text-[var(--accent)]">
              {getCurrencyPrefix(quote.currency)}{quote.destinationAmount}
            </div>
            <div className="text-[0.7rem] text-[var(--muted)] mt-1">
              Est. time: {formatEstimatedTime(quote.estimatedTimeMs)}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handlePrimaryAction}
        disabled={!isConnected ? isConnecting || isExecutingOfframp : !canInitiateOfframp}
        className={cn(
          "h-12 font-bold uppercase tracking-[0.08em] transition-colors",
          !isConnected && !isConnecting && "bg-[var(--accent)] text-[#0a0a0a] hover:brightness-110",
          (isConnecting || isExecutingOfframp) && "bg-[#2f2f2f] text-[var(--muted)] cursor-not-allowed",
          isConnected && "bg-[#efefef] text-[#0a0a0a] hover:brightness-95",
        )}
      >
        {getButtonText()}
      </button>
    </section>
  );
}

interface InputFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
  readonly suffix?: string;
  readonly disabled?: boolean;
  readonly maxLength?: number;
  readonly min?: number;
  readonly step?: string;
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  suffix,
  disabled,
  maxLength,
  min,
  step,
}: Readonly<InputFieldProps>) {
  return (
    <div className="flex flex-col gap-[0.4rem]">
      <label className="text-[0.69rem] tracking-[0.08em] text-[var(--muted)]">
        {label}
      </label>
      <div className="flex h-[46px] items-center justify-between gap-3 border border-[var(--line)] px-[0.8rem]">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          min={min}
          step={step}
          className={cn(
            "flex-1 bg-transparent text-[0.95rem] outline-none",
            disabled && "cursor-not-allowed opacity-50",
            "placeholder:text-[var(--muted)]"
          )}
        />
        {suffix ? (
          <span className="text-[0.62rem] text-[var(--accent)]">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: Bank[];
  readonly isLoading?: boolean;
}

function SelectField({ label, value, onChange, options, isLoading }: Readonly<SelectFieldProps>) {
  return (
    <div className="flex flex-col gap-[0.4rem]">
      <label className="text-[0.69rem] tracking-[0.08em] text-[var(--muted)]">
        {label}
      </label>
      <div className="relative h-[46px] border border-[var(--line)]">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
          className={cn(
            "h-full w-full appearance-none bg-transparent px-[0.8rem] text-[0.95rem] outline-none",
            isLoading && "cursor-not-allowed opacity-50",
            !value && "text-[var(--muted)]"
          )}
        >
          <option value="" disabled>
            {isLoading ? "Loading banks..." : "Select bank"}
          </option>
          {options.map((bank) => (
            <option key={bank.code} value={bank.code} className="bg-[#0a0a0a] text-white">
              {bank.name}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute right-[0.8rem] top-1/2 -translate-y-1/2">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L6 6L11 1" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
  readonly tone?: "muted" | "accent";
}

function Field({ label, value, suffix, tone = "muted" }: Readonly<FieldProps>) {
  return (
    <div className="flex flex-col gap-[0.4rem]">
      <label className="text-[0.69rem] tracking-[0.08em] text-[var(--muted)]">
        {label}
      </label>
      <div className="flex h-[46px] items-center justify-between gap-3 border border-[var(--line)] px-[0.8rem]">
        <span
          className={cn(
            "text-[0.95rem]",
            tone === "accent" && "text-[var(--accent)]",
          )}
        >
          {value}
        </span>
        {suffix ? (
          <span className="text-[0.62rem] text-[var(--accent)]">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}
