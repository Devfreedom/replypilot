"use client";

import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type BusinessProfile,
  type CatalogueEntry,
  type KnowledgeEntry,
  MAX_SAFE_PRICE_MINOR,
  parseCatalogueEntryResponse,
  parseCatalogueResponse,
  parseKnowledgeEntryResponse,
  parseKnowledgeResponse,
  parseProfileResponse,
} from "@/lib/business";
import {
  CURRENCY_OPTIONS,
  defaultCatalogueCurrency,
  isSupportedCurrencyCode,
} from "@/lib/currencies";
import {
  type OpeningHoursEntry,
  type ScheduleErrors,
  type WeeklySchedule,
  WEEKDAY_LABELS,
  createEmptyWeeklySchedule,
  hasScheduleErrors,
  openingHoursFromSchedule,
  scheduleFromOpeningHours,
  validateWeeklySchedule,
} from "@/lib/opening-hours";
import {
  restorePhoneState,
  validatePhoneInput,
} from "@/lib/phone";
import {
  buildTimezoneOptions,
  isValidTimezone,
} from "@/lib/timezones";
import { useAuth } from "./auth-provider";
import { OpeningHoursEditor } from "./opening-hours-editor";
import { PhoneNumberField } from "./phone-number-field";
import { SearchableCombobox } from "./searchable-combobox";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const labelClass = "block text-sm font-medium text-slate-700";
const secondaryButtonClass =
  "rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const primaryButtonClass =
  "rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiError(data: unknown, fallback: string): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error;
  }

  return fallback;
}

function fieldError(data: unknown, fallback: string): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "details" in data &&
    Array.isArray(data.details)
  ) {
    const first = data.details[0];

    if (
      typeof first === "object" &&
      first !== null &&
      "message" in first &&
      typeof first.message === "string"
    ) {
      return first.message;
    }
  }

  return apiError(data, fallback);
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function hasKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

export function BusinessSettings() {
  const { workspace, role } = useAuth();
  const canManage = role === "owner";
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingCatalogue, setEditingCatalogue] =
    useState<CatalogueEntry | null>(null);
  const [editingKnowledge, setEditingKnowledge] =
    useState<KnowledgeEntry | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [schedule, setSchedule] = useState<WeeklySchedule>(() =>
    createEmptyWeeklySchedule(),
  );
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({});
  const [scheduleIssues, setScheduleIssues] = useState<string[]>([]);
  const [legacyOpeningHours, setLegacyOpeningHours] = useState<
    OpeningHoursEntry[] | null
  >(null);
  const [scheduleValidationAttempted, setScheduleValidationAttempted] =
    useState(false);
  const [phoneCountry, setPhoneCountry] = useState("");
  const [phoneNational, setPhoneNational] = useState("");
  const [phoneWarning, setPhoneWarning] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("");
  const [businessCurrency, setBusinessCurrency] = useState("");
  const [profileValidationAttempted, setProfileValidationAttempted] =
    useState(false);

  const timezoneOptions = useMemo(
    () => buildTimezoneOptions(timezone),
    [timezone],
  );
  const phoneValidation = validatePhoneInput(phoneCountry, phoneNational);
  const timezoneValidationError = timezone
    ? isValidTimezone(timezone)
      ? undefined
      : "Choose a valid IANA timezone."
    : "Choose the timezone that matches the business.";
  const currencyValidationError =
    businessCurrency && !isSupportedCurrencyCode(businessCurrency)
      ? "Choose a valid ISO 4217 currency."
      : undefined;
  const profileErrors = profileValidationAttempted
    ? {
        phoneCountry: phoneValidation.errors.country,
        phoneNumber: phoneValidation.errors.number,
        timezone: timezoneValidationError,
        currency: currencyValidationError,
      }
    : {};

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [profileResponse, catalogueResponse, knowledgeResponse] =
          await Promise.all([
            fetch("/api/business/profile"),
            fetch("/api/business/catalogue"),
            fetch("/api/business/knowledge"),
          ]);
        const [profileData, catalogueData, knowledgeData] = await Promise.all([
          readJson(profileResponse),
          readJson(catalogueResponse),
          readJson(knowledgeResponse),
        ]);

        if (
          !profileResponse.ok ||
          !catalogueResponse.ok ||
          !knowledgeResponse.ok
        ) {
          throw new Error(
            apiError(profileData, "Unable to load business settings."),
          );
        }

        if (!active) return;

        const nextProfile = parseProfileResponse(profileData);
        const nextCatalogue = parseCatalogueResponse(catalogueData);
        const nextKnowledge = parseKnowledgeResponse(knowledgeData);

        if (
          nextCatalogue === null ||
          nextKnowledge === null ||
          (nextProfile === null && !hasKey(profileData, "profile"))
        ) {
          throw new Error(
            "The settings service returned an unexpected response.",
          );
        }

        const loadedSchedule = scheduleFromOpeningHours(
          nextProfile?.openingHours ?? [],
        );
        const restoredPhone = restorePhoneState(
          nextProfile?.contactPhone ?? null,
          nextProfile?.contactPhoneCountry ?? null,
        );

        setProfile(nextProfile);
        setCatalogue(nextCatalogue);
        setKnowledge(nextKnowledge);
        setShowProfileForm(nextProfile !== null);
        setSchedule(loadedSchedule.schedule);
        setScheduleIssues(loadedSchedule.issues);
        setLegacyOpeningHours(
          loadedSchedule.hasUneditableEntries
            ? (nextProfile?.openingHours ?? [])
            : null,
        );
        setScheduleErrors({});
        setScheduleValidationAttempted(false);
        setPhoneCountry(restoredPhone.countryCode);
        setPhoneNational(restoredPhone.nationalNumber);
        setPhoneWarning(restoredPhone.warning);
        setTimezone(nextProfile?.timezone ?? "");
        setBusinessCurrency(nextProfile?.currencyCode ?? "");
        setProfileValidationAttempted(false);
      } catch (cause) {
        if (!active) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load business settings.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  function retryLoad() {
    setLoading(true);
    setError(null);
    setReloadToken((token) => token + 1);
  }

  function updateSchedule(nextSchedule: WeeklySchedule) {
    setSchedule(nextSchedule);
    setScheduleIssues([]);

    if (scheduleValidationAttempted) {
      setScheduleErrors(validateWeeklySchedule(nextSchedule));
    }
  }

  function replaceLegacySchedule() {
    setLegacyOpeningHours(null);
    setScheduleIssues([]);
    setScheduleErrors({});
    setScheduleValidationAttempted(false);
    setError(null);
    setNotice(
      "You can now edit the weekly schedule. Save the profile to replace the unsupported saved hours.",
    );
  }

  function cancelProfileSetup() {
    setShowProfileForm(false);
    setSchedule(createEmptyWeeklySchedule());
    setScheduleErrors({});
    setScheduleIssues([]);
    setLegacyOpeningHours(null);
    setScheduleValidationAttempted(false);
    setPhoneCountry("");
    setPhoneNational("");
    setPhoneWarning(null);
    setTimezone("");
    setBusinessCurrency("");
    setProfileValidationAttempted(false);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let openingHours: OpeningHoursEntry[];

    if (legacyOpeningHours) {
      openingHours = legacyOpeningHours;
    } else {
      const nextErrors = validateWeeklySchedule(schedule);
      setScheduleErrors(nextErrors);
      setScheduleValidationAttempted(true);

      if (hasScheduleErrors(nextErrors)) {
        setBusy(false);
        requestAnimationFrame(() => {
          formElement
            .querySelector<HTMLInputElement>(
              'input[type="time"][aria-invalid="true"]',
            )
            ?.focus();
        });
        return;
      }

      openingHours = openingHoursFromSchedule(schedule);
    }

    const nextPhoneValidation = validatePhoneInput(
      phoneCountry,
      phoneNational,
    );
    const nextTimezoneError = timezone
      ? isValidTimezone(timezone)
        ? null
        : "Choose a valid IANA timezone."
      : "Choose the timezone that matches the business.";
    const nextCurrencyError =
      businessCurrency && !isSupportedCurrencyCode(businessCurrency)
        ? "Choose a valid ISO 4217 currency."
        : null;
    const nextProfileErrors = {
      phoneCountry: nextPhoneValidation.errors.country,
      phoneNumber: nextPhoneValidation.errors.number,
      timezone: nextTimezoneError,
      currency: nextCurrencyError,
    };

    setProfileValidationAttempted(true);

    if (Object.values(nextProfileErrors).some(Boolean)) {
      setBusy(false);
      requestAnimationFrame(() => {
        formElement
          .querySelector<HTMLElement>(
            '[data-invalid="true"], [aria-invalid="true"]',
          )
          ?.focus();
      });
      return;
    }

    const payload = {
      businessName: String(form.get("businessName") ?? ""),
      businessDescription: String(form.get("businessDescription") ?? ""),
      contactEmail: emptyToNull(form.get("contactEmail")),
      contactPhone: nextPhoneValidation.phone,
      contactPhoneCountry: nextPhoneValidation.countryCode,
      businessAddress: emptyToNull(form.get("businessAddress")),
      timezone,
      openingHours,
      currencyCode: businessCurrency || null,
    };

    try {
      const response = await fetch("/api/business/profile", {
        method: profile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          fieldError(data, "Unable to save business profile."),
        );
      }

      const saved = parseProfileResponse(data);

      if (!saved) {
        throw new Error(
          "The settings service returned an unexpected response.",
        );
      }

      const loadedSchedule = scheduleFromOpeningHours(saved.openingHours);
      const restoredPhone = restorePhoneState(
        saved.contactPhone,
        saved.contactPhoneCountry,
      );

      setProfile(saved);
      setShowProfileForm(true);
      setSchedule(loadedSchedule.schedule);
      setScheduleIssues(loadedSchedule.issues);
      setLegacyOpeningHours(
        loadedSchedule.hasUneditableEntries ? saved.openingHours : null,
      );
      setScheduleErrors({});
      setScheduleValidationAttempted(false);
      setPhoneCountry(restoredPhone.countryCode);
      setPhoneNational(restoredPhone.nationalNumber);
      setPhoneWarning(restoredPhone.warning);
      setTimezone(saved.timezone);
      setBusinessCurrency(saved.currencyCode ?? "");
      setProfileValidationAttempted(false);
      setNotice("Business profile saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save business profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveCatalogue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawPrice = String(form.get("priceMinor") ?? "").trim();
    let priceMinor: number | null = null;

    if (rawPrice) {
      const parsedPrice = Number(rawPrice);

      if (
        !Number.isSafeInteger(parsedPrice) ||
        parsedPrice < 0 ||
        parsedPrice > MAX_SAFE_PRICE_MINOR
      ) {
        setError(
          "Price must be a non-negative whole number of minor units within the safe integer range.",
        );
        setBusy(false);
        return;
      }

      priceMinor = parsedPrice;
    }

    const payload = {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      priceMinor,
      currencyCode: String(form.get("currencyCode") ?? ""),
      availabilityNotes: emptyToNull(form.get("availabilityNotes")),
      isActive: form.get("isActive") === "on",
    };
    const path = editingCatalogue
      ? `/api/business/catalogue/${editingCatalogue.id}`
      : "/api/business/catalogue";

    try {
      const response = await fetch(path, {
        method: editingCatalogue ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(fieldError(data, "Unable to save service."));
      }

      const saved = parseCatalogueEntryResponse(data);

      if (!saved) {
        throw new Error(
          "The settings service returned an unexpected response.",
        );
      }

      setCatalogue((current) =>
        editingCatalogue
          ? current.map((entry) => (entry.id === saved.id ? saved : entry))
          : [saved, ...current],
      );
      setEditingCatalogue(null);
      formElement.reset();
      setNotice("Service saved.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save service.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      title: String(form.get("title") ?? ""),
      answer: String(form.get("answer") ?? ""),
      entryType: String(form.get("entryType") ?? "faq"),
      isActive: form.get("isActive") === "on",
    };
    const path = editingKnowledge
      ? `/api/business/knowledge/${editingKnowledge.id}`
      : "/api/business/knowledge";

    try {
      const response = await fetch(path, {
        method: editingKnowledge ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(fieldError(data, "Unable to save knowledge entry."));
      }

      const saved = parseKnowledgeEntryResponse(data);

      if (!saved) {
        throw new Error(
          "The settings service returned an unexpected response.",
        );
      }

      setKnowledge((current) =>
        editingKnowledge
          ? current.map((entry) => (entry.id === saved.id ? saved : entry))
          : [saved, ...current],
      );
      setEditingKnowledge(null);
      formElement.reset();
      setNotice("Knowledge entry saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save knowledge entry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(
    kind: "catalogue" | "knowledge",
    id: string,
  ) {
    if (
      !window.confirm(
        "Deactivate this entry? It will no longer be used for future reply context.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/business/${kind}/${id}`, {
        method: "DELETE",
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(apiError(data, "Unable to deactivate entry."));
      }

      if (kind === "catalogue") {
        const entry = parseCatalogueEntryResponse(data);

        if (entry) {
          setCatalogue((current) =>
            current.map((item) => (item.id === id ? entry : item)),
          );
        }
      } else {
        const entry = parseKnowledgeEntryResponse(data);

        if (entry) {
          setKnowledge((current) =>
            current.map((item) => (item.id === id ? entry : item)),
          );
        }
      }

      setNotice("Entry deactivated.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to deactivate entry.",
      );
    } finally {
      setBusy(false);
    }
  }

  const showSetupState = profile === null && !showProfileForm;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <p className="truncate text-xs text-slate-500">
              <span className="font-medium text-slate-600">
                {workspace?.name ?? "Workspace"}
              </span>{" "}
              /{" "}
              <span className="font-semibold text-slate-700">
                Business settings
              </span>
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-950">
              Business settings
            </h1>
          </div>
          <Link href="/" className={secondaryButtonClass}>
            Back to leads
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <p className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Signed in to <strong>{workspace?.name ?? "this workspace"}</strong>.
          Business details and reply context are scoped to this workspace.
        </p>

        {!canManage ? (
          <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You are a workspace member. Settings are read-only for your role;
            only the workspace owner can make changes.
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            {notice}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}{" "}
            <button
              type="button"
              onClick={retryLoad}
              className="ml-2 font-semibold underline"
            >
              Try again
            </button>
          </div>
        ) : null}

        {loading ? (
          <p
            role="status"
            className="py-16 text-center text-sm text-slate-500"
          >
            Loading business settings…
          </p>
        ) : (
          <fieldset
            disabled={!canManage}
            className="m-0 min-w-0 space-y-8 border-0 p-0"
          >
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">
                Business profile
              </h2>

              {showSetupState ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
                  <h3 className="text-base font-semibold text-slate-900">
                    Your business profile is not set up yet
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    Add your approved business details so future reply drafts
                    can use real information instead of guessing. Nothing has
                    been saved for your business yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowProfileForm(true)}
                    className={`mt-4 ${primaryButtonClass}`}
                  >
                    Set up business profile
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-500">
                    Add only facts you approve for future reply context.
                  </p>
                  <form
                    className="mt-5 grid gap-4 sm:grid-cols-2"
                    onSubmit={(event) => void saveProfile(event)}
                  >
                    <label className={labelClass}>
                      Business name
                      <input
                        required
                        name="businessName"
                        defaultValue={profile?.businessName ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <SearchableCombobox
                      id="profile-timezone"
                      label="Timezone"
                      value={timezone}
                      options={timezoneOptions}
                      onChange={setTimezone}
                      placeholder="Select a timezone"
                      helpText="Search by region or city. The business owner must choose the timezone; it is not guessed from this device."
                      error={profileErrors.timezone}
                      disabled={busy}
                    />
                    <label className={`${labelClass} sm:col-span-2`}>
                      Business description
                      <textarea
                        name="businessDescription"
                        defaultValue={profile?.businessDescription ?? ""}
                        rows={3}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      Contact email
                      <input
                        type="email"
                        name="contactEmail"
                        defaultValue={profile?.contactEmail ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <SearchableCombobox
                      id="profile-currency"
                      label="Business currency"
                      value={businessCurrency}
                      options={CURRENCY_OPTIONS}
                      onChange={setBusinessCurrency}
                      placeholder="Not configured"
                      helpText={
                        businessCurrency
                          ? "Used as the default for new services. Existing service currencies and prices are not changed."
                          : "No business currency is saved yet. Choose one to set the default for new services."
                      }
                      error={profileErrors.currency}
                      disabled={busy}
                      allowClear
                    />
                    <PhoneNumberField
                      countryCode={phoneCountry}
                      nationalNumber={phoneNational}
                      countryError={profileErrors.phoneCountry}
                      numberError={profileErrors.phoneNumber}
                      warning={phoneWarning}
                      disabled={busy}
                      onCountryChange={(value) => {
                        setPhoneCountry(value);
                        setPhoneWarning(null);
                      }}
                      onNationalNumberChange={(value) => {
                        setPhoneNational(value);
                        setPhoneWarning(null);
                      }}
                    />
                    <label className={`${labelClass} sm:col-span-2`}>
                      Business address
                      <input
                        name="businessAddress"
                        defaultValue={profile?.businessAddress ?? ""}
                        className={inputClass}
                      />
                    </label>
                    {legacyOpeningHours !== null ? (
                      <div className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:col-span-2 sm:p-5">
                        <h3 className="text-sm font-semibold text-amber-950">
                          Opening hours
                        </h3>
                        <div
                          role="alert"
                          className="mt-2 text-sm leading-6 text-amber-900"
                        >
                          <p>
                            This saved schedule cannot be shown safely in the
                            weekly editor, so it has been preserved unchanged.
                            It will be sent back as-is if you save the profile.
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {scheduleIssues.map((issue, index) => (
                              <li key={`${issue}-${index}`}>{issue}</li>
                            ))}
                          </ul>
                        </div>

                        <p className="mt-4 text-sm font-medium text-amber-950">
                          Saved entries
                        </p>
                        <ul className="mt-1 space-y-1 text-sm text-amber-900">
                          {legacyOpeningHours.map((entry, index) => (
                            <li key={`${entry.day}-${index}`}>
                              {WEEKDAY_LABELS[entry.day] ?? entry.day}:{" "}
                              {entry.opensAt}–{entry.closesAt}
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          onClick={replaceLegacySchedule}
                          className={`mt-4 ${secondaryButtonClass}`}
                        >
                          Replace with weekly schedule
                        </button>
                        <p className="mt-2 text-xs text-amber-800">
                          The editor starts with the first saved interval for
                          each day. Nothing is replaced until you save the
                          profile.
                        </p>
                      </div>
                    ) : (
                      <>
                        {scheduleIssues.length > 0 ? (
                          <div
                            role="status"
                            className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:col-span-2"
                          >
                            <p className="font-medium">
                              Some saved opening hours need review:
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5">
                              {scheduleIssues.map((issue, index) => (
                                <li key={`${issue}-${index}`}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <OpeningHoursEditor
                          schedule={schedule}
                          errors={scheduleErrors}
                          disabled={busy}
                          onChange={updateSchedule}
                        />
                      </>
                    )}
                    <div className="flex gap-3 sm:col-span-2">
                      <button
                        disabled={busy}
                        className={primaryButtonClass}
                      >
                        {profile ? "Save profile" : "Create profile"}
                      </button>
                      {!profile ? (
                        <button
                          type="button"
                          onClick={cancelProfileSetup}
                          className={secondaryButtonClass}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </form>
                </>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">
                Products &amp; services
              </h2>
              <form
                className="mt-5 grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => void saveCatalogue(event)}
              >
                <label className={labelClass}>
                  Name
                  <input
                    required
                    name="name"
                    key={`name-${editingCatalogue?.id ?? "new"}`}
                    defaultValue={editingCatalogue?.name ?? ""}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Currency code
                  <input
                    required
                    name="currencyCode"
                    key={`currency-${
                      editingCatalogue?.id ??
                      `new-${profile?.currencyCode ?? "unconfigured"}`
                    }`}
                    defaultValue={
                      editingCatalogue?.currencyCode ??
                      defaultCatalogueCurrency(profile?.currencyCode)
                    }
                    maxLength={3}
                    pattern="[A-Z]{3}"
                    title="A three-letter uppercase ISO 4217 currency code, for example NGN or USD"
                    className={inputClass}
                    aria-describedby="currency-help"
                  />
                </label>
                <p
                  id="currency-help"
                  className="-mt-2 text-xs text-slate-500 sm:col-span-2"
                >
                  Use a current ISO 4217 code in uppercase, for example NGN or
                  USD. New services default to the business currency (
                  {defaultCatalogueCurrency(profile?.currencyCode)}
                  ); existing services keep their own currency and prices.
                </p>
                <label className={labelClass}>
                  Price (minor units)
                  <input
                    name="priceMinor"
                    key={`price-${editingCatalogue?.id ?? "new"}`}
                    defaultValue={editingCatalogue?.priceMinor ?? ""}
                    type="number"
                    min="0"
                    max={MAX_SAFE_PRICE_MINOR}
                    step="1"
                    className={inputClass}
                    aria-describedby="price-help"
                  />
                </label>
                <label className={labelClass}>
                  Availability notes
                  <input
                    name="availabilityNotes"
                    key={`availability-${editingCatalogue?.id ?? "new"}`}
                    defaultValue={editingCatalogue?.availabilityNotes ?? ""}
                    className={inputClass}
                  />
                </label>
                <p
                  id="price-help"
                  className="-mt-2 text-xs text-slate-500 sm:col-span-2"
                >
                  Optional whole minor units only (for example 150000). Leave
                  blank when pricing is not fixed.
                </p>
                <label className={`${labelClass} sm:col-span-2`}>
                  Description
                  <textarea
                    name="description"
                    key={`description-${editingCatalogue?.id ?? "new"}`}
                    defaultValue={editingCatalogue?.description ?? ""}
                    rows={3}
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    name="isActive"
                    key={`active-${editingCatalogue?.id ?? "new"}`}
                    type="checkbox"
                    defaultChecked={editingCatalogue?.isActive ?? true}
                  />
                  Active and approved for future context
                </label>
                <div className="flex gap-3 sm:col-span-2">
                  <button disabled={busy} className={primaryButtonClass}>
                    {editingCatalogue ? "Save service" : "Add service"}
                  </button>
                  {editingCatalogue ? (
                    <button
                      type="button"
                      onClick={() => setEditingCatalogue(null)}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>

              <EntryList
                entries={catalogue}
                empty="No services added yet."
                render={(entry) => (
                  <>
                    <p className="font-semibold text-slate-800">
                      {entry.name}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {entry.priceMinor === null
                        ? "Price on request"
                        : `${entry.currencyCode} ${entry.priceMinor} minor units`}{" "}
                      · {entry.isActive ? "Active" : "Inactive"}
                    </p>
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingCatalogue(entry)}
                        className="text-sm font-semibold text-blue-700"
                      >
                        Edit
                      </button>
                      {entry.isActive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void deactivate("catalogue", entry.id)}
                          className="text-sm font-semibold text-red-700 disabled:opacity-60"
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">
                FAQs &amp; policies
              </h2>
              <form
                className="mt-5 grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => void saveKnowledge(event)}
              >
                <label className={labelClass}>
                  Title or question
                  <input
                    required
                    name="title"
                    key={`title-${editingKnowledge?.id ?? "new"}`}
                    defaultValue={editingKnowledge?.title ?? ""}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Entry type
                  <select
                    name="entryType"
                    key={`type-${editingKnowledge?.id ?? "new"}`}
                    defaultValue={editingKnowledge?.entryType ?? "faq"}
                    className={inputClass}
                  >
                    <option value="faq">FAQ</option>
                    <option value="policy">Policy</option>
                  </select>
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Approved answer or policy
                  <textarea
                    required
                    name="answer"
                    key={`answer-${editingKnowledge?.id ?? "new"}`}
                    defaultValue={editingKnowledge?.answer ?? ""}
                    rows={4}
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    name="isActive"
                    key={`knowledge-active-${editingKnowledge?.id ?? "new"}`}
                    type="checkbox"
                    defaultChecked={editingKnowledge?.isActive ?? true}
                  />
                  Active and approved for future context
                </label>
                <div className="flex gap-3 sm:col-span-2">
                  <button disabled={busy} className={primaryButtonClass}>
                    {editingKnowledge ? "Save entry" : "Add entry"}
                  </button>
                  {editingKnowledge ? (
                    <button
                      type="button"
                      onClick={() => setEditingKnowledge(null)}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>

              <EntryList
                entries={knowledge}
                empty="No FAQs or policies added yet."
                render={(entry) => (
                  <>
                    <p className="font-semibold text-slate-800">{entry.title}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {entry.entryType === "faq" ? "FAQ" : "Policy"} ·{" "}
                      {entry.isActive ? "Active" : "Inactive"}
                    </p>
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingKnowledge(entry)}
                        className="text-sm font-semibold text-blue-700"
                      >
                        Edit
                      </button>
                      {entry.isActive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void deactivate("knowledge", entry.id)
                          }
                          className="text-sm font-semibold text-red-700 disabled:opacity-60"
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              />
            </section>
          </fieldset>
        )}
      </div>
    </main>
  );
}

function EntryList<T extends { id: string }>({
  entries,
  empty,
  render,
}: {
  entries: T[];
  empty: string;
  render: (entry: T) => ReactNode;
}) {
  if (entries.length === 0) {
    return <p className="mt-6 text-sm text-slate-500">{empty}</p>;
  }

  return (
    <ul className="mt-6 divide-y divide-slate-100 border-t border-slate-100">
      {entries.map((entry) => (
        <li key={entry.id} className="py-4">
          {render(entry)}
        </li>
      ))}
    </ul>
  );
}
