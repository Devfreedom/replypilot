import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import {
  countryName,
  isCuratedPhoneCountryCode,
  type CuratedPhoneCountryCode,
} from "./countries";

export type PhoneValidationErrors = {
  country?: string;
  number?: string;
};

export type PhoneValidationResult = {
  phone: string | null;
  countryCode: CuratedPhoneCountryCode | null;
  errors: PhoneValidationErrors;
};

export type RestoredPhoneState = {
  countryCode: CuratedPhoneCountryCode | "";
  nationalNumber: string;
  warning: string | null;
};

function parseNationalNumber(
  input: string,
  countryCode: CuratedPhoneCountryCode,
) {
  try {
    return parsePhoneNumberFromString(input, countryCode as CountryCode);
  } catch {
    return undefined;
  }
}

/**
 * Parse and normalize the national number entered beside a country selector.
 * The saved value is always the library's E.164 representation, so the
 * selected calling code is never prepended twice.
 */
export function validatePhoneInput(
  countryCode: string,
  nationalNumber: string,
): PhoneValidationResult {
  const input = nationalNumber.trim();
  const selectedCountry = isCuratedPhoneCountryCode(countryCode)
    ? countryCode
    : null;

  if (!input) {
    return {
      phone: null,
      countryCode: selectedCountry,
      errors: {},
    };
  }

  if (!selectedCountry) {
    return {
      phone: null,
      countryCode: null,
      errors: {
        country: "Choose the country for this phone number.",
      },
    };
  }

  const parsed = parseNationalNumber(input, selectedCountry);

  if (!parsed || !parsed.isValid()) {
    return {
      phone: null,
      countryCode: selectedCountry,
      errors: {
        number: `Enter a valid phone number for ${countryName(selectedCountry)}.`,
      },
    };
  }

  if (parsed.country && parsed.country !== selectedCountry) {
    return {
      phone: null,
      countryCode: selectedCountry,
      errors: {
        number: `This number appears to belong to ${countryName(
          parsed.country,
        )}. Choose that country or correct the number.`,
      },
    };
  }

  return {
    phone: parsed.number,
    countryCode: selectedCountry,
    errors: {},
  };
}

/**
 * Restore a saved profile phone without guessing when the value cannot be
 * interpreted. Unreadable values stay in the input so the user can confirm or
 * replace them rather than losing the saved text.
 */
export function restorePhoneState(
  savedPhone: string | null,
  savedCountry: string | null,
): RestoredPhoneState {
  const rawPhone = savedPhone?.trim() ?? "";
  const validSavedCountry: CuratedPhoneCountryCode | "" =
    savedCountry && isCuratedPhoneCountryCode(savedCountry)
      ? savedCountry
      : "";

  if (!rawPhone) {
    return {
      countryCode: validSavedCountry,
      nationalNumber: "",
      warning: null,
    };
  }

  let parsed: ReturnType<typeof parsePhoneNumberFromString>;

  try {
    parsed = parsePhoneNumberFromString(rawPhone);
  } catch {
    parsed = undefined;
  }

  if (!parsed) {
    return {
      countryCode: validSavedCountry,
      nationalNumber: rawPhone,
      warning:
        "The saved phone number could not be interpreted. Confirm or replace it before saving.",
    };
  }

  const detectedCountry =
    parsed.country && isCuratedPhoneCountryCode(parsed.country)
      ? parsed.country
      : "";

  if (!parsed.isValid()) {
    return {
      countryCode: validSavedCountry || detectedCountry,
      nationalNumber: rawPhone,
      warning:
        "The saved phone number is not a complete, valid number. Confirm or replace it before saving.",
    };
  }

  if (savedCountry && !validSavedCountry) {
    return {
      countryCode: detectedCountry,
      nationalNumber: detectedCountry
        ? parsed.formatNational()
        : rawPhone,
      warning:
        "The saved phone country is not one of the available choices. Choose a country and confirm the number before saving.",
    };
  }

  if (validSavedCountry) {
    if (detectedCountry && detectedCountry !== validSavedCountry) {
      return {
        countryCode: validSavedCountry,
        nationalNumber: rawPhone,
        warning: `The saved number appears to belong to ${countryName(
          detectedCountry,
        )}, but the saved phone country is ${countryName(
          validSavedCountry,
        )}. Confirm the country and number before saving.`,
      };
    }

    if (!detectedCountry) {
      return {
        countryCode: validSavedCountry,
        nationalNumber: rawPhone,
        warning:
          "The saved phone number could not be matched to a country. Confirm or replace it before saving.",
      };
    }

    return {
      countryCode: validSavedCountry,
      nationalNumber: parsed.formatNational(),
      warning: null,
    };
  }

  if (!detectedCountry) {
    return {
      countryCode: "",
      nationalNumber: rawPhone,
      warning:
        "The saved phone number is not from one of the available countries. Choose a country and confirm the number before saving.",
    };
  }

  return {
    countryCode: detectedCountry,
    nationalNumber: parsed.formatNational(),
    warning: null,
  };
}
