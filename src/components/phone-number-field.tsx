"use client";

import { useId } from "react";
import {
  PHONE_COUNTRY_OPTIONS,
  getPhoneCountry,
} from "@/lib/countries";
import { SearchableCombobox } from "./searchable-combobox";

type PhoneNumberFieldProps = {
  countryCode: string;
  nationalNumber: string;
  countryError?: string;
  numberError?: string;
  warning?: string | null;
  disabled?: boolean;
  onCountryChange: (value: string) => void;
  onNationalNumberChange: (value: string) => void;
};

export function PhoneNumberField({
  countryCode,
  nationalNumber,
  countryError,
  numberError,
  warning,
  disabled = false,
  onCountryChange,
  onNationalNumberChange,
}: PhoneNumberFieldProps) {
  const idPrefix = useId();
  const countryId = `${idPrefix}-phone-country`;
  const numberId = `${idPrefix}-phone-number`;
  const helpId = `${idPrefix}-phone-help`;
  const numberErrorId = `${idPrefix}-phone-number-error`;
  const selectedCountry = getPhoneCountry(countryCode);
  const numberDescribedBy = [helpId, numberError ? numberErrorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2 sm:p-5"
    >
      <legend className="px-1 text-sm font-semibold text-slate-800">
        Contact phone{" "}
        <span className="font-normal text-slate-500">(optional)</span>
      </legend>

      <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
        <SearchableCombobox
          id={countryId}
          label="Phone country"
          value={countryCode}
          options={PHONE_COUNTRY_OPTIONS}
          onChange={onCountryChange}
          placeholder="Select a country"
          error={countryError}
          disabled={disabled}
          allowClear
          helpText="Choose the country that owns this phone number."
        />

        <div className="min-w-0">
          <label
            htmlFor={numberId}
            className="block text-sm font-medium text-slate-700"
          >
            Phone number
          </label>
          <div className="mt-1 flex min-w-0">
            <span
              aria-hidden="true"
              className="flex shrink-0 items-center gap-1 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-600"
            >
              {selectedCountry ? (
                <>
                  <span>{selectedCountry.flag}</span>
                  <span>+{selectedCountry.callingCode}</span>
                </>
              ) : (
                <span>Country code</span>
              )}
            </span>
            <input
              id={numberId}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={nationalNumber}
              onChange={(event) =>
                onNationalNumberChange(event.target.value)
              }
              aria-describedby={numberDescribedBy}
              aria-invalid={numberError ? true : undefined}
              placeholder="0803 123 4567"
              className={`min-w-0 flex-1 rounded-r-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                numberError ? "border-red-400" : ""
              }`}
            />
          </div>
          <p id={helpId} className="mt-1 text-xs leading-5 text-slate-500">
            The selected country code is shown separately and added
            automatically. Enter only the national number, without the
            international calling code.
          </p>
          {numberError ? (
            <p
              id={numberErrorId}
              role="alert"
              className="mt-1 text-xs text-red-700"
            >
              {numberError}
            </p>
          ) : null}
        </div>
      </div>

      {warning ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"
        >
          {warning}
        </p>
      ) : null}
    </fieldset>
  );
}
