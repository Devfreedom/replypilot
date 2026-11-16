"use client";

import {
  Activity,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type BusinessProfile,
  type CatalogueEntry,
  type KnowledgeEntry,
  parseCatalogueEntryResponse,
  parseCatalogueResponse,
  parseKnowledgeEntryResponse,
  parseKnowledgeResponse,
  parseProfileResponse,
} from "@/lib/business";
import {
  formatMajorPrice,
  formatMinorToMajorInput,
  parseMajorPriceToMinor,
} from "@/lib/money";
import {
  CURRENCY_OPTIONS,
  defaultCatalogueCurrency,
} from "@/lib/currencies";
import {
  type BusinessProfileField,
  type BusinessProfileFieldErrors,
  type CatalogueField,
  type CatalogueFieldErrors,
  type KnowledgeField,
  type KnowledgeFieldErrors,
  hasFieldErrors,
  mapBusinessProfileServerErrors,
  mapCatalogueServerErrors,
  mapKnowledgeServerErrors,
  validateBusinessProfileField,
  validateBusinessProfileFields,
  validateCatalogueField,
  validateCatalogueFields,
  validateKnowledgeField,
  validateKnowledgeFields,
} from "@/lib/business-validation";
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
import { buildTimezoneOptions } from "@/lib/timezones";
import { useAuth } from "./auth-provider";
import { OpeningHoursEditor } from "./opening-hours-editor";
import { PhoneNumberField } from "./phone-number-field";
import { SearchableCombobox } from "./searchable-combobox";
import { Alert, FormField, PageHeading } from "./ui";

const secondaryButtonClass = "btn btn-secondary";
const primaryButtonClass = "btn btn-primary";

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

function emptyTextToNull(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function focusFirstInvalid(formElement: HTMLFormElement) {
  requestAnimationFrame(() => {
    formElement
      .querySelector<HTMLElement>('[data-invalid="true"], [aria-invalid="true"]')
      ?.focus();
  });
}

function hasKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

export type BusinessSettingsSection = "profile" | "catalogue" | "knowledge";

export function BusinessSettings({
  embedded = false,
  activeSection,
}: {
  embedded?: boolean;
  activeSection?: BusinessSettingsSection | null;
} = {}) {
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
  const [catalogueName, setCatalogueName] = useState("");
  const [catalogueCurrency, setCatalogueCurrency] = useState("NGN");
  const [cataloguePriceMajor, setCataloguePriceMajor] = useState("");
  const [catalogueAvailability, setCatalogueAvailability] = useState("");
  const [catalogueDescription, setCatalogueDescription] = useState("");
  const [catalogueIsActive, setCatalogueIsActive] = useState(true);
  const [catalogueFieldErrors, setCatalogueFieldErrors] =
    useState<CatalogueFieldErrors>({});
  const [editingKnowledge, setEditingKnowledge] =
    useState<KnowledgeEntry | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeEntryType, setKnowledgeEntryType] = useState<
    "faq" | "policy"
  >("faq");
  const [knowledgeAnswer, setKnowledgeAnswer] = useState("");
  const [knowledgeIsActive, setKnowledgeIsActive] = useState(true);
  const [knowledgeFieldErrors, setKnowledgeFieldErrors] =
    useState<KnowledgeFieldErrors>({});
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loadedReloadTokenRef = useRef<number | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
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
  const [profileFieldErrors, setProfileFieldErrors] =
    useState<BusinessProfileFieldErrors>({});

  const timezoneOptions = useMemo(
    () => buildTimezoneOptions(timezone),
    [timezone],
  );

  useEffect(() => {
    if (loadedReloadTokenRef.current === reloadToken) {
      return;
    }

    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [profileResponse, catalogueResponse, knowledgeResponse] =
          await Promise.all([
            fetch("/api/business/profile", { signal: controller.signal }),
            fetch("/api/business/catalogue", { signal: controller.signal }),
            fetch("/api/business/knowledge", { signal: controller.signal }),
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
          const failingData = !profileResponse.ok
            ? profileData
            : !catalogueResponse.ok
              ? catalogueData
              : knowledgeData;
          throw new Error(
            apiError(failingData, "Unable to load business settings."),
          );
        }

        if (controller.signal.aborted) return;

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

        loadedReloadTokenRef.current = reloadToken;
        setProfile(nextProfile);
        setCatalogue(nextCatalogue);
        setKnowledge(nextKnowledge);
        setShowProfileForm(nextProfile !== null);
        setBusinessName(nextProfile?.businessName ?? "");
        setBusinessDescription(nextProfile?.businessDescription ?? "");
        setContactEmail(nextProfile?.contactEmail ?? "");
        setBusinessAddress(nextProfile?.businessAddress ?? "");
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
        setProfileFieldErrors({});
        setCatalogueCurrency(defaultCatalogueCurrency(nextProfile?.currencyCode));
        setCatalogueFieldErrors({});
        setKnowledgeFieldErrors({});
      } catch (cause) {
        if (controller.signal.aborted) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load business settings.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      controller.abort();
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
    setBusinessName("");
    setBusinessDescription("");
    setContactEmail("");
    setBusinessAddress("");
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
    setProfileFieldErrors({});
  }

  function blurProfileField(
    field: BusinessProfileField,
    overrides?: Partial<
      Record<
        | "businessName"
        | "timezone"
        | "businessDescription"
        | "contactEmail"
        | "currency"
        | "phoneCountry"
        | "phoneNational"
        | "businessAddress",
        string
      >
    >,
  ) {
    const values = {
      businessName: overrides?.businessName ?? businessName,
      timezone: overrides?.timezone ?? timezone,
      businessDescription:
        overrides?.businessDescription ?? businessDescription,
      contactEmail: overrides?.contactEmail ?? contactEmail,
      currency: overrides?.currency ?? businessCurrency,
      phoneCountry: overrides?.phoneCountry ?? phoneCountry,
      phoneNational: overrides?.phoneNational ?? phoneNational,
      businessAddress: overrides?.businessAddress ?? businessAddress,
    };

    const nextError = validateBusinessProfileField(field, values);

    setProfileFieldErrors((current) => {
      const updated: BusinessProfileFieldErrors = {
        ...current,
        [field]: nextError,
      };

      if (field === "phoneCountry" || field === "phoneNumber") {
        updated.phoneCountry = validateBusinessProfileField(
          "phoneCountry",
          values,
        );
        updated.phoneNumber = validateBusinessProfileField(
          "phoneNumber",
          values,
        );
      }

      return updated;
    });
  }

  function blurCatalogueField(
    field: CatalogueField,
    overrides?: Partial<
      Record<
        | "name"
        | "currencyCode"
        | "priceMajor"
        | "availabilityNotes"
        | "description",
        string
      >
    >,
  ) {
    const values = {
      name: overrides?.name ?? catalogueName,
      currencyCode: overrides?.currencyCode ?? catalogueCurrency,
      priceMajor: overrides?.priceMajor ?? cataloguePriceMajor,
      availabilityNotes:
        overrides?.availabilityNotes ?? catalogueAvailability,
      description: overrides?.description ?? catalogueDescription,
    };

    const message = validateCatalogueField(field, values);

    setCatalogueFieldErrors((current) => {
      const updated: CatalogueFieldErrors = { ...current, [field]: message };

      if (field === "currencyCode" && values.priceMajor.trim()) {
        updated.priceMajor = validateCatalogueField("priceMajor", values);
      }

      return updated;
    });
  }

  function startEditCatalogue(entry: CatalogueEntry) {
    setEditingCatalogue(entry);
    setCatalogueName(entry.name);
    setCatalogueCurrency(entry.currencyCode);
    setCataloguePriceMajor(
      formatMinorToMajorInput(entry.priceMinor, entry.currencyCode),
    );
    setCatalogueAvailability(entry.availabilityNotes ?? "");
    setCatalogueDescription(entry.description);
    setCatalogueIsActive(entry.isActive);
    setCatalogueFieldErrors({});
    setError(null);
  }

  function resetCatalogueForm(profileCurrencyCode?: string | null) {
    setEditingCatalogue(null);
    setCatalogueName("");
    setCatalogueCurrency(defaultCatalogueCurrency(profileCurrencyCode));
    setCataloguePriceMajor("");
    setCatalogueAvailability("");
    setCatalogueDescription("");
    setCatalogueIsActive(true);
    setCatalogueFieldErrors({});
  }

  function blurKnowledgeField(
    field: KnowledgeField,
    overrides?: Partial<Record<"title" | "entryType" | "answer", string>>,
  ) {
    const values = {
      title: overrides?.title ?? knowledgeTitle,
      entryType: overrides?.entryType ?? knowledgeEntryType,
      answer: overrides?.answer ?? knowledgeAnswer,
    };

    setKnowledgeFieldErrors((current) => ({
      ...current,
      [field]: validateKnowledgeField(field, values),
    }));
  }

  function startEditKnowledge(entry: KnowledgeEntry) {
    setEditingKnowledge(entry);
    setKnowledgeTitle(entry.title);
    setKnowledgeEntryType(entry.entryType);
    setKnowledgeAnswer(entry.answer);
    setKnowledgeIsActive(entry.isActive);
    setKnowledgeFieldErrors({});
    setError(null);
  }

  function resetKnowledgeForm() {
    setEditingKnowledge(null);
    setKnowledgeTitle("");
    setKnowledgeEntryType("faq");
    setKnowledgeAnswer("");
    setKnowledgeIsActive(true);
    setKnowledgeFieldErrors({});
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    let openingHours: OpeningHoursEntry[];
    let scheduleInvalid = false;

    if (legacyOpeningHours) {
      openingHours = legacyOpeningHours;
    } else {
      const nextScheduleErrors = validateWeeklySchedule(schedule);
      setScheduleErrors(nextScheduleErrors);
      setScheduleValidationAttempted(true);
      scheduleInvalid = hasScheduleErrors(nextScheduleErrors);
      openingHours = openingHoursFromSchedule(schedule);
    }

    const nextFieldErrors = validateBusinessProfileFields({
      businessName,
      timezone,
      businessDescription,
      contactEmail,
      currency: businessCurrency,
      phoneCountry,
      phoneNational,
      businessAddress,
    });
    setProfileFieldErrors(nextFieldErrors);

    if (scheduleInvalid || hasFieldErrors(nextFieldErrors)) {
      focusFirstInvalid(formElement);
      return;
    }

    const nextPhoneValidation = validatePhoneInput(phoneCountry, phoneNational);
    const payload = {
      businessName: businessName.trim(),
      businessDescription: businessDescription.trim(),
      contactEmail: emptyTextToNull(contactEmail),
      contactPhone: nextPhoneValidation.phone,
      contactPhoneCountry: nextPhoneValidation.countryCode,
      businessAddress: emptyTextToNull(businessAddress),
      timezone: timezone.trim(),
      openingHours,
      currencyCode: businessCurrency || null,
    };

    setBusy(true);

    try {
      const response = await fetch("/api/business/profile", {
        method: profile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        const mapped = mapBusinessProfileServerErrors(
          data,
          "Unable to save business profile.",
        );
        setProfileFieldErrors(mapped.fieldErrors);

        if (hasFieldErrors(mapped.fieldErrors)) {
          focusFirstInvalid(formElement);
        }

        throw new Error(
          mapped.formError ?? "Unable to save business profile.",
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
      setBusinessName(saved.businessName);
      setBusinessDescription(saved.businessDescription);
      setContactEmail(saved.contactEmail ?? "");
      setBusinessAddress(saved.businessAddress ?? "");
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
      setProfileFieldErrors({});
      if (!editingCatalogue) {
        setCatalogueCurrency(defaultCatalogueCurrency(saved.currencyCode));
      }
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
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    const normalizedCurrency = catalogueCurrency.trim().toUpperCase();
    const validationErrors = validateCatalogueFields({
      name: catalogueName,
      currencyCode: normalizedCurrency,
      priceMajor: cataloguePriceMajor,
      availabilityNotes: catalogueAvailability,
      description: catalogueDescription,
    });
    setCatalogueFieldErrors(validationErrors);

    if (hasFieldErrors(validationErrors)) {
      focusFirstInvalid(formElement);
      return;
    }

    const parsedPrice = parseMajorPriceToMinor(
      cataloguePriceMajor,
      normalizedCurrency,
    );

    if (!parsedPrice.ok) {
      setCatalogueFieldErrors({ priceMajor: parsedPrice.message });
      focusFirstInvalid(formElement);
      return;
    }

    const payload = {
      name: catalogueName.trim(),
      description: catalogueDescription.trim(),
      priceMinor: parsedPrice.minor,
      currencyCode: normalizedCurrency,
      availabilityNotes: emptyTextToNull(catalogueAvailability),
      isActive: catalogueIsActive,
    };
    const path = editingCatalogue
      ? `/api/business/catalogue/${editingCatalogue.id}`
      : "/api/business/catalogue";

    setBusy(true);

    try {
      const response = await fetch(path, {
        method: editingCatalogue ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        const mapped = mapCatalogueServerErrors(
          data,
          "Unable to save service.",
        );
        setCatalogueFieldErrors(mapped.fieldErrors);

        if (hasFieldErrors(mapped.fieldErrors)) {
          focusFirstInvalid(formElement);
        }

        throw new Error(mapped.formError ?? "Unable to save service.");
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
      resetCatalogueForm(profile?.currencyCode);
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
    setNotice(null);
    setError(null);

    const formElement = event.currentTarget;
    const validationErrors = validateKnowledgeFields({
      title: knowledgeTitle,
      entryType: knowledgeEntryType,
      answer: knowledgeAnswer,
    });
    setKnowledgeFieldErrors(validationErrors);

    if (hasFieldErrors(validationErrors)) {
      focusFirstInvalid(formElement);
      return;
    }

    const payload = {
      title: knowledgeTitle.trim(),
      answer: knowledgeAnswer.trim(),
      entryType: knowledgeEntryType,
      isActive: knowledgeIsActive,
    };
    const path = editingKnowledge
      ? `/api/business/knowledge/${editingKnowledge.id}`
      : "/api/business/knowledge";

    setBusy(true);

    try {
      const response = await fetch(path, {
        method: editingKnowledge ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        const mapped = mapKnowledgeServerErrors(
          data,
          "Unable to save knowledge entry.",
        );
        setKnowledgeFieldErrors(mapped.fieldErrors);

        if (hasFieldErrors(mapped.fieldErrors)) {
          focusFirstInvalid(formElement);
        }

        throw new Error(mapped.formError ?? "Unable to save knowledge entry.");
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
      resetKnowledgeForm();
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
  const businessVisible = !embedded || activeSection !== null;
  const showProfileSection = !embedded || activeSection === "profile";
  const showCatalogueSection = !embedded || activeSection === "catalogue";
  const showKnowledgeSection = !embedded || activeSection === "knowledge";

  return (
    <div
      className={
        embedded
          ? businessVisible
            ? ""
            : "hidden"
          : "mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"
      }
    >
      <div className="mb-6 space-y-4">
        {!embedded ? (
          <>
            <PageHeading
              title="Business settings"
              description="Approved facts that reply drafts may use. Everything here applies only to this workspace."
            />
            <Alert tone="info" role="status">
              Signed in to{" "}
              <strong className="break-words">
                {workspace?.name ?? "this workspace"}
              </strong>
              . Business details and reply context are scoped to this workspace.
            </Alert>
          </>
        ) : null}

        {!canManage ? (
          <Alert tone="warning" role="status">
            You are a workspace member. Settings are read-only for your role;
            only the workspace owner can make changes.
          </Alert>
        ) : null}

        {notice ? (
          <Alert tone="success" role="status">
            {notice}
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="danger">
            {error}{" "}
            <button
              type="button"
              onClick={retryLoad}
              className="ml-2 font-semibold underline"
            >
              Try again
            </button>
          </Alert>
        ) : null}
      </div>

      {loading ? (
          <p
            role="status"
            className="py-16 text-center text-sm text-ink-soft"
          >
            Loading business settings…
          </p>
        ) : (
          <fieldset
            disabled={!canManage}
            className="m-0 min-w-0 space-y-8 border-0 p-0"
          >
            <Activity mode={showProfileSection ? "visible" : "hidden"}>
              <section
                id={embedded ? "settings-panel-profile" : undefined}
                role={embedded ? "tabpanel" : undefined}
                aria-labelledby={embedded ? "settings-tab-profile" : undefined}
                className="card p-5 sm:p-6"
              >
                <h2 className="text-lg font-bold text-ink">
                  Business profile
                </h2>

              {showSetupState ? (
                <div className="mt-4 rounded-xl border border-dashed border-line-strong bg-hushed p-5">
                  <h3 className="text-base font-semibold text-ink">
                    Your business profile is not set up yet
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
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
                  <p className="mt-1 text-sm text-ink-soft">
                    Add only facts you approve for future reply context.
                  </p>
                  <form
                    noValidate
                    className="mt-5 grid gap-4 sm:grid-cols-2"
                    onSubmit={(event) => void saveProfile(event)}
                  >
                    <FormField
                      id="profile-business-name"
                      label="Business name"
                      error={profileFieldErrors.businessName}
                    >
                      {(fieldProps) => (
                        <input
                          {...fieldProps}
                          name="businessName"
                          value={businessName}
                          onChange={(event) =>
                            setBusinessName(event.target.value)
                          }
                          onBlur={(event) =>
                            blurProfileField("businessName", {
                              businessName: event.target.value,
                            })
                          }
                          className="input"
                        />
                      )}
                    </FormField>
                    <SearchableCombobox
                      id="profile-timezone"
                      label="Timezone"
                      value={timezone}
                      options={timezoneOptions}
                      onChange={(value) => {
                        setTimezone(value);
                        blurProfileField("timezone", { timezone: value });
                      }}
                      placeholder="Select a timezone"
                      helpText="Search by region or city. The business owner must choose the timezone; it is not guessed from this device."
                      error={profileFieldErrors.timezone}
                      disabled={busy}
                    />
                    <div className="sm:col-span-2">
                      <FormField
                        id="profile-business-description"
                        label="Business description"
                        error={profileFieldErrors.businessDescription}
                      >
                        {(fieldProps) => (
                          <textarea
                            {...fieldProps}
                            name="businessDescription"
                            value={businessDescription}
                            onChange={(event) =>
                              setBusinessDescription(event.target.value)
                            }
                            onBlur={(event) =>
                              blurProfileField("businessDescription", {
                                businessDescription: event.target.value,
                              })
                            }
                            rows={3}
                            className="textarea"
                          />
                        )}
                      </FormField>
                    </div>
                    <FormField
                      id="profile-contact-email"
                      label="Contact email"
                      error={profileFieldErrors.contactEmail}
                    >
                      {(fieldProps) => (
                        <input
                          {...fieldProps}
                          type="email"
                          name="contactEmail"
                          value={contactEmail}
                          onChange={(event) =>
                            setContactEmail(event.target.value)
                          }
                          onBlur={(event) =>
                            blurProfileField("contactEmail", {
                              contactEmail: event.target.value,
                            })
                          }
                          className="input"
                          placeholder="hello@studio.ng"
                        />
                      )}
                    </FormField>
                    <SearchableCombobox
                      id="profile-currency"
                      label="Business currency"
                      value={businessCurrency}
                      options={CURRENCY_OPTIONS}
                      onChange={(value) => {
                        setBusinessCurrency(value);
                        blurProfileField("currency", { currency: value });
                      }}
                      placeholder="Not configured"
                      helpText={
                        businessCurrency
                          ? "Used as the default for new services. Existing service currencies and prices are not changed."
                          : "No business currency is saved yet. Choose one to set the default for new services."
                      }
                      error={profileFieldErrors.currency}
                      disabled={busy}
                      allowClear
                    />
                    <PhoneNumberField
                      countryCode={phoneCountry}
                      nationalNumber={phoneNational}
                      countryError={profileFieldErrors.phoneCountry}
                      numberError={profileFieldErrors.phoneNumber}
                      warning={phoneWarning}
                      disabled={busy}
                      onCountryChange={(value) => {
                        setPhoneCountry(value);
                        setPhoneWarning(null);
                        blurProfileField("phoneCountry", {
                          phoneCountry: value,
                        });
                      }}
                      onNationalNumberChange={(value) => {
                        setPhoneNational(value);
                        setPhoneWarning(null);
                      }}
                      onNationalNumberBlur={() =>
                        blurProfileField("phoneNumber")
                      }
                    />
                    <div className="sm:col-span-2">
                      <FormField
                        id="profile-business-address"
                        label="Business address"
                        error={profileFieldErrors.businessAddress}
                      >
                        {(fieldProps) => (
                          <input
                            {...fieldProps}
                            name="businessAddress"
                            value={businessAddress}
                            onChange={(event) =>
                              setBusinessAddress(event.target.value)
                            }
                            onBlur={(event) =>
                              blurProfileField("businessAddress", {
                                businessAddress: event.target.value,
                              })
                            }
                            className="input"
                          />
                        )}
                      </FormField>
                    </div>
                    {profileFieldErrors.openingHours ? (
                      <p
                        role="alert"
                        className="text-xs font-medium text-danger-ink sm:col-span-2"
                      >
                        {profileFieldErrors.openingHours}
                      </p>
                    ) : null}
                    {legacyOpeningHours !== null ? (
                      <div className="min-w-0 rounded-2xl border border-[color-mix(in_oklab,var(--rp-warning)_25%,transparent)] bg-warning-soft p-4 sm:col-span-2 sm:p-5">
                        <h3 className="text-sm font-semibold text-ink">
                          Opening hours
                        </h3>
                        <div
                          role="alert"
                          className="mt-2 text-sm leading-6 text-warning-ink"
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

                        <p className="mt-4 text-sm font-medium text-ink">
                          Saved entries
                        </p>
                        <ul className="mt-1 space-y-1 text-sm text-warning-ink">
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
                        <p className="mt-2 text-xs text-warning-ink">
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
                            className="min-w-0 rounded-xl border border-[color-mix(in_oklab,var(--rp-warning)_25%,transparent)] bg-warning-soft px-4 py-3 text-sm text-warning-ink sm:col-span-2"
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
            </Activity>

            <Activity mode={showCatalogueSection ? "visible" : "hidden"}>
              <section
                id={embedded ? "settings-panel-catalogue" : undefined}
                role={embedded ? "tabpanel" : undefined}
                aria-labelledby={embedded ? "settings-tab-catalogue" : undefined}
                className="card p-5 sm:p-6"
              >
                <h2 className="text-lg font-bold text-ink">
                  Products &amp; services
                </h2>
                <form
                  noValidate
                  className="mt-5 grid gap-4 sm:grid-cols-2"
                  onSubmit={(event) => void saveCatalogue(event)}
                >
                  <FormField
                    id="catalogue-name"
                    label="Name"
                    error={catalogueFieldErrors.name}
                  >
                    {(fieldProps) => (
                      <input
                        {...fieldProps}
                        name="name"
                        value={catalogueName}
                        onChange={(event) =>
                          setCatalogueName(event.target.value)
                        }
                        onBlur={(event) =>
                          blurCatalogueField("name", {
                            name: event.target.value,
                          })
                        }
                        className="input"
                      />
                    )}
                  </FormField>
                  <FormField
                    id="catalogue-currency"
                    label="Currency code"
                    hint={`Use a current uppercase ISO 4217 code (for example NGN or USD). Defaults to ${defaultCatalogueCurrency(profile?.currencyCode)}.`}
                    error={catalogueFieldErrors.currencyCode}
                  >
                    {(fieldProps) => (
                      <input
                        {...fieldProps}
                        name="currencyCode"
                        value={catalogueCurrency}
                        onChange={(event) =>
                          setCatalogueCurrency(event.target.value)
                        }
                        onBlur={(event) => {
                          const normalized = event.target.value
                            .trim()
                            .toUpperCase();
                          setCatalogueCurrency(normalized);
                          blurCatalogueField("currencyCode", {
                            currencyCode: normalized,
                          });
                        }}
                        maxLength={3}
                        className="input uppercase"
                      />
                    )}
                  </FormField>
                  <FormField
                    id="catalogue-price"
                    label="Price"
                    hint="Enter normal major currency units (for example 15000 or 15000.50 in NGN). Leave blank when quoted per booking."
                    error={catalogueFieldErrors.priceMajor}
                  >
                    {(fieldProps) => (
                      <input
                        {...fieldProps}
                        name="priceMajor"
                        value={cataloguePriceMajor}
                        onChange={(event) =>
                          setCataloguePriceMajor(event.target.value)
                        }
                        onBlur={(event) =>
                          blurCatalogueField("priceMajor", {
                            priceMajor: event.target.value,
                          })
                        }
                        type="text"
                        inputMode="decimal"
                        placeholder="15000.00"
                        className="input numeric-tabular"
                      />
                    )}
                  </FormField>
                  <FormField
                    id="catalogue-availability"
                    label="Availability notes"
                    error={catalogueFieldErrors.availabilityNotes}
                  >
                    {(fieldProps) => (
                      <input
                        {...fieldProps}
                        name="availabilityNotes"
                        value={catalogueAvailability}
                        onChange={(event) =>
                          setCatalogueAvailability(event.target.value)
                        }
                        onBlur={(event) =>
                          blurCatalogueField("availabilityNotes", {
                            availabilityNotes: event.target.value,
                          })
                        }
                        className="input"
                      />
                    )}
                  </FormField>
                  <div className="sm:col-span-2">
                    <FormField
                      id="catalogue-description"
                      label="Description"
                      error={catalogueFieldErrors.description}
                    >
                      {(fieldProps) => (
                        <textarea
                          {...fieldProps}
                          name="description"
                          value={catalogueDescription}
                          onChange={(event) =>
                            setCatalogueDescription(event.target.value)
                          }
                          onBlur={(event) =>
                            blurCatalogueField("description", {
                              description: event.target.value,
                            })
                          }
                          rows={3}
                          className="textarea"
                        />
                      )}
                    </FormField>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                    <input
                      name="isActive"
                      type="checkbox"
                      className="checkbox"
                      checked={catalogueIsActive}
                      onChange={(event) =>
                        setCatalogueIsActive(event.target.checked)
                      }
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
                        onClick={() =>
                          resetCatalogueForm(profile?.currencyCode)
                        }
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words font-semibold text-ink">
                          {entry.name}
                        </p>
                        <span
                          className={`badge ${
                            entry.isActive ? "badge-booked" : "badge-neutral"
                          }`}
                        >
                          {entry.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        <span className="numeric-tabular font-medium text-ink">
                          {entry.priceMinor === null
                            ? "Price on request"
                            : formatMajorPrice(
                                entry.priceMinor,
                                entry.currencyCode,
                              )}
                        </span>{" "}
                        ·{" "}
                        {entry.isActive
                          ? "used for future reply context"
                          : "not used for reply context"}
                      </p>
                      <div className="mt-2 flex gap-3 py-1">
                        <button
                          type="button"
                          onClick={() => startEditCatalogue(entry)}
                          className="btn btn-quiet"
                        >
                          Edit
                        </button>
                        {entry.isActive ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void deactivate("catalogue", entry.id)}
                            className="btn btn-danger-quiet"
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                />
              </section>
            </Activity>

            <Activity mode={showKnowledgeSection ? "visible" : "hidden"}>
              <section
                id={embedded ? "settings-panel-knowledge" : undefined}
                role={embedded ? "tabpanel" : undefined}
                aria-labelledby={embedded ? "settings-tab-knowledge" : undefined}
                className="card p-5 sm:p-6"
              >
                <h2 className="text-lg font-bold text-ink">
                  FAQs &amp; policies
                </h2>
                <form
                  noValidate
                  className="mt-5 grid gap-4 sm:grid-cols-2"
                  onSubmit={(event) => void saveKnowledge(event)}
                >
                  <FormField
                    id="knowledge-title"
                    label="Title or question"
                    error={knowledgeFieldErrors.title}
                  >
                    {(fieldProps) => (
                      <input
                        {...fieldProps}
                        name="title"
                        value={knowledgeTitle}
                        onChange={(event) =>
                          setKnowledgeTitle(event.target.value)
                        }
                        onBlur={(event) =>
                          blurKnowledgeField("title", {
                            title: event.target.value,
                          })
                        }
                        className="input"
                      />
                    )}
                  </FormField>
                  <FormField
                    id="knowledge-entry-type"
                    label="Entry type"
                    error={knowledgeFieldErrors.entryType}
                  >
                    {(fieldProps) => (
                      <select
                        {...fieldProps}
                        name="entryType"
                        value={knowledgeEntryType}
                        onChange={(event) =>
                          setKnowledgeEntryType(
                            event.target.value as "faq" | "policy",
                          )
                        }
                        onBlur={(event) =>
                          blurKnowledgeField("entryType", {
                            entryType: event.target.value,
                          })
                        }
                        className="select"
                      >
                        <option value="faq">FAQ</option>
                        <option value="policy">Policy</option>
                      </select>
                    )}
                  </FormField>
                  <div className="sm:col-span-2">
                    <FormField
                      id="knowledge-answer"
                      label="Approved answer or policy"
                      error={knowledgeFieldErrors.answer}
                    >
                      {(fieldProps) => (
                        <textarea
                          {...fieldProps}
                          name="answer"
                          value={knowledgeAnswer}
                          onChange={(event) =>
                            setKnowledgeAnswer(event.target.value)
                          }
                          onBlur={(event) =>
                            blurKnowledgeField("answer", {
                              answer: event.target.value,
                            })
                          }
                          rows={4}
                          className="textarea"
                        />
                      )}
                    </FormField>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                    <input
                      name="isActive"
                      type="checkbox"
                      className="checkbox"
                      checked={knowledgeIsActive}
                      onChange={(event) =>
                        setKnowledgeIsActive(event.target.checked)
                      }
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
                        onClick={resetKnowledgeForm}
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words font-semibold text-ink">
                          {entry.title}
                        </p>
                        <span className="badge badge-neutral">
                          {entry.entryType === "faq" ? "FAQ" : "Policy"}
                        </span>
                        <span
                          className={`badge ${
                            entry.isActive ? "badge-booked" : "badge-neutral"
                          }`}
                        >
                          {entry.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1.5 max-w-2xl break-words text-sm leading-6 text-ink-soft">
                        {entry.answer}
                      </p>
                      <div className="mt-2 flex gap-3 py-1">
                        <button
                          type="button"
                          onClick={() => startEditKnowledge(entry)}
                          className="btn btn-quiet"
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
                            className="btn btn-danger-quiet"
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                />
              </section>
            </Activity>
          </fieldset>
        )}
      </div>
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
    return <p className="mt-6 text-sm text-ink-soft">{empty}</p>;
  }

  return (
    <ul className="mt-6 divide-y divide-line border-t border-line">
      {entries.map((entry) => (
        <li key={entry.id} className="py-4">
          {render(entry)}
        </li>
      ))}
    </ul>
  );
}
